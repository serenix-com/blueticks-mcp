import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { resolveApiKey, getClient } from "./client";
import messagesTool from "./tools/messages";
import chatsTool from "./tools/chats";
import contactsTool from "./tools/contacts";
import groupsTool from "./tools/groups";
import audiencesTool from "./tools/audiences";
import campaignsTool from "./tools/campaigns";
import webhooksTool from "./tools/webhooks";
import engineTool from "./tools/engine";
import utilsTool from "./tools/utils";

const tools = [
  messagesTool,
  chatsTool,
  contactsTool,
  groupsTool,
  audiencesTool,
  campaignsTool,
  webhooksTool,
  engineTool,
  utilsTool,
] as const;

type AnyTool = (typeof tools)[number];

async function main(): Promise<void> {
  const apiKey = resolveApiKey(process.argv.slice(2), process.env);
  const client = getClient(apiKey);

  const server = new Server(
    { name: "@blueticks/mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name) as AnyTool | undefined;
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      } as CallToolResult;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return tool.dispatch(request.params.arguments as any, client) as Promise<CallToolResult>;
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});

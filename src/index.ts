import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { resolveApiKey, getClient } from "./client";

// Tool defs are owned by the backend (single source of truth: every
// MCP entrypoint — this stdio standalone and the backend's in-process
// OAuth path — runs the same definitions). The backend repo is
// submoduled at ./backend and tsup bundles the imported defs into
// dist/ at publish time, so the published @blueticks/mcp package has
// no submodule dependency at runtime.
import {
  audiencesTool,
  campaignsTool,
  chatsTool,
  contactsTool,
  engineTool,
  groupsTool,
  scheduledMessagesTool,
  utilsTool,
  webhooksTool,
} from "../backend/src/mcp-tool-defs";

const tools = [
  scheduledMessagesTool,
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
  const client = getClient(apiKey, process.env.BLUETICKS_BASE_URL);

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
    // TypeScript can't represent the union of every tool's dispatch
    // input once you have ~10 tools × multi-variant actions (TS2590).
    // Cast through a relaxed signature; runtime safety is enforced by
    // the per-tool zod schema each dispatcher applies internally.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Dispatch = (input: unknown, client: any) => Promise<CallToolResult>;
    return (tool.dispatch as unknown as Dispatch)(
      request.params.arguments,
      client,
    );
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});

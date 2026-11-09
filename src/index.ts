import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient, resolveApiKey } from "./client";

// Tool defs are VENDORED at src/tool-defs (see src/tool-defs/VENDORED.md). The
// advertised list (hosted-default names; chats and scheduled_messages split into
// _read/_write) is built in ./manifest.
import { buildServerInstructions, buildToolList, findTool } from "./manifest";
import type { BlueticksSurface } from "./tool-defs";
import pkg from "../package.json";

const tools = buildToolList();

async function main(): Promise<void> {
  const apiKey = resolveApiKey(process.argv.slice(2), process.env);
  // Typed as the tool-def surface, so a drift between what the vendored tools
  // call and what the /v1 adapter implements is a compile error.
  const client: BlueticksSurface = createClient(apiKey, { baseUrl: process.env.BLUETICKS_BASE_URL });

  const server = new Server(
    { name: "@blueticks/mcp", version: pkg.version },
    { capabilities: { tools: {} }, instructions: buildServerInstructions() },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.annotations && { annotations: t.annotations }),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = findTool(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      } as CallToolResult;
    }
    const result = await tool.dispatch(request.params.arguments, client);
    return { ...result };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});

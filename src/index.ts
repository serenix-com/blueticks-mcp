import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { resolveApiKey, getClient } from "./client";

// Tool defs are VENDORED at src/tool-defs (see src/tool-defs/VENDORED.md). The
// advertised list (hosted-default names; chats and scheduled_messages split into
// _read/_write) is built in ./manifest.
import { buildToolList, findTool } from "./manifest";
import type { BlueticksSurface } from "./tool-defs";

const tools = buildToolList();

async function main(): Promise<void> {
  const apiKey = resolveApiKey(process.argv.slice(2), process.env);
  // Typed as the tool-def surface (not the concrete `Blueticks`) so any drift
  // between what the tools call and the real SDK is a compile error: if the
  // published `blueticks` SDK stops matching what the tools call, the build
  // fails here rather than at runtime with "tool execution failed".
  //
  // `suno` is omitted: it's a backend-in-process-adapter surface (uploadAudio),
  // not part of the published SDK's SunoResource (uploadReference), and this
  // standalone server does not register the suno tool. Every tool it DOES ship
  // still gets full drift-checking against the real SDK.
  const client: Omit<BlueticksSurface, "suno"> = getClient(
    apiKey,
    process.env.BLUETICKS_BASE_URL,
  );

  const server = new Server(
    { name: "@blueticks/mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
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

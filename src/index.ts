import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { resolveApiKey, getClient } from "./client";

// Tool defs are VENDORED here at src/tool-defs (see src/tool-defs/VENDORED.md).
// Source of truth is the backend: whatsapp-scheduler-backend
// src/mcp-tool-defs (prod). We keep a checked-in copy rather than a submodule
// because that repo is private — CI can't clone a private submodule with the
// default token, and the published @blueticks/mcp package must build
// self-contained. Re-sync the copy when the backend tool-defs change.
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
  type BlueticksSurface,
} from "./tool-defs";

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
    type Dispatch = (input: unknown, client: BlueticksSurface) => Promise<CallToolResult>;
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

import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const Empty = z.object({}).strict();

const actions = {
  status: Empty,
};

type EngineInput = { action: keyof typeof actions };

const engineTool = {
  name: "engine" as const,
  description: [
    "Inspect the WhatsApp engine(s) connected to this account.",
    "Available actions:",
    "  - status: returns the connected engines as an array — one entry per online",
    "      engine, each with {id, type, connected, state, stream, hasSynced}. An",
    "      empty array means no engine is currently connected (not an error).",
    "",
    "Examples:",
    "  - status: 'is WhatsApp connected?'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    status: { readOnlyHint: true },
  },
  async dispatch(input: EngineInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "status":
          // 2.0 replaced the single-object `engines.status()` with
          // `engines.list()` → Engine[]. A workspace can have multiple
          // online engines (e.g. two paired WhatsApp Web tabs); return
          // them all and let the caller pick.
          data = await client.engines.list();
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default engineTool;

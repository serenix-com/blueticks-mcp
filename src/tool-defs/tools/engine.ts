import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const Empty = z.object({}).strict();

const actions = {
  status: Empty,
  logout: Empty,
  reload: Empty,
};

type EngineInput = { action: keyof typeof actions };

const engineTool = {
  name: "engine" as const,
  description: [
    "Inspect or control the WhatsApp engine connected to this account.",
    "Available actions:",
    "  - status: returns connection state ({connected, state, stream, has_synced})",
    "  - logout: signs the engine out of WhatsApp Web (destructive)",
    "  - reload: hard-reloads the engine (destructive). Needs a connected engine and returns no_engine_connected otherwise; if none is online, reload cannot help — ask the user to open WhatsApp / re-link instead of retrying.",
    "",
    "Examples:",
    "  - status: 'is WhatsApp connected?'",
    "  - logout: 'log my engine out so I can scan a different QR'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  // Per-action argument schemas (clients that expose one tool per action).
  actionSchemas: actions,
  annotations: {
    status: { readOnlyHint: true },
    logout: { destructiveHint: true },
    reload: { destructiveHint: true },
  },
  async dispatch(input: EngineInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "status":
          data = await client.engines.status();
          break;
        case "logout":
          data = await client.engines.logout();
          break;
        case "reload":
          data = await client.engines.reload();
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default engineTool;

import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

// NOTE: `validate_phone` and `link_preview` were dropped in the 2.0 API —
// the `utils` resource (and its `/v1/utils/*` endpoints) no longer exists.
// Only `current_date_time` survives: it's a purely local helper computed
// from the MCP host clock, needing no backend call, so it stays.
const actions = {
  current_date_time: z.object({}).strict(),
};

type UtilsInput = { action: "current_date_time" };

const utilsTool = {
  name: "utils" as const,
  description: [
    "Local helpers that don't require a backend call.",
    "Available actions:",
    "  - current_date_time: current date/time + timezone of the MCP host (gateway pod or stdio bridge). Always call this before any tool that takes a future timestamp.",
    "",
    "Examples:",
    "  - current_date_time: 'what time is it for me right now?'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    current_date_time: { readOnlyHint: true },
  },
  async dispatch(input: UtilsInput, _client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "current_date_time": {
          // Local-only helper — there's no backend endpoint for this and
          // the SDK doesn't expose it. Returns the MCP host's time. If
          // the MCP runs in the gateway pod, that's UTC; via stdio
          // bridge, the user's machine.
          const now = new Date();
          data = {
            iso: now.toISOString(),
            unix_ms: now.getTime(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            offset_minutes: -now.getTimezoneOffset(),
          };
          break;
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default utilsTool;

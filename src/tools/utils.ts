import { z } from "zod";
import type { BlueticksSurface } from "../blueticks-surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const actions = {
  validate_phone: z.object({ phone_or_chat_id: z.string().min(3) }).strict(),
  link_preview: z.object({ url: z.string().url() }).strict(),
  current_date_time: z.object({}).strict(),
};

type UtilsInput =
  | { action: "validate_phone"; phone_or_chat_id: string }
  | { action: "link_preview"; url: string }
  | { action: "current_date_time" };

const utilsTool = {
  name: "whatsapp_utils" as const,
  description: [
    "WhatsApp utility helpers that don't fit a primary resource.",
    "Available actions:",
    "  - validate_phone: check whether a phone or chat id is valid and registered on WhatsApp",
    "  - link_preview: generate the preview metadata WhatsApp would show for a URL",
    "  - current_date_time: current date/time + timezone of the MCP host (gateway pod or stdio bridge). Always call this before any tool that takes a future timestamp.",
    "",
    "Examples:",
    "  - validate_phone: 'is +972544325389 on WhatsApp?'",
    "  - link_preview: 'preview https://blueticks.co for me'",
    "  - current_date_time: 'what time is it for me right now?'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    validate_phone: { readOnlyHint: true },
    link_preview: { readOnlyHint: true },
    current_date_time: { readOnlyHint: true },
  },
  async dispatch(input: UtilsInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "validate_phone":
          data = await client.utils.validatePhone({ phone_or_chat_id: input.phone_or_chat_id });
          break;
        case "link_preview":
          data = await client.utils.linkPreview({ url: input.url });
          break;
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

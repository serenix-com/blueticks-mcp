import { z } from "zod";
import type { Blueticks } from "blueticks";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const actions = {
  validate_phone: z.object({ phone_or_chat_id: z.string().min(3) }).strict(),
  link_preview: z.object({ url: z.string().url() }).strict(),
};

type UtilsInput =
  | { action: "validate_phone"; phone_or_chat_id: string }
  | { action: "link_preview"; url: string };

const utilsTool = {
  name: "whatsapp_utils" as const,
  description: [
    "WhatsApp utility helpers that don't fit a primary resource.",
    "Available actions:",
    "  - validate_phone: check whether a phone or chat id is valid and registered on WhatsApp",
    "  - link_preview: generate the preview metadata WhatsApp would show for a URL",
    "",
    "Examples:",
    "  - validate_phone: 'is +972544325389 on WhatsApp?'",
    "  - link_preview: 'preview https://blueticks.co for me'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    validate_phone: { readOnlyHint: true },
    link_preview: { readOnlyHint: true },
  },
  async dispatch(input: UtilsInput, client: Blueticks): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "validate_phone":
          data = await client.utils.validatePhone({ phone_or_chat_id: input.phone_or_chat_id });
          break;
        case "link_preview":
          data = await client.utils.linkPreview({ url: input.url });
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default utilsTool;

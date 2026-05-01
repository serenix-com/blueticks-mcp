import { z } from "zod";
import type { BlueticksSurface } from "../blueticks-surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const ScheduledMessageId = z.string().min(8);

const ListArgs = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  })
  .strict();

const GetArgs = z.object({ message_id: ScheduledMessageId }).strict();

const UpdateArgs = z
  .object({
    message_id: ScheduledMessageId,
    text: z.string().min(1).optional(),
    media_url: z.string().url().optional(),
    media_caption: z.string().optional(),
    // ISO 8601 datetime — call whatsapp_utils.current_date_time first
    // to anchor any relative reference like "tomorrow at 9am".
    send_at: z.string().datetime().optional(),
  })
  .strict();

const DeleteArgs = z.object({ message_id: ScheduledMessageId }).strict();

const actions = {
  list: ListArgs,
  get: GetArgs,
  update: UpdateArgs,
  delete: DeleteArgs,
};

type ScheduledMessagesInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "update" } & z.infer<typeof UpdateArgs>)
  | ({ action: "delete" } & z.infer<typeof DeleteArgs>);

const scheduledMessagesTool = {
  name: "whatsapp_scheduled_messages" as const,
  description: [
    "List, retrieve, update, or cancel a previously-scheduled WhatsApp message.",
    "Available actions:",
    "  - list: list the user's scheduled (not-yet-sent) messages, newest first (cursor pagination)",
    "  - get: retrieve one scheduled message by id",
    "  - update: change text, media, or send_at on an existing scheduled message",
    "  - delete: cancel (soft-delete) a scheduled message",
    "",
    "Notes:",
    "  - The user owns each scheduled message; cross-user access is forbidden by the API and returns 404.",
    "  - send_at is ISO 8601 datetime. Call whatsapp_utils.current_date_time to anchor relative references like \"tomorrow at 9am\".",
    "  - Cancelled messages are not returned by `list` — soft-delete is final from the LLM's perspective.",
    "",
    "Examples:",
    "  - list: 'show me my scheduled messages'",
    "  - update: 'reschedule msg_abc to send tomorrow at 5pm'",
    "  - delete: 'cancel my scheduled message msg_abc'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    list: { readOnlyHint: true },
    get: { readOnlyHint: true },
    update: {},
    delete: { destructiveHint: true },
  },
  async dispatch(input: ScheduledMessagesInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "list":
          data = await client.scheduledMessages.list({
            ...(input.limit !== undefined && { limit: input.limit }),
            ...(input.cursor !== undefined && { cursor: input.cursor }),
          });
          break;
        case "get":
          data = await client.scheduledMessages.get(input.message_id);
          break;
        case "update":
          data = await client.scheduledMessages.update(input.message_id, {
            ...(input.text !== undefined && { text: input.text }),
            ...(input.media_url !== undefined && { media_url: input.media_url }),
            ...(input.media_caption !== undefined && { media_caption: input.media_caption }),
            ...(input.send_at !== undefined && { send_at: input.send_at }),
          });
          break;
        case "delete":
          data = await client.scheduledMessages.delete(input.message_id);
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default scheduledMessagesTool;

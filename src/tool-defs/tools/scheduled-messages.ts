import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const SendArgs = z
  .object({
    to: z.string().min(3),
    text: z.string().optional(),
    media_url: z.string().url().optional(),
    media_caption: z.string().optional(),
    // Send a poll. Mutually exclusive with text/media_url. WhatsApp
    // poll questions cap at 255 chars; option labels at 100 chars; up
    // to 12 options. Validation lives at the /v1 send endpoint.
    poll: z
      .object({
        question: z.string().min(1).max(255),
        options: z.array(z.string().min(1).max(100)).min(2).max(12),
        allow_multiple: z.boolean().optional(),
      })
      .strict()
      .optional(),
    send_at: z.string().datetime().optional(),
  })
  .strict();

const GetArgs = z.object({ id: z.string() }).strict();

// Lifecycle status filter — the 2.0 MessageStatus set. `pending` covers
// queued-but-not-yet-dispatched; the rest are dispatch/delivery states.
const StatusEnum = z.enum([
  "pending",
  "before-wa-send",
  "bt-sent",
  "sending",
  "sent",
  "sent_pending_ack",
  "confirmed",
  "delivered",
  "received",
  "read",
  "played",
  "cancelled",
  "error",
  "failed",
  "expired",
]);

const ListArgs = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).optional(),
    chat_id: z.string().optional(),
    status: StatusEnum.optional(),
  })
  .strict();

const UpdateArgs = z
  .object({
    id: z.string(),
    text: z.string().min(1).optional(),
    media_url: z.string().url().optional(),
    media_caption: z.string().optional(),
    send_at: z.string().datetime().optional(),
  })
  .strict();

const CancelArgs = z.object({ id: z.string() }).strict();

const AckArgs = z
  .object({
    // Each entry is a WhatsApp wire message key (e.g.
    // `false_12345@c.us_3EB0...`) — NOT the internal message `id`
    // returned by `send`. Pull these from the `waMessageKey` field on the
    // response of `scheduled_messages.get` (or `list`), or from
    // `chats.list_messages`. The key is null on a freshly-`pending`
    // message — wait for the lifecycle to advance before ack-checking.
    message_keys: z.array(z.string().min(1)).min(1).max(200),
  })
  .strict();

const actions = {
  send: SendArgs,
  get: GetArgs,
  list: ListArgs,
  update: UpdateArgs,
  cancel: CancelArgs,
  ack: AckArgs,
};

type MessagesInput =
  | ({ action: "send" } & z.infer<typeof SendArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "update" } & z.infer<typeof UpdateArgs>)
  | ({ action: "cancel" } & z.infer<typeof CancelArgs>)
  | ({ action: "ack" } & z.infer<typeof AckArgs>);

const messagesTool = {
  name: "scheduled_messages" as const,
  description: [
    "Send, list, edit, cancel, or look up the status of WhatsApp messages.",
    "Available actions:",
    "  - send: send a message now (or schedule for later via send_at). Use",
    "    `text` for plain text, `media_url` (+ optional `media_caption`) for",
    "    image/video/document, or `poll: {question, options, allow_multiple?}`",
    "    for a WhatsApp poll. The three are mutually exclusive.",
    "  - get: retrieve a single message by id",
    "  - list: list messages, newest first (offset pagination via limit/skip).",
    "    Optionally filter by `chat_id` (recipient JID) and/or `status` — use",
    "    `status: 'pending'` to see queued, not-yet-sent messages.",
    "  - update: edit a pending message that hasn't dispatched yet. Accepts",
    "    `text`, `media_url`, `media_caption`, `send_at` (any subset).",
    "  - cancel: cancel a pending message that hasn't dispatched yet.",
    "  - ack: batch lookup of delivery + read acknowledgements for up to 200 message keys",
    "",
    "Identifier model (important for chaining send → ack):",
    "  - `id` is the internal Blueticks message id, returned by `send` and",
    "    accepted by `get`/`update`/`cancel`. Use it to look up message status.",
    "  - `waMessageKey` is the WhatsApp wire message key, populated by the",
    "    engine once the message is dispatched. Use its `_serialized` form for",
    "    `ack` here and for every `chats` per-message endpoint. It is null on a",
    "    freshly-pending message — call `get` after status advances to obtain it.",
    "",
    "Examples:",
    "  - send: 'message 972544325389@c.us — your appointment is tomorrow at 10am'",
    "  - get: 'what\\'s the status of message msg_abc?'",
    "  - list: 'show me my scheduled messages' (status: 'pending')",
    "  - update: 'reschedule msg_abc to send tomorrow at 5pm'",
    "  - cancel: 'cancel my scheduled message msg_abc'",
    "  - ack: 'were these 3 messages read?' (message_keys come from get/list)",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    send: {},
    get: { readOnlyHint: true },
    list: { readOnlyHint: true },
    update: {},
    cancel: { destructiveHint: true },
    ack: { readOnlyHint: true },
  },
  async dispatch(input: MessagesInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "send": {
          // 2.0: the recipient is a path param and the body is a flat,
          // `type`-discriminated object. Media captions ride on `text`.
          const sendAt =
            input.send_at !== undefined ? { sendAt: input.send_at } : {};
          if (input.poll) {
            data = await client.scheduledMessages.create(input.to, {
              type: "poll",
              pollQuestion: input.poll.question,
              pollOptions: input.poll.options,
              ...(input.poll.allow_multiple !== undefined && {
                pollAllowMultiple: input.poll.allow_multiple,
              }),
              ...sendAt,
            });
          } else if (input.media_url !== undefined) {
            data = await client.scheduledMessages.create(input.to, {
              type: "media",
              mediaUrl: input.media_url,
              ...(input.media_caption !== undefined && { text: input.media_caption }),
              ...sendAt,
            });
          } else {
            data = await client.scheduledMessages.create(input.to, {
              type: "text",
              ...(input.text !== undefined && { text: input.text }),
              ...sendAt,
            });
          }
          break;
        }
        case "get":
          data = await client.scheduledMessages.retrieve(input.id);
          break;
        case "list":
          data = await client.scheduledMessages.list({
            ...(input.limit !== undefined && { limit: input.limit }),
            ...(input.skip !== undefined && { skip: input.skip }),
            ...(input.chat_id !== undefined && { chatId: input.chat_id }),
            ...(input.status !== undefined && { status: input.status }),
          });
          break;
        case "update": {
          // UpdateScheduledMessageBody has no caption field — a media
          // caption edit maps onto `text` (as at send time).
          const text = input.text ?? input.media_caption;
          data = await client.scheduledMessages.update(input.id, {
            ...(text !== undefined && { text }),
            ...(input.media_url !== undefined && { mediaUrl: input.media_url }),
            ...(input.send_at !== undefined && { sendAt: input.send_at }),
          });
          break;
        }
        case "cancel":
          // 2.0: cancelling a queued message is a DELETE.
          data = await client.scheduledMessages.delete(input.id);
          break;
        case "ack":
          // Batch ack lookup lives on the `messages` resource in 2.0.
          data = await client.messages.batchAcks({ messageKeys: input.message_keys });
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default messagesTool;

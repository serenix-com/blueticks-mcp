import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const SendArgs = z
  .object({
    to: z.string().min(3),
    text: z.string().optional(),
    media_url: z.string().url().optional(),
    // Inline media without a hosted URL: base64 bytes (bare or a data: URL).
    // `media_mime_type` sets the content-type for a BARE base64 string.
    media_base64: z.string().optional(),
    media_kind: z.enum(["image", "video", "audio", "document", "sticker", "voice", "gif"]).optional(),
    media_mime_type: z.string().optional(),
    media_filename: z.string().optional(),
    media_caption: z.string().optional(),
    // BE#253 — participant JIDs to @mention in a group send. Sets the real
    // WhatsApp mention (highlight + notification); write the visible @name in `text`.
    mentions: z.array(z.string()).optional()
      .describe('Participant JIDs to @mention in a group (e.g. ["12025550101@c.us"]).'),
    // Send a poll. Mutually exclusive with text/media_url. WhatsApp
    // poll questions cap at 255 chars; option labels at 100 chars; up
    // to 12 options. Validation lives at /v1/messages.
    poll: z
      .object({
        question: z.string().min(1).max(255),
        options: z.array(z.string().min(1).max(100)).min(2).max(12),
        allow_multiple: z.boolean().optional(),
      })
      .strict()
      .optional(),
    send_at: z.string().datetime({ offset: true }).optional(),
    // #734 — repeat the scheduled message (requires send_at; exactly one of ends_after / ends_on).
    recurrence: z
      .object({
        frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
        interval: z.number().int().min(1).max(365).optional(),
        by_weekday: z.array(z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"])).min(1).max(7).optional(),
        ends_after: z.number().int().min(1).max(366).optional(),
        ends_on: z.string().datetime({ offset: true }).optional(),
        timezone: z.string().min(1).max(64).optional(),
      })
      .strict()
      .optional(),
    from: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe('WhatsApp number to send from (e.g. "+15550001234"). Must be a connected number: a match is honoured, a mismatch is rejected (409 SENDER_MISMATCH, naming the valid number) and nothing is sent. Omit for the default connection.'),
    // #194 — display name for the recipient, shown in the scheduled-message
    // list. Optional; resolved automatically when omitted.
    recipient_name: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        'Display name for the recipient, shown in the scheduled-message list. Optional — when omitted, it is resolved automatically.',
      ),
  })
  .strict();

const GetArgs = z.object({ id: z.string() }).strict();

const ListArgs = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
    chat_id: z.string().optional(),
    status: z
      .enum(['pending', 'confirmed', 'received', 'read', 'played', 'failed'])
      .optional(),
    // #741 — a sent scheduled message is soft-deleted, so it is hidden by default.
    include_sent: z
      .boolean()
      .optional()
      .describe(
        'Include messages already SENT (default false). A cancelled message is never ' +
          'included. Pair with chat_id to answer "what has this contact already been sent?".',
      ),
    // #741 — the preview thumbnail is an ~83 KB embedded image per row; omitted by default.
    include_preview: z
      .boolean()
      .optional()
      .describe(
        'Include the link-preview thumbnail image (default false). Title/description/url are ' +
          'always returned — only the embedded image is omitted, to keep a 200-row page small.',
      ),
  })
  .strict();

const UpdateArgs = z
  .object({
    id: z.string(),
    text: z.string().min(1).optional(),
    media_url: z.string().url().optional(),
    media_caption: z.string().optional(),
    send_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const CancelArgs = z.object({ id: z.string() }).strict();

const AckArgs = z
  .object({
    // Each entry is a WhatsApp wire message key (e.g.
    // `false_12345@c.us_3EB0...`) — NOT the internal message `id`
    // returned by `send`. Pull these from `waMessageKey._serialized` on the
    // response of `scheduled_messages.get` (or `list`), or from
    // `chats.list_messages`. `waMessageKey` is null on a
    // freshly-`pending` message — wait for the lifecycle to advance to
    // `confirmed`/`received` before you can ack-check.
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
    "  - send: send a message now (or schedule for later via send_at; add recurrence {frequency daily|weekly|monthly|yearly, interval?, by_weekday?, ends_after|ends_on, timezone?} to repeat it). Use",
    "    `text` for plain text, `media_url` for image/video/document, or",
    "    `poll: {question, options, allow_multiple?}` for a WhatsApp poll.",
    "    The three are mutually exclusive — exactly one of text/media/poll.",
    "    Optionally pass `recipient_name` to set the label shown in the",
    "    scheduled-message list; omit it to have it resolved automatically.",
    "  - get: retrieve a single message by id",
    "  - list: list messages, newest first (cursor pagination). Optionally",
    "    filter by `chat_id` (recipient JID) and/or `status` — use",
    "    `status: 'pending'` to see accepted, not-yet-sent messages. A message that has",
    "    already been SENT is hidden by default (it is soft-deleted once delivered) — pass",
    "    `include_sent: true` to see it. Cancelled messages are never returned.",
    "    `status: 'pending'` to see accepted, not-yet-sent messages. Responses omit the",
    "    link-preview thumbnail image by default (pass `include_preview: true` for it) and",
    "    carry `nextCursor` — feed that back as `cursor` for the next page.",
    "    Every row carries `to` (the recipient: a WhatsApp JID for messages created in the",
    "    Blueticks UI, or the raw recipient you passed for a send you made through this API)",
    "    and `recipientName` (the display name, or null when unlabelled). Use `to` to match a",
    "    patient/contact when checking for an existing reminder.",
    "  - update: edit a queued message that hasn't dispatched yet. Accepts",
    "    `text`, `media_url`, `media_caption`, `send_at` (any subset).",
    "  - cancel: cancel a queued message that hasn't dispatched yet.",
    "  - ack: batch lookup of delivery + read acknowledgements for up to 200 message keys",
    "",
    "Identifier model (important for chaining send → ack):",
    "  - `id` is the internal Blueticks message id, returned by `send` and",
    "    accepted by `get`/`update`/`cancel`. Use it to look up message status",
    "    / lifecycle.",
    "  - `waMessageKey._serialized` is the WhatsApp wire message key (e.g.",
    "    `false_12345@c.us_3EB0...`), populated by the engine once the message",
    "    is dispatched. Use it for",
    "    `ack` here, and for every `chats` per-message endpoint",
    "    (`messages.{key}`, `messages.{key}.media`, etc.). It is null on a",
    "    freshly-queued message (`waMessageKey` is null) — call `get` after status advances to",
    "    `confirmed`/`received` to obtain it.",
    "",
    "Examples:",
    "  - send: 'message +972544325389 — your appointment is tomorrow at 10am'",
    "  - get: 'what\\'s the status of message msg_abc?'",
    "  - list: 'show me my scheduled messages' (status: 'pending')",
    "  - update: 'reschedule msg_abc to send tomorrow at 5pm'",
    "  - cancel: 'cancel my scheduled message msg_abc'",
    "  - ack: 'were these 3 messages read?' (message_keys come from get/list `waMessageKey._serialized`)",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  // Per-action argument schemas (clients that expose one tool per action).
  actionSchemas: actions,
  annotations: {
    send: {},
    get: { readOnlyHint: true },
    list: { readOnlyHint: true },
    update: {},
    cancel: { destructiveHint: true },
    ack: { readOnlyHint: true },
  },
  parse(input: unknown): MessagesInput {
    const { action, ...args } = z.object({ action: z.string() }).passthrough().parse(input);
    switch (action) {
      case "send": return { action, ...actions.send.parse(args) };
      case "get": return { action, ...actions.get.parse(args) };
      case "list": return { action, ...actions.list.parse(args) };
      case "update": return { action, ...actions.update.parse(args) };
      case "cancel": return { action, ...actions.cancel.parse(args) };
      case "ack": return { action, ...actions.ack.parse(args) };
      default: throw new Error("Unsupported tool action");
    }
  },
  async dispatch(input: MessagesInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "send":
          data = await client.messages.send({
            to: input.to,
            text: input.text,
            media_url: input.media_url,
            ...(input.media_base64 !== undefined && { media_base64: input.media_base64 }),
            ...(input.media_kind !== undefined && { media_kind: input.media_kind }),
            ...(input.media_mime_type !== undefined && { media_mime_type: input.media_mime_type }),
            ...(input.media_filename !== undefined && { media_filename: input.media_filename }),
            media_caption: input.media_caption,
            // Zod's optional-on-wrapper inference loses inner-field
            // requiredness in some TS pipelines, so surface the
            // shape explicitly when the caller passed a poll object.
            ...(input.poll
              ? {
                  poll: {
                    question: input.poll.question!,
                    options: input.poll.options!,
                    allow_multiple: input.poll.allow_multiple,
                  },
                }
              : {}),
            send_at: input.send_at,
            ...(input.recurrence !== undefined && { recurrence: input.recurrence }),
            from: input.from,
            recipient_name: input.recipient_name,
            mentions: input.mentions,
          });
          break;
        case "get":
          data = await client.messages.get(input.id);
          break;
        case "list":
          data = await client.messages.list({
            ...(input.limit !== undefined && { limit: input.limit }),
            ...(input.cursor !== undefined && { cursor: input.cursor }),
            ...(input.chat_id !== undefined && { chat_id: input.chat_id }),
            ...(input.status !== undefined && { status: input.status }),
            ...(input.include_sent !== undefined && { include_sent: input.include_sent }),
            ...(input.include_preview !== undefined && { include_preview: input.include_preview }),
          });
          break;
        case "update":
          data = await client.messages.update(input.id, {
            ...(input.text !== undefined && { text: input.text }),
            ...(input.media_url !== undefined && { media_url: input.media_url }),
            ...(input.media_caption !== undefined && { media_caption: input.media_caption }),
            ...(input.send_at !== undefined && { send_at: input.send_at }),
          });
          break;
        case "cancel":
          data = await client.messages.cancel(input.id);
          break;
        case "ack":
          // Batch ack lookup lives on the chats resource in the SDK
          // (v3.4.x): each key is `false_<jid>_<id>`, addressable by chat.
          data = await client.chats.batchMessageAcks({ message_keys: input.message_keys });
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default messagesTool;

import { z } from "zod";
import type { BlueticksSurface } from "../blueticks-surface";
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
    // to 12 options. Validation lives at /v1/messages.
    poll: z
      .object({
        question: z.string().min(1).max(255),
        options: z.array(z.string().min(1).max(100)).min(2).max(12),
        allow_multiple: z.boolean().optional(),
      })
      .strict()
      .optional(),
    send_at: z.string().datetime().optional(),
    from: z.string().optional(),
  })
  .strict();

const GetArgs = z.object({ id: z.string() }).strict();

const ListArgs = z
  .object({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().optional() })
  .strict();

const AckArgs = z
  .object({
    // Each entry is a WhatsApp wire message key (e.g.
    // `false_12345@c.us_3EB0...`) — NOT the internal message `id`
    // returned by `send`. Pull these from the `key` field on the
    // response of `whatsapp_messages.get` (or `list`), or from
    // `whatsapp_chats.list_messages`. The `key` is null on a
    // freshly-`queued` message — wait for the lifecycle to advance to
    // `sending`/`delivered` before you can ack-check.
    message_keys: z.array(z.string().min(1)).min(1).max(200),
  })
  .strict();

const actions = { send: SendArgs, get: GetArgs, list: ListArgs, ack: AckArgs };

type MessagesInput =
  | ({ action: "send" } & z.infer<typeof SendArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "ack" } & z.infer<typeof AckArgs>);

const messagesTool = {
  name: "whatsapp_messages" as const,
  description: [
    "Send WhatsApp messages or look up previously sent ones.",
    "Available actions:",
    "  - send: send a message now (or schedule for later via send_at). Use",
    "    `text` for plain text, `media_url` for image/video/document, or",
    "    `poll: {question, options, allow_multiple?}` for a WhatsApp poll.",
    "    The three are mutually exclusive — exactly one of text/media/poll.",
    "  - get: retrieve a single message by id",
    "  - list: list previously sent messages, newest first (cursor pagination)",
    "  - ack: batch lookup of delivery + read acknowledgements for up to 200 message keys",
    "",
    "Identifier model (important for chaining send → ack):",
    "  - `id` is the internal Blueticks message id, returned by `send` and",
    "    accepted by `get`. Use it to look up message status / lifecycle.",
    "  - `key` is the WhatsApp wire message key (e.g. `false_12345@c.us_3EB0...`),",
    "    populated by the engine once the message is dispatched. Use it for",
    "    `ack` here, and for every `whatsapp_chats` per-message endpoint",
    "    (`messages.{key}`, `messages.{key}.media`, etc.). It is null on a",
    "    freshly-queued message — call `get` after status advances to",
    "    `sending`/`delivered` to obtain it.",
    "",
    "Examples:",
    "  - send: 'message +972544325389 — your appointment is tomorrow at 10am'",
    "  - get: 'what\\'s the status of message msg_abc?'",
    "  - list: 'show me the last 20 messages'",
    "  - ack: 'were these 3 messages read?' (message_keys come from get/list `key` field)",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    send: {},
    get: { readOnlyHint: true },
    list: { readOnlyHint: true },
    ack: { readOnlyHint: true },
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
            from: input.from,
          });
          break;
        case "get":
          data = await client.messages.get(input.id);
          break;
        case "list":
          data = await client.messages.list({
            limit: input.limit,
            cursor: input.cursor,
          });
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

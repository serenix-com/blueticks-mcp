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
    send_at: z.string().datetime().optional(),
    from: z.string().optional(),
  })
  .strict();

const GetArgs = z.object({ id: z.string() }).strict();

const ListArgs = z
  .object({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().optional() })
  .strict();

const AckArgs = z
  .object({ message_keys: z.array(z.string().min(1)).min(1).max(200) })
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
    "  - send: send a message now (or schedule for later via send_at)",
    "  - get: retrieve a single message by id",
    "  - list: list previously sent messages, newest first (cursor pagination)",
    "  - ack: batch lookup of delivery + read acknowledgements for up to 200 message keys",
    "",
    "Examples:",
    "  - send: 'message +972544325389 — your appointment is tomorrow at 10am'",
    "  - get: 'what\\'s the status of message msg_abc?'",
    "  - list: 'show me the last 20 messages'",
    "  - ack: 'were these 3 messages read? keys=[k1, k2, k3]'",
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
          data = await client.messages.ack({ message_keys: input.message_keys });
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default messagesTool;

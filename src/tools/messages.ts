import { z } from "zod";
import type { Blueticks } from "blueticks";
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

const actions = { send: SendArgs, get: GetArgs, list: ListArgs };

type MessagesInput =
  | ({ action: "send" } & z.infer<typeof SendArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "list" } & z.infer<typeof ListArgs>);

const messagesTool = {
  name: "whatsapp_messages" as const,
  description: [
    "Send WhatsApp messages or look up previously sent ones.",
    "Available actions:",
    "  - send: send a message now (or schedule for later via send_at)",
    "  - get: retrieve a single message by id",
    "  - list: list previously sent messages, newest first (cursor pagination)",
    "",
    "Examples:",
    "  - send: 'message +972544325389 — your appointment is tomorrow at 10am'",
    "  - get: 'what\\'s the status of message msg_abc?'",
    "  - list: 'show me the last 20 messages'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    send: {},
    get: { readOnlyHint: true },
    list: { readOnlyHint: true },
  },
  async dispatch(input: MessagesInput, client: Blueticks): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "send": {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { action: _, ...body } = input;
          data = await client.messages.send(body);
          break;
        }
        case "get":
          data = await client.messages.get(input.id);
          break;
        case "list": {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { action: _, ...query } = input;
          data = await client.messages.list(query);
          break;
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default messagesTool;

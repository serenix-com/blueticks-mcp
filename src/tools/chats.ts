import { z } from "zod";
import type { BlueticksSurface } from "../blueticks-surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const ChatId = z.string().min(3);

const ListArgs = z
  .object({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().optional() })
  .strict();

const SearchArgs = z
  .object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  })
  .strict();

const GetArgs = z.object({ chat_id: ChatId }).strict();

const MessageTypeEnum = z.enum([
  "chat",
  "image",
  "video",
  "document",
  "audio",
  "ptt",
  "sticker",
  "gif",
  "ptv",
  "poll_creation",
  "location",
  "vcard",
  "revoked",
]);

const ListMessagesArgs = z
  .object({
    chat_id: ChatId,
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
    // The backend (chats.listMessages) accepts these; MCP exposes them so
    // the LLM can search/scope by date without a follow-up call.
    mode: z.enum(["latest", "history"]).optional(),
    query: z.string().min(1).max(200).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    // Filter to specific message kinds — e.g. ["document"] for PDFs,
    // ["image"] for photos. System events (gp2/revoked/newsletter_-
    // notification) are excluded by default unless explicitly listed.
    message_types: z.array(MessageTypeEnum).optional(),
  })
  .strict();

const MarkReadArgs = z.object({ chat_id: ChatId }).strict();

const GetMediaArgs = z
  .object({
    chat_id: ChatId,
    key: z.string().min(1),
  })
  .strict();

const actions = {
  list: ListArgs,
  search: SearchArgs,
  get: GetArgs,
  list_messages: ListMessagesArgs,
  mark_read: MarkReadArgs,
  get_media: GetMediaArgs,
};

type ChatsInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "search" } & z.infer<typeof SearchArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "list_messages" } & z.infer<typeof ListMessagesArgs>)
  | ({ action: "mark_read" } & z.infer<typeof MarkReadArgs>)
  | ({ action: "get_media" } & z.infer<typeof GetMediaArgs>);

/** Strip keys whose value is undefined so SDK param objects stay clean. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

const chatsTool = {
  name: "whatsapp_chats" as const,
  description: [
    "Read WhatsApp chats and the messages inside them on the connected engine.",
    "Available actions:",
    "  - list: list chats, newest message first (cursor pagination)",
    "  - search: list chats matching a name/keyword query",
    "  - get: retrieve a single chat by chat_id (e.g. 972544325389@c.us)",
    "  - list_messages: list messages inside a chat",
    "  - mark_read: mark all messages in a chat as read",
    "  - get_media: download media bytes for one message — returns",
    "      url/data_base64 + mimetype/filename + original_quality flag",
    "      (false when WA returned a preview rather than the original;",
    "      currently only happens for own-sent newsletter media).",
    "",
    "Examples:",
    "  - list: 'show me my recent chats'",
    "  - search: 'find chats with noam'",
    "  - list_messages: 'last 20 messages with +972544325389'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    list: { readOnlyHint: true },
    search: { readOnlyHint: true },
    get: { readOnlyHint: true },
    list_messages: { readOnlyHint: true },
    mark_read: {},
    get_media: { readOnlyHint: true },
  },
  async dispatch(input: ChatsInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "list": {
          const { action: _action, ...query } = input;
          data = await client.chats.list(compact(query));
          break;
        }
        case "search": {
          // ListChatsParams uses `query` (not `search`) as the SDK field name
          const { query, limit, cursor } = input;
          data = await client.chats.list(compact({ query, limit, cursor }));
          break;
        }
        case "get":
          data = await client.chats.get(input.chat_id);
          break;
        case "list_messages": {
          const { chat_id, limit, cursor, mode, query, since, until, message_types } = input;
          data = await client.chats.listMessages(
            chat_id,
            compact({ limit, cursor, mode, query, since, until, message_types }),
          );
          break;
        }
        case "mark_read":
          data = await client.chats.markRead(input.chat_id);
          break;
        case "get_media":
          data = await client.chats.getMedia(input.chat_id, input.key);
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default chatsTool;

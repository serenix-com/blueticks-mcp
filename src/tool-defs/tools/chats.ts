import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const ChatId = z.string().min(3);

const ListArgs = z
  .object({
    limit: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).optional(),
    // Archived chats are excluded by default. Set true to include them — e.g.
    // to locate a chat you previously archived so you can unarchive it.
    include_archive: z.boolean().optional(),
  })
  .strict();

const SearchArgs = z
  .object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).optional(),
    // Archived chats are excluded from search by default. Set true to find a
    // chat that is currently archived (e.g. before unarchiving it).
    include_archive: z.boolean().optional(),
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
    skip: z.number().int().min(0).optional(),
    // 2.0 offset-paginates and orders via `order` (was `mode`).
    order: z.enum(["asc", "desc"]).optional(),
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

const GetParticipantsArgs = z.object({ chat_id: ChatId }).strict();

const LoadMoreHistoryArgs = z.object({ chat_id: ChatId }).strict();

const ArchiveArgs = z.object({ chat_id: ChatId }).strict();

const UnarchiveArgs = z.object({ chat_id: ChatId }).strict();

// send_message body — the MCP shape stays nested (text/media/poll) as the
// LLM-facing contract; the dispatcher flattens it into the 2.0 SDK's
// `DirectSendMessageBody` (a flat, `type`-discriminated object) before
// calling `messages.send(chatId, body)`. The `type` field is derived from
// the action name in dispatch, so it's optional on the wire — the model
// needn't send it (and can't get it wrong).
const SendMessageTextArgs = z
  .object({
    chat_id: ChatId,
    type: z.literal("text").optional(),
    text: z.string().min(1).max(4096),
    reply_to: z.string().min(1).max(256).optional(),
  })
  .strict();

const SendMessageMediaArgs = z
  .object({
    chat_id: ChatId,
    // Derived from the action in dispatch — optional on the wire.
    type: z.literal("media").optional(),
    media: z
      .object({
        url: z.string().url().max(2048).optional(),
        data_base64: z.string().optional(),
        kind: z
          .enum(["image", "video", "audio", "document", "sticker", "voice", "gif"])
          .optional(),
        caption: z.string().max(1024).optional(),
        filename: z.string().max(255).optional(),
      })
      .strict(),
    reply_to: z.string().min(1).max(256).optional(),
  })
  .strict();

const SendMessagePollArgs = z
  .object({
    chat_id: ChatId,
    // Derived from the action in dispatch — optional on the wire.
    type: z.literal("poll").optional(),
    poll: z
      .object({
        question: z.string().min(1).max(255),
        options: z.array(z.string().min(1).max(100)).min(2).max(12),
        allow_multiple: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

const actions = {
  list: ListArgs,
  search: SearchArgs,
  get: GetArgs,
  list_messages: ListMessagesArgs,
  mark_read: MarkReadArgs,
  archive: ArchiveArgs,
  unarchive: UnarchiveArgs,
  get_media: GetMediaArgs,
  get_participants: GetParticipantsArgs,
  load_more_history: LoadMoreHistoryArgs,
  send_message_text: SendMessageTextArgs,
  send_message_media: SendMessageMediaArgs,
  send_message_poll: SendMessagePollArgs,
};

type ChatsInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "search" } & z.infer<typeof SearchArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "list_messages" } & z.infer<typeof ListMessagesArgs>)
  | ({ action: "mark_read" } & z.infer<typeof MarkReadArgs>)
  | ({ action: "archive" } & z.infer<typeof ArchiveArgs>)
  | ({ action: "unarchive" } & z.infer<typeof UnarchiveArgs>)
  | ({ action: "get_media" } & z.infer<typeof GetMediaArgs>)
  | ({ action: "get_participants" } & z.infer<typeof GetParticipantsArgs>)
  | ({ action: "load_more_history" } & z.infer<typeof LoadMoreHistoryArgs>)
  | ({ action: "send_message_text" } & z.infer<typeof SendMessageTextArgs>)
  | ({ action: "send_message_media" } & z.infer<typeof SendMessageMediaArgs>)
  | ({ action: "send_message_poll" } & z.infer<typeof SendMessagePollArgs>);

/** Strip keys whose value is undefined so SDK param objects stay clean. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

const chatsTool = {
  name: "chats" as const,
  description: [
    "Read or send WhatsApp messages inside chats on the connected engine.",
    "Available actions:",
    "  - list: list chats, newest message first (offset pagination via limit/skip)",
    "  - search: list chats matching a name/keyword query.",
    "      Archived chats are excluded by default — pass include_archive=true",
    "      to find an archived chat (e.g. to get its chat_id before unarchive).",
    "  - get: retrieve a single chat by chat_id (e.g. 972544325389@c.us)",
    "  - list_messages: list messages inside a chat",
    "  - mark_read: mark all messages in a chat as read",
    "  - archive: archive a chat (hide it from the main chat list)",
    "  - unarchive: unarchive a chat (restore it to the main chat list)",
    "  - get_media: download media bytes for one message by its wire key —",
    "      returns url/data_base64 + mimetype/filename + original_quality flag",
    "      (false when WA returned a preview rather than the original;",
    "      currently only happens for own-sent newsletter media).",
    "  - get_participants: list the members of a group chat",
    "  - load_more_history: request OLDER history for ONE specific chat",
    "      (chat_id) from the phone, so a subsequent list_messages can page",
    "      further back. Each call pulls one page; call it again to go deeper.",
    "      Use it whenever a chat's loaded messages don't reach far enough",
    "      back for what you need.",
    "      Paced and limited: one request per chat at a time, WA-paced — a call",
    "      while that chat's request is in flight or cooling down returns",
    "      added:0 (not an error); wait and retry. While the initial sync is",
    "      still running the call throws a not_connected error. After repeated",
    "      unanswered requests WhatsApp history requests pause: the result's",
    "      `error` starts \"cooling_down:\" and says how long to wait — retry",
    "      after that, don't treat it as \"no history\".",
    "      canLoadMore:false = history is genuinely exhausted — stop paging.",
    "      A chat with no messages AND no chat activity on the engine (e.g. a",
    "      saved contact whose conversation WhatsApp's first sync never",
    "      delivered: `get` returns it with lastMessageAt null) has nothing",
    "      to page back from, so added stays 0. Once one message is sent or",
    "      received in that chat, its older history can be requested.",
    "  - send_message_text: send a text message NOW (fire-and-forget).",
    "      Body: {chat_id, type: \"text\", text}",
    "  - send_message_media: send an image/video/audio/document NOW.",
    "      Body: {chat_id, type: \"media\", media: {url, kind?, caption?, filename?}}",
    "  - send_message_poll: send a poll NOW.",
    "      Body: {chat_id, type: \"poll\", poll: {question, options[2..12], allow_multiple?}}",
    "",
    "  `type` is derived automatically from the action (\"text\"/\"media\"/\"poll\"),",
    "  so you don't need to send it; include it only if you want to be explicit.",
    "",
    "send_message_* is for IMMEDIATE delivery into a chat — use the",
    "`scheduled_messages` tool's `send` action to schedule a future send (with",
    "`send_at`) or to keep the message in a queue you can edit/cancel before",
    "dispatch.",
    "",
    "Examples:",
    "  - list: 'show me my recent chats'",
    "  - search: 'find chats with noam'",
    "  - list_messages: 'last 20 messages with 972544325389@c.us'",
    "  - send_message_text: 'reply hi to 972544325389@c.us'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    list: { readOnlyHint: true },
    search: { readOnlyHint: true },
    get: { readOnlyHint: true },
    list_messages: { readOnlyHint: true },
    mark_read: {},
    archive: {},
    unarchive: {},
    get_media: { readOnlyHint: true },
    get_participants: { readOnlyHint: true },
    load_more_history: {},
    send_message_text: {},
    send_message_media: {},
    send_message_poll: {},
  },
  async dispatch(input: ChatsInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "list": {
          // 2.0 chats.list is offset-paginated; archived chats are opt-in via
          // the camelCase `includeArchive` field.
          const { limit, skip, include_archive } = input;
          data = await client.chats.list(
            compact({ limit, skip, includeArchive: include_archive }),
          );
          break;
        }
        case "search": {
          // 2.0 chats.list names the name filter `searchToken`.
          const { query, limit, skip, include_archive } = input;
          data = await client.chats.list(
            compact({ searchToken: query, limit, skip, includeArchive: include_archive }),
          );
          break;
        }
        case "get":
          data = await client.chats.get(input.chat_id);
          break;
        case "list_messages": {
          // Message listing moved off `chats` onto the `messages` resource
          // in 2.0; the chat is passed as the `chatId` filter.
          const { chat_id, limit, skip, order, query, since, until, message_types } = input;
          data = await client.messages.list(
            compact({
              chatId: chat_id,
              limit,
              skip,
              order,
              searchToken: query,
              since,
              until,
              messageTypes: message_types,
            }),
          );
          break;
        }
        case "mark_read":
          data = await client.chats.markRead(input.chat_id);
          break;
        case "archive":
          data = await client.chats.archive(input.chat_id);
          break;
        case "unarchive":
          data = await client.chats.unarchive(input.chat_id);
          break;
        case "get_media":
          // 2.0: media lookup is keyed by the wire message key, with chatId
          // as an optional scoping hint.
          data = await client.messages.getMedia(input.key, { chatId: input.chat_id });
          break;
        case "get_participants":
          data = await client.chats.listParticipants(input.chat_id);
          break;
        case "load_more_history":
          data = await client.messages.loadOlder(input.chat_id);
          break;
        // The send_message_* `type` is fully determined by the action name, so
        // force it here rather than trusting the model to send it. The dispatcher
        // flattens the nested MCP body into the flat 2.0 `DirectSendMessageBody`.
        case "send_message_text":
          data = await client.messages.send(input.chat_id, {
            type: "text",
            text: input.text,
            ...(input.reply_to !== undefined && { replyTo: input.reply_to }),
          });
          break;
        case "send_message_media":
          // Flatten the nested MCP `media` object into the flat 2.0 body.
          // WhatsApp media captions ride on `text`.
          data = await client.messages.send(input.chat_id, {
            type: "media",
            ...(input.media.url !== undefined && { mediaUrl: input.media.url }),
            ...(input.media.data_base64 !== undefined && { mediaBase64: input.media.data_base64 }),
            ...(input.media.kind !== undefined && { mediaKind: input.media.kind }),
            ...(input.media.filename !== undefined && { mediaFilename: input.media.filename }),
            ...(input.media.caption !== undefined && { text: input.media.caption }),
            ...(input.reply_to !== undefined && { replyTo: input.reply_to }),
          });
          break;
        case "send_message_poll":
          data = await client.messages.send(input.chat_id, {
            type: "poll",
            pollQuestion: input.poll.question,
            pollOptions: input.poll.options,
            ...(input.poll.allow_multiple !== undefined && {
              pollAllowMultiple: input.poll.allow_multiple,
            }),
          });
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default chatsTool;

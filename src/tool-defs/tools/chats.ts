import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { compact } from "../surface-mapping";
import { toolErrorResult, type ToolResult } from "../errors";
import { MESSAGE_TYPE_VALUES } from "../message-types";

const ChatId = z.string().min(3);

/** Largest page the chat reads return. A bigger `limit` is clamped to this (and the response says so), not refused. */
export const CHATS_LIMIT_MAX = 200;
/** How to get past the first page, per action: `list`/`search` page with skip; `list_messages` pages with a numeric `cursor` (mapped to skip by mapListMessagesQuery). */
const PAGE_HINT_SKIP = 'Only the first page was returned. For more, pass skip=<skip+limit> (limit<=200) and repeat until skip+limit >= total.';
const PAGE_HINT_MESSAGES =
  'Only the newest 200 messages were returned. list_messages has no skip arg: page with cursor="<skip+limit>" (a number as a string, e.g. "200") and repeat until skip+limit >= total or hasMore is false. To bound by date use since/until.';

const limitArg = (howToPage: string) =>
  z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Page size, max ${CHATS_LIMIT_MAX}. A larger value is clamped to ${CHATS_LIMIT_MAX} and the result carries limitClamped {requested, applied, max, howToPage}. ${howToPage}`);

const ChatKindEnum = z.enum(["contact", "group", "newsletter"]);

// #1155: a read may name one of the account's WhatsApp numbers (`number`: its numberId or E.164 phone) and cap the
// fan-out over numbers (`fanout_limit`). Read actions only; sends pin the sender with `from`.
const numberTargetShape = {
  number: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .optional()
    .describe("Read one of this account's WhatsApp numbers, by its numberId or E.164 phone. 404 NUMBER_NOT_FOUND if it is not this account's; 409 NUMBER_OFFLINE if it has no engine online."),
  fanout_limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("With no number target, read at most this many of the account's numbers (default 5). Numbers over the cap are listed in skippedNumbers."),
};

const ListArgs = z
  .object({
    ...numberTargetShape,
    limit: limitArg(PAGE_HINT_SKIP),
    // Offset pagination (real, not a cursor fiction). The result echoes
    // {skip, limit, total}; to get the next page pass skip=<skip+limit>, and
    // stop once skip+limit >= total. Starts at 0.
    skip: z.number().int().min(0).optional(),
    // INCLUDE-style kind filter: keep only these chat kinds. Omit for all
    // kinds. e.g. ["contact"] to skip groups/newsletters when triaging DMs.
    kinds: z.array(ChatKindEnum).min(1).optional(),
    // Attach each chat's last-message preview (lastMessageText/lastMessageFromMe)
    // so you can triage "who is waiting on me" WITHOUT a per-chat messages call.
    include_last_message: z.boolean().optional(),
    // Activity cutoff (ISO 8601, offset allowed): keep only chats whose last
    // message is at/after this instant. skip/limit page over the FILTERED list
    // (newest first), so skip+limit is stable; the result carries sinceApplied:true
    // and total = matches among the chats scanned; scan:{scanned,engineTotal,truncated} reports the scan, and truncated:true (3000-row cap or time budget hit before reaching since) means older matches may exist so total is a lower bound.
    // Use for "chats active in the last week".
    since: z.string().datetime({ offset: true }).optional(),
    // NOT SUPPORTED on the chat list — accepted by the schema only so the call
    // fails with a TEACHING error instead of a cryptic strict-schema rejection.
    // Rationale: an upper bound on a chat's LAST activity is the wrong filter
    // for content windows — a chat whose last message came AFTER `until` can
    // still hold in-window messages and would be silently dropped. Filter the
    // list with `since` only, then apply `until` per chat on list_messages.
    until: z.string().datetime({ offset: true }).optional(),
    // Archived chats are excluded by default. Set true to include them — e.g.
    // to locate a chat you previously archived so you can unarchive it.
    include_archive: z.boolean().optional(),
  })
  .strict();

// Engine-targeted reads (override BE#302 read-preference). `engine` is the
// connection TYPE (same values as the engine `status` endpoint); `engine_id` is
// an exact presence clientId (from `status.id`) and wins over `engine`. Absent =
// default routing (unchanged). If the requested engine isn't online the read
// returns 409 ENGINE_NOT_ONLINE. Spread into every read action.
const engineTargetShape = {
  engine: z
    .enum(["gateway", "regular"])
    .optional()
    .describe(
      'Force this read to a specific engine TYPE: "gateway" (server-side pod, e.g. Baileys) or "regular" (browser extension). Overrides the default dual-engine read preference — needed to reach a pod when a browser extension is also connected. 409 ENGINE_NOT_ONLINE if none of that type is online.',
    ),
  engine_id: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Exact engine clientId to target (from engine status `id`); wins over `engine`."),
};

// Sender selection for the immediate sends. `engine` / `engine_id` pin the engine that sends (409 ENGINE_NOT_ONLINE if
// it is not online); `from` is the WhatsApp NUMBER to send from: a connected number is honoured, anything else is a
// 409 SENDER_MISMATCH naming the valid number(s). Nothing is ever sent from a different number than requested.
const sendSenderShape = {
  ...engineTargetShape,
  from: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'WhatsApp number to send from (e.g. "+15550001234"). Must be a connected number: a match is honoured, a mismatch is rejected (SENDER_MISMATCH, naming the valid number) and nothing is sent. Omit for the default connection.',
    ),
};

// Field names mirror the engine tool `waGetLatestChatsAndMessagesTool` 1:1
// (numberOfChats / numberOfMessages) — no rename across API/tool/agent layers.
const GetLatestArgs = z
  .object({
    numberOfChats: z.number().int().min(1).max(200).optional(),
    numberOfMessages: z.number().int().min(0).max(100).optional(),
    ...engineTargetShape,
    ...numberTargetShape,
  })
  .strict();

const SearchArgs = z
  .object({
    query: z.string().min(1),
    limit: limitArg(PAGE_HINT_SKIP),
    // Offset pagination — same semantics as `list`: pass skip=<skip+limit> for
    // the next page; stop when skip+limit >= total.
    skip: z.number().int().min(0).optional(),
    // Archived chats are excluded from search by default. Set true to find a
    // chat that is currently archived (e.g. before unarchiving it).
    include_archive: z.boolean().optional(),
    ...engineTargetShape,
    ...numberTargetShape,
  })
  .strict();

const GetArgs = z.object({ chat_id: ChatId, ...engineTargetShape, ...numberTargetShape }).strict();

// Single source: legacy v1 names + WA Web names (src/services/api/v1/lib/message-types.ts).
const MessageTypeEnum = z.enum(MESSAGE_TYPE_VALUES);

const ListMessagesArgs = z
  .object({
    // Single-chat read. Provide EITHER chat_id (one chat) OR chat_ids (batch).
    chat_id: ChatId.optional(),
    // Batch read: inspect up to 25 chats in ONE call (backend loops them
    // sequentially, WA-paced, and returns {chats:[{chatId, messages, coverage,
    // autoLoadedPages}]}). Prefer this over N separate list_messages calls when
    // scanning multiple chats. All the other args (limit/since/until/…) apply to
    // every chat in the batch; per-chat `limit` defaults to 20 when batched.
    chat_ids: z.array(ChatId).min(1).max(25).optional(),
    // Batch-only wall-time budget in ms (remaining, measured from batch start;
    // default 120000). When exceeded, unprocessed chats come back as
    // {chatId, skipped:true, reason:"deadline"} entries — report those as NOT
    // covered rather than assuming they were scanned. Ignored for single-chat.
    deadline_ms: z.number().int().min(1000).max(600_000).optional(),
    limit: limitArg(PAGE_HINT_MESSAGES),
    cursor: z.string().optional().describe('Offset for the next page of a chat\'s messages: a number as a string, = previous skip+limit ("200" for the second page of 200). Non-numeric values are ignored (page 0).'),
    // The backend (chats.listMessages) accepts these; MCP exposes them so
    // the LLM can search/scope by date without a follow-up call.
    mode: z.enum(["latest", "history"]).optional(),
    query: z.string().min(1).max(200).optional(),
    // Keyword-set OR search: a message matches if body/caption/filename
    // contains ANY of these terms (case-insensitive). Combined with `query`
    // when both are present. Runs in ONE pass — use it for credential/invoice
    // hunts (e.g. ["ftp","sftp","host","password"]) instead of N separate calls.
    query_any: z.array(z.string().min(1).max(200)).min(1).max(24).optional(),
    // ISO 8601; timezone offsets accepted (e.g. "2026-07-04T00:00:00+03:00" —
    // what current_date_time's local window fields carry).
    since: z.string().datetime({ offset: true }).optional(),
    until: z.string().datetime({ offset: true }).optional(),
    // Filter to specific message kinds — e.g. ["document"] for PDFs,
    // ["image"] for photos. System events (gp2/revoked/newsletter_-
    // notification) are excluded by default unless explicitly listed.
    message_types: z.array(MessageTypeEnum).optional(),
    // Media/document filters (invoice/document hunts). Combine freely with
    // query / query_any / message_types.
    //   mime: prefix match on the media MIME type — "application/pdf" for PDFs,
    //         "image/" for any image, "audio/" for any voice/audio.
    //   filename_contains: case-insensitive substring of the document filename.
    //   has_media: true = only messages with a downloadable attachment;
    //              false = only text/non-media.
    //   sender: case-insensitive substring of the sender's JID/phone.
    mime: z.string().min(1).max(255).optional(),
    filename_contains: z.string().min(1).max(255).optional(),
    has_media: z.boolean().optional(),
    sender: z.string().min(1).max(128).optional(),
    ...engineTargetShape,
  })
  .strict();

const MarkReadArgs = z.object({ chat_id: ChatId }).strict();

const GetMediaArgs = z
  .object({
    chat_id: ChatId,
    // #578 — `key` is the MESSAGE identity, not a chat id: pass the
    // `waMessageKey._serialized` string from a list_messages row (e.g.
    // "false_972…@c.us_3EB0…"). The bare message id or a chat_id will not resolve.
    key: z
      .string()
      .min(1)
      .describe(
        "The target message's waMessageKey._serialized (from a list_messages row), " +
          "e.g. 'false_972544325389@c.us_3EB0ABCDEF'. Not the bare id and not a chat_id.",
      ),
    ...engineTargetShape,
  })
  .strict();

// BE#844 — react to a message (wraps POST /v1/messages/reactions/{key}?chatId= {emoji}).
// Empty emoji clears the caller's existing reaction. Max 32 chars mirrors v1 ReactRequest.
const ReactArgs = z
  .object({
    chat_id: ChatId,
    key: z
      .string()
      .min(1)
      .describe(
        "The target message's waMessageKey._serialized (from a list_messages row), " +
          "e.g. 'false_972544325389@c.us_3EB0ABCDEF'. Not the bare id and not a chat_id.",
      ),
    emoji: z
      .string()
      .max(32)
      .describe("The emoji to react with. Pass an empty string \"\" to CLEAR your existing reaction."),
  })
  .strict();

// A poll's current votes (wraps GET /v1/messages/poll_results/{key}?chatId=).
const GetPollResultsArgs = z
  .object({
    chat_id: ChatId.optional(),
    key: z
      .string()
      .min(1)
      .describe(
        "The poll message's waMessageKey._serialized (a poll_creation row from list_messages), " +
          "e.g. 'true_120363000000000000@g.us_3EB0ABCDEF_972500000000@c.us'.",
      ),
  })
  .strict();

const GetParticipantsArgs = z.object({ chat_id: ChatId, ...engineTargetShape, ...numberTargetShape }).strict();

const LoadMoreHistoryArgs = z
  .object({
    chat_id: ChatId,
    // Pull several older pages in ONE call, WA-paced ~2.5s apart. Stops early
    // on genuine exhaustion (canLoadMore:false), an error, or reaching
    // until_date. Default 1.
    pages: z.number().int().min(1).max(10).optional(),
    // Stop once the oldest loaded message is at/before this date. ISO 8601
    // string (e.g. "2025-07-01T00:00:00Z") or epoch seconds/ms. Use it to
    // page back to a target depth ("go back a year") deterministically.
    until_date: z.union([z.string(), z.number()]).optional(),
    ...engineTargetShape,
  })
  .strict();

const ArchiveArgs = z.object({ chat_id: ChatId }).strict();

const UnarchiveArgs = z.object({ chat_id: ChatId }).strict();

// send_message body — discriminated union mirroring SendInChatRequest on
// the backend (which is SendMessageRequest minus `to` and `send_at`).
// Kept inline rather than imported because tool defs intentionally stay
// dependency-light (zod + structural surface only). Wire shape is the
// authoritative source — see backend/src/services/api/v1/scheduled-messages
// /scheduled-messages.schemas.ts:SendInChatRequest.
const SendMessageTextArgs = z
  .object({
    chat_id: ChatId,
    // Optional caller-supplied Idempotency-Key (max 64). Reuse the SAME key to retry this exact send safely;
    // omit it and an identical repeat is still recognised automatically (chat + content, ~15 min).
    idempotency_key: z.string().trim().min(1).max(64).optional(),
    // `type` is derived from the action name in dispatch, so it's optional on
    // the wire — the model needn't send it (and can't get it wrong).
    type: z.literal("text").optional(),
    text: z.string().min(1).max(4096),
    reply_to: z.string().min(1).max(256).optional(),
    // BE#253 — participant JIDs to @mention in a group (contextInfo.mentionedJid).
    mentions: z.array(z.string()).optional(),
    ...sendSenderShape,
  })
  .strict();

const SendMessageMediaArgs = z
  .object({
    chat_id: ChatId,
    // Optional caller-supplied Idempotency-Key (max 64). Reuse the SAME key to retry this exact send safely;
    // omit it and an identical repeat is still recognised automatically (chat + content, ~15 min).
    idempotency_key: z.string().trim().min(1).max(64).optional(),
    // Derived from the action in dispatch — optional on the wire.
    type: z.literal("media").optional(),
    media: z
      .object({
        // Provide EXACTLY ONE byte source: a public https `url`, OR inline
        // `data_base64` (a bare base64 string or a `data:<mime>;base64,…` URL).
        // `url` wins if both are given. data_base64 is how you forward bytes you
        // already hold (a Gmail attachment, a downloaded file) with no URL.
        url: z.string().url().max(2048).optional(),
        data_base64: z.string().optional(),
        // MIME type for an inline `data_base64` payload without a data: prefix
        // (e.g. "image/png", "application/pdf"). Ignored for a data: URL (which
        // carries its own type) or a `url` (read from the response).
        mime_type: z.string().min(1).max(255).optional(),
        kind: z
          .enum(["image", "video", "audio", "document", "sticker", "voice", "gif"])
          .optional(),
        caption: z.string().max(1024).optional(),
        filename: z.string().max(255).optional(),
      })
      .strict(),
    reply_to: z.string().min(1).max(256).optional(),
    // BE#253 — participant JIDs to @mention on a captioned group media message.
    mentions: z.array(z.string()).optional(),
    ...sendSenderShape,
  })
  .strict();

const SendMessagePollArgs = z
  .object({
    chat_id: ChatId,
    // Optional caller-supplied Idempotency-Key (max 64). Reuse the SAME key to retry this exact send safely;
    // omit it and an identical repeat is still recognised automatically (chat + content, ~15 min).
    idempotency_key: z.string().trim().min(1).max(64).optional(),
    // Derived from the action in dispatch — optional on the wire.
    type: z.literal("poll").optional(),
    poll: z
      .object({
        question: z.string().min(1).max(255),
        options: z.array(z.string().min(1).max(100)).min(2).max(12),
        allow_multiple: z.boolean().optional(),
      })
      .strict(),
    ...sendSenderShape,
  })
  .strict();

// Reply to an interactive menu (buttons / list): press `button_id` / select `row_id` of the menu `reply_to`.
// No body and no `type`; the reply text is taken from the menu. Exactly one of button_id / row_id is checked in
// dispatch (the tool schema stays a plain object so it converts to JSON Schema).
const SendButtonReplyArgs = z
  .object({
    chat_id: ChatId,
    reply_to: z.string().min(1).max(256),
    button_id: z.string().min(1).max(256).optional(),
    row_id: z.string().min(1).max(256).optional(),
  })
  .strict();

const actions = {
  list: ListArgs,
  get_latest: GetLatestArgs,
  search: SearchArgs,
  get: GetArgs,
  list_messages: ListMessagesArgs,
  mark_read: MarkReadArgs,
  react: ReactArgs,
  archive: ArchiveArgs,
  unarchive: UnarchiveArgs,
  get_media: GetMediaArgs,
  get_participants: GetParticipantsArgs,
  get_poll_results: GetPollResultsArgs,
  load_more_history: LoadMoreHistoryArgs,
  send_message_text: SendMessageTextArgs,
  send_message_media: SendMessageMediaArgs,
  send_message_poll: SendMessagePollArgs,
  send_button_reply: SendButtonReplyArgs,
};

type ChatsInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "get_latest" } & z.infer<typeof GetLatestArgs>)
  | ({ action: "search" } & z.infer<typeof SearchArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "list_messages" } & z.infer<typeof ListMessagesArgs>)
  | ({ action: "mark_read" } & z.infer<typeof MarkReadArgs>)
  | ({ action: "react" } & z.infer<typeof ReactArgs>)
  | ({ action: "archive" } & z.infer<typeof ArchiveArgs>)
  | ({ action: "unarchive" } & z.infer<typeof UnarchiveArgs>)
  | ({ action: "get_media" } & z.infer<typeof GetMediaArgs>)
  | ({ action: "get_participants" } & z.infer<typeof GetParticipantsArgs>)
  | ({ action: "get_poll_results" } & z.infer<typeof GetPollResultsArgs>)
  | ({ action: "load_more_history" } & z.infer<typeof LoadMoreHistoryArgs>)
  | ({ action: "send_message_text" } & z.infer<typeof SendMessageTextArgs>)
  | ({ action: "send_message_media" } & z.infer<typeof SendMessageMediaArgs>)
  | ({ action: "send_message_poll" } & z.infer<typeof SendMessagePollArgs>)
  | ({ action: "send_button_reply" } & z.infer<typeof SendButtonReplyArgs>);

interface LimitClamped { requested: number; applied: number; max: number; howToPage: string }

/**
 * Normalize a model-supplied chat id: trim whitespace and strip wrapping
 * single/double quotes (models occasionally emit the id with embedded JSON
 * quotes — a live call arrived as '"972543028423@c.us"' and 400'd on the v1
 * JID regex). Stripping repeats so nested wrapping ('"x"') unwinds too; only
 * MATCHED wrapping pairs are removed, so a legitimate inner quote survives.
 */
export function sanitizeChatId(id: string): string {
  let out = id.trim();
  while (
    out.length >= 2 &&
    ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'")))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

/**
 * Sanitize the chat_id / chat_ids fields (when present) on any action's input,
 * in place, before dispatch. Runs after schema validation (the tool-level
 * ChatId is a loose min-length string, so quoted ids reach dispatch) and
 * before the v1 services' strict JID regex.
 */
function sanitizeChatIdFields(input: { action: string; chat_id?: unknown; chat_ids?: unknown }): void {
  if (typeof input.chat_id === "string") input.chat_id = sanitizeChatId(input.chat_id);
  if (Array.isArray(input.chat_ids)) {
    input.chat_ids = input.chat_ids.map((v) => (typeof v === "string" ? sanitizeChatId(v) : v));
  }
}

/**
 * Teaching error for `until` on the chat LIST (deliberately unsupported): an
 * upper bound on a chat's LAST activity silently drops chats that were active
 * after the window but still hold in-window messages. Fail loudly with
 * guidance instead of shipping a subtly-wrong filter.
 */
export const LIST_UNTIL_GUIDANCE =
  "`until` is not supported on chats.list: a chat whose LAST message is after " +
  "`until` may still contain messages inside your window, so an upper bound on " +
  "the chat list would silently drop it. Instead: filter the list with `since` " +
  "only (chats active at/after the window start), then apply `since`+`until` " +
  "per chat via list_messages (use chat_ids[] to scan several chats in one call).";

const chatsTool = {
  name: "chats" as const,
  description: [
    "Read or send WhatsApp messages inside chats on the connected engine.",
    "Available actions:",
    "  - list: list chats, newest message first. OFFSET pagination: the result",
    "      echoes {skip, limit, total}. To get the next page pass skip=<skip+limit>;",
    "      stop once skip+limit >= total. (There is no cursor — use the integer skip.)",
    "      Triage params (avoid scanning junk / find who's waiting):",
    "        kinds              — keep only these kinds, e.g. [\"contact\"] for DMs",
    "                             (skips groups/newsletters). Omit for all.",
    "        include_last_message — attach lastMessageText + lastMessageFromMe per",
    "                             row. lastMessageFromMe=false with unreadCount>0",
    "                             ≈ a chat waiting for YOUR reply — no per-chat",
    "                             messages call needed to triage.",
    "        since (ISO 8601)   — keep only chats active at/after that instant",
    "                             (\"chats with activity this week\"). Newest first;",
    "                             skip/limit page over the filtered list (skip+limit",
    "                             is safe), `total` is the match count among the chats",
    "                             scanned; the result carries sinceApplied:true and",
    "                             scan:{scanned,engineTotal,truncated} (truncated:true =",
    "                             3000-row cap / time budget hit before `since`, so",
    "                             older matches may exist and total is a lower bound). There is NO `until` on the",
    "                             list (it would silently drop chats active after",
    "                             the window that still hold in-window messages) —",
    "                             bound the window per chat via list_messages",
    "                             since+until instead.",
    "        include_archive    — archived chats are EXCLUDED by default; pass true",
    "                             to include them.",
    "      Each row carries: unreadCount, markedUnread, pinned, archived,",
    "      lastMessageAt, chatType (+ lastMessageText/lastMessageFromMe when",
    "      include_last_message is set).",
    "  - get_latest: fastest way to get an overview — the most-recent non-archived",
    "      chats (pinned first), EACH already carrying its latest messages",
    "      (newest-first), in ONE call. Params: numberOfChats (default 50),",
    "      numberOfMessages per chat (default 20). Prefer this over list +",
    "      per-chat list_messages when you want a broad recent snapshot.",
    "  - search: list chats matching a name/keyword query. Same offset pagination",
    "      (skip/limit/total) as `list`.",
    "      Archived chats are excluded by default — pass include_archive=true",
    "      to find an archived chat (e.g. to get its chat_id before unarchive).",
    "  - get: retrieve a single chat by chat_id (e.g. 972544325389@c.us)",
    "  - list_messages: list messages inside a chat (chat_id), across MULTIPLE",
    "      chats in one call (chat_ids[] — up to 25, PREFER this when inspecting",
    "      several chats: the backend loops them with traffic-aware pacing and",
    "      returns {chats:[{chatId, messages, coverage, autoLoadedPages, total}]}",
    "      in one round-trip; per-chat limit defaults to 20), or across all chats",
    "      via GET /v1/messages when no chat is scoped.",
    "      Each message may carry `reactions: [{emoji, senderId?, fromMe?, timestamp?}]`",
    "      (live emoji reactions; omitted when none or when the engine doesn't",
    "      supply them — currently Chrome engine only, Baileys pending).",
    "      Batch honesty rules: `deadline_ms` (default 120000) bounds the batch",
    "      wall-time — entries {skipped:true, reason:\"deadline\"} were NOT read;",
    "      say so, never count them as covered. The batch also caps total",
    "      auto-loaded history pages — once spent, remaining cold chats return",
    "      sinceReached:false with no paging (honest cold, not \"no messages\").",
    "      Supports content search and media/document filters in ONE call:",
    "        query        — single substring term.",
    "        query_any    — keyword-set OR: matches body/caption/filename if ANY",
    "                       term hits (e.g. [\"ftp\",\"host\",\"password\"]). One pass,",
    "                       not N separate searches.",
    "        message_types— restrict to kinds, e.g. [\"document\"] for PDFs.",
    "                       [\"call_log\"] = only calls: each carries call",
    "                       {direction, media, outcome, durationSec?, isGroup}.",
    "        mime         — MIME prefix, e.g. \"application/pdf\" or \"image/\".",
    "        filename_contains, has_media, sender — narrow document/media hunts.",
    "      Result carries a `coverage` envelope: {messagesScanned, truncated,",
    "      indexOnly, oldestScannedIso}. Read it before concluding \"not found\":",
    "        - truncated:true  = the scan hit its cap; older matches may exist —",
    "          page further / narrow the range before denying.",
    "        - indexOnly:true  = only WA's search index was consulted (cold chats,",
    "          captions and filenames were NOT scanned) — inconclusive.",
    "        - []+neither flag = an honest \"scanned N messages, none matched\".",
    "      READ-THROUGH on `since`: when you pass `since` and the chat's local",
    "      store hasn't loaded back that far, the backend auto-pages older history",
    "      (WA-paced, bounded) BEFORE returning, so an empty page is a real",
    "      \"nothing since then\" — not a cold store. The result reports",
    "      `autoLoadedPages` and `coverage.oldestLoadedIso`; if the bound is hit",
    "      before reaching `since`, coverage's oldest date stays newer than",
    "      `since` (older messages may still exist — say so, don't deny).",
    "      `partial:true` (with `partialEngines`) = one engine behind this chat could not",
    "      answer, so the page may be missing messages or chats from it — say so, never",
    "      present the page as complete.",
    "  - mark_read: mark all messages in a chat as read",
    "  - react: react to one message with an emoji. Body: {chat_id, key, emoji} where",
    "      `key` is the message's waMessageKey._serialized (from list_messages). One",
    "      reaction per message — a new emoji replaces the old; pass emoji \"\" (empty",
    "      string) to CLEAR your reaction.",
    "  - archive: archive a chat (hide it from the main chat list)",
    "  - unarchive: unarchive a chat (restore it to the main chat list)",
    "  - get_media: download media for one message. Images ≤ 5 MiB are",
    "      returned inline as `data_base64` (RAW base64 — no data: prefix;",
    "      combine it with `mimetype`). Larger images and all non-image media",
    "      (video/audio/documents) return a short-lived signed `url` only — GET",
    "      that url to fetch the bytes. Also returns mimetype/filename +",
    "      original_quality flag (false when WA returned a preview rather than",
    "      the original; currently only happens for own-sent newsletter media).",
    "      Body: {chat_id, key} where `key` is the message's",
    "      waMessageKey._serialized (from a list_messages row) — NOT the bare",
    "      message id and NOT a chat_id.",
    "  - get_participants: list the members of a group chat",
    "  - get_poll_results: who voted for which option in a poll. Body: {key, chat_id?}",
    "      where `key` is the poll message's waMessageKey._serialized (a poll_creation",
    "      row from list_messages). Returns per-option voteCount + voters and per-voter",
    "      votes (latest vote per person). A vote whose option couldn't be determined",
    "      has decoded:false and is counted in undecodedVotes — report it as",
    "      'voted, choice unknown', never drop it. Members who did not vote: compare",
    "      get_participants with the voters.",
    "  - load_more_history: request OLDER history for ONE specific chat",
    "      (chat_id) from the phone, so a subsequent list_messages can page",
    "      further back. Use it whenever a chat's loaded messages don't reach",
    "      far enough back for what you need.",
    "      Paced and limited: one request per chat at a time, WA-paced — a call",
    "      while that chat's request is in flight or cooling down returns",
    "      added:0 (not an error); wait and retry. While the initial sync is",
    "      still running the call throws a not_connected error. After repeated",
    "      unanswered requests WhatsApp history requests pause: the result's",
    "      `error` starts \"cooling_down:\" and says how long to wait — retry",
    "      after that, don't treat it as \"no history\".",
    "      A chat with no messages AND no chat activity on the engine (e.g. a",
    "      saved contact whose conversation WhatsApp's first sync never",
    "      delivered: `get` returns it with lastMessageAt null) has nothing",
    "      to page back from, so added stays 0. Once one message is sent or",
    "      received in that chat, its older history can be requested.",
    "      Body: {chat_id, pages?: 1-10, until_date?}. `pages` replays the pull",
    "      that many times, WA-paced ~2.5s apart, stopping early on exhaustion,",
    "      error, or reaching `until_date` (ISO 8601 or epoch). Use `pages` +",
    "      `until_date` to cover a range (\"go back a year\") in one call instead",
    "      of many single-page calls.",
    "      Result: {totalMessages, added (sum over pages), canLoadMore,",
    "      historyUnavailable, pagesExecuted, error, coverage}. Read it as:",
    "        - added:0 + canLoadMore:true = transient hiccup — worth retrying",
    "          (unless the chat has no messages and no activity, see above).",
    "        - canLoadMore:false = history is genuinely exhausted — stop paging.",
    "        - coverage.oldestLoadedIso = how far back is ACTUALLY loaded now;",
    "          check it against your target to confirm you reached far enough.",
    "  - send_message_text: send a text message NOW (fire-and-forget).",
    "      Body: {chat_id, type: \"text\", text}",
    "  - send_message_media: send an image/video/audio/document NOW.",
    "      Body: {chat_id, type: \"media\", media: {url | data_base64, mime_type?,",
    "      kind?, caption?, filename?}} — give EITHER a public https `url` OR inline",
    "      `data_base64` (bytes you already hold, e.g. a Gmail attachment or a file",
    "      you downloaded); pass `mime_type` with a bare base64 payload.",
    "  - send_message_poll: send a poll NOW.",
    "      Body: {chat_id, type: \"poll\", poll: {question, options[2..12], allow_multiple?}}",
    "  - Sender (send_message_text/media/poll): optional `from` = the WhatsApp number to send from;",
    "      optional `engine` (gateway|regular) / `engine_id` pin the sending engine. A matching",
    "      value is honoured; a mismatch is rejected (409 SENDER_MISMATCH names the valid number,",
    "      409 ENGINE_NOT_ONLINE the online engines) and nothing is sent. Omit all for the default.",
    "",
    "  - send_button_reply: press a button / pick a list row on a menu NOW.",
    "      Body: {chat_id, reply_to: <menu waMessageKey>, button_id | row_id}. The reply text",
    "      is taken from the menu (read the menu first: list_messages shows `interactive.options`).",
    "      409 menu_not_found = the menu is no longer on the engine; 400 unknown_option; 409",
    "      engine_unsupported = only gateway (Baileys) engines can send it for now.",
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
    "  - list: 'show me my recent chats' (next page: pass skip=<prev skip+limit>)",
    "  - list: 'unanswered DMs this week' → kinds:[\"contact\"], since:<week ago>,",
    "      include_last_message:true (then lastMessageFromMe=false + unreadCount>0)",
    "  - search: 'find chats with noam'",
    "  - list_messages: 'last 20 messages with +972544325389'",
    "  - list_messages (batch): 'scan these 10 chats' → chat_ids:[…] in ONE call",
    "  - send_message_text: 'reply hi to +972544325389'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  // Per-action argument schemas (clients that expose one tool per action).
  actionSchemas: actions,
  annotations: {
    list: { readOnlyHint: true },
    get_latest: { readOnlyHint: true },
    search: { readOnlyHint: true },
    get: { readOnlyHint: true },
    list_messages: { readOnlyHint: true },
    mark_read: {},
    react: {},
    archive: {},
    unarchive: {},
    get_media: { readOnlyHint: true },
    get_participants: { readOnlyHint: true },
    get_poll_results: { readOnlyHint: true },
    load_more_history: {},
    send_message_text: {},
    send_message_media: {},
    send_message_poll: {},
    send_button_reply: {},
  },
  parse(input: unknown): ChatsInput {
    const { action, ...args } = z.object({ action: z.string() }).passthrough().parse(input);
    switch (action) {
      case "list": return { action, ...actions.list.parse(args) };
      case "get_latest": return { action, ...actions.get_latest.parse(args) };
      case "search": return { action, ...actions.search.parse(args) };
      case "get": return { action, ...actions.get.parse(args) };
      case "list_messages": return { action, ...actions.list_messages.parse(args) };
      case "mark_read": return { action, ...actions.mark_read.parse(args) };
      case "react": return { action, ...actions.react.parse(args) };
      case "archive": return { action, ...actions.archive.parse(args) };
      case "unarchive": return { action, ...actions.unarchive.parse(args) };
      case "get_media": return { action, ...actions.get_media.parse(args) };
      case "get_participants": return { action, ...actions.get_participants.parse(args) };
      case "get_poll_results": return { action, ...actions.get_poll_results.parse(args) };
      case "load_more_history": return { action, ...actions.load_more_history.parse(args) };
      case "send_message_text": return { action, ...actions.send_message_text.parse(args) };
      case "send_message_media": return { action, ...actions.send_message_media.parse(args) };
      case "send_message_poll": return { action, ...actions.send_message_poll.parse(args) };
      case "send_button_reply": return { action, ...actions.send_button_reply.parse(args) };
      default: throw new Error("Unsupported tool action");
    }
  },
  async dispatch(input: ChatsInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      // Model-input hygiene: ids sometimes arrive with embedded JSON quotes —
      // normalize before any downstream strict validation.
      sanitizeChatIdFields(input);
      let limitClamped: LimitClamped | undefined;
      if ('limit' in input && typeof input.limit === 'number' && input.limit > CHATS_LIMIT_MAX) {
        limitClamped = {
          requested: input.limit,
          applied: CHATS_LIMIT_MAX,
          max: CHATS_LIMIT_MAX,
          howToPage: input.action === 'list_messages' ? PAGE_HINT_MESSAGES : PAGE_HINT_SKIP,
        };
        input.limit = CHATS_LIMIT_MAX;
      }
      let data: unknown;
      switch (input.action) {
        case "list": {
          // `until` is schema-accepted purely to produce this teaching error
          // (see LIST_UNTIL_GUIDANCE) instead of a cryptic strict rejection.
          if (input.until !== undefined) {
            // A deliberate caller error: surface as a typed 400, not a plain Error
            // (which toolErrorResult maps to a 500 internal_error + stack log).
            return toolErrorResult({ statusCode: 400, code: "bad_request", message: LIST_UNTIL_GUIDANCE });
          }
          const { action: _action, until: _until, ...query } = input;
          data = await client.chats.list(compact(query));
          break;
        }
        case "get_latest": {
          data = await client.chats.getLatestChatsAndMessages(compact({
            numberOfChats: input.numberOfChats,
            numberOfMessages: input.numberOfMessages,
            engine: input.engine,
            engine_id: input.engine_id,
            number: input.number,
            fanout_limit: input.fanout_limit,
          }));
          break;
        }
        case "search": {
          // ListChatsParams uses `query` (not `search`) as the SDK field name
          const { query, limit, skip, include_archive, engine, engine_id, number, fanout_limit } = input;
          data = await client.chats.list(compact({ query, limit, skip, include_archive, engine, engine_id, number, fanout_limit }));
          break;
        }
        case "get":
          data = await client.chats.get(input.chat_id, compact({ engine: input.engine, engine_id: input.engine_id, number: input.number, fanout_limit: input.fanout_limit }));
          break;
        case "list_messages": {
          const { chat_id, chat_ids, deadline_ms, limit, cursor, mode, query, query_any, since, until, message_types, mime, filename_contains, has_media, sender, engine, engine_id } = input;
          // `deadline_ms` is deliberately NOT in perChat — it's a batch-level
          // wall-time budget; the single-chat v1 query schema (strict) would
          // reject it.
          const perChat = compact({ limit, cursor, mode, query, query_any, since, until, message_types, mime, filename_contains, has_media, sender, engine, engine_id });
          // Batch fan-out: chat_ids[] wins when present. The backend loops the
          // chats sequentially (traffic-aware pacing) and returns {chats:[…]}
          // in one result.
          if (chat_ids && chat_ids.length > 0) {
            if (!client.chats.listMessagesBatch) {
              // Fallback for surfaces (e.g. the standalone SDK) without the
              // batch method: loop client-side, sequentially, one result.
              const chats: Array<{ chatId: string; result?: unknown; error?: string }> = [];
              for (const id of chat_ids) {
                try {
                  const res = await client.chats.listMessages(id, perChat);
                  chats.push({ chatId: id, result: res });
                } catch (e) {
                  chats.push({ chatId: id, error: e instanceof Error ? e.message : String(e) });
                }
              }
              data = { chats };
            } else {
              data = await client.chats.listMessagesBatch(
                chat_ids,
                compact({ ...perChat, deadline_ms }),
              );
            }
            break;
          }
          // No chat at all: search across every chat, as the description promises.
          if (!chat_id) {
            if (!client.chats.listAllMessages) {
              return toolErrorResult(
                new Error("list_messages requires either chat_id (single) or chat_ids (batch)"),
              );
            }
            data = await client.chats.listAllMessages(perChat);
            break;
          }
          data = await client.chats.listMessages(chat_id, perChat);
          break;
        }
        case "mark_read":
          data = await client.chats.markRead(input.chat_id);
          break;
        case "react":
          data = await client.chats.react(input.chat_id, input.key, input.emoji);
          break;
        case "get_poll_results":
          data = await client.chats.getPollResults(input.chat_id, input.key);
          break;
        case "archive":
          data = await client.chats.archive(input.chat_id);
          break;
        case "unarchive":
          data = await client.chats.unarchive(input.chat_id);
          break;
        case "get_media":
          data = await client.chats.getMedia(
            input.chat_id,
            input.key,
            compact({ engine: input.engine, engine_id: input.engine_id }),
          );
          break;
        case "get_participants":
          data = await client.chats.listParticipants(
            input.chat_id,
            compact({ engine: input.engine, engine_id: input.engine_id, number: input.number, fanout_limit: input.fanout_limit }),
          );
          break;
        case "load_more_history":
          data = await client.chats.loadOlderMessages(
            input.chat_id,
            compact({ pages: input.pages, until_date: input.until_date, engine: input.engine, engine_id: input.engine_id }),
          );
          break;
        // The send_message_* `type` is fully determined by the action name, so
        // force it here rather than trusting the model to send it. The v1
        // SendInChatRequest is a discriminated union on `type` — a missing
        // `type` fails with "type: Required". Injecting it makes the send
        // robust whether or not the model included the field.
        case "send_message_text": {
          const { chat_id, action: _a, idempotency_key, ...body } = input;
          data = await client.chats.sendMessage(chat_id, compact({ ...body, type: "text" }), idempotency_key ? { idempotencyKey: idempotency_key } : undefined);
          break;
        }
        case "send_message_media": {
          const { chat_id, action: _a, idempotency_key, ...body } = input;
          data = await client.chats.sendMessage(chat_id, compact({ ...body, type: "media" }), idempotency_key ? { idempotencyKey: idempotency_key } : undefined);
          break;
        }
        case "send_message_poll": {
          const { chat_id, action: _a, idempotency_key, ...body } = input;
          data = await client.chats.sendMessage(chat_id, compact({ ...body, type: "poll" }), idempotency_key ? { idempotencyKey: idempotency_key } : undefined);
          break;
        }
        case "send_button_reply": {
          const { chat_id, reply_to, button_id, row_id } = input;
          if ((button_id === undefined) === (row_id === undefined)) {
            throw new Error("send_button_reply needs exactly one of button_id or row_id");
          }
          // The REST shape (no `type`): the v1 layer validates the click against the stored menu.
          data = await client.chats.sendMessage(chat_id, { buttonReply: compact({ replyTo: reply_to, buttonId: button_id, rowId: row_id }) });
          break;
        }
      }
      if (limitClamped && data !== null && typeof data === 'object' && !Array.isArray(data)) {
        data = { ...data, limitClamped };
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default chatsTool;

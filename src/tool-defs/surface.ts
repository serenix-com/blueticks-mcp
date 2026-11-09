/**
 * The public Blueticks API surface that MCP tool builders depend on.
 *
 * Tool builders take a `BlueticksSurface` rather than the concrete
 * `Blueticks` SDK class so multiple transports can drive the same tools:
 *
 *   - The standalone MCP server hands them a real `Blueticks` instance,
 *     which goes over HTTPS to the Blueticks v1 API. The SDK class
 *     structurally satisfies this interface — every method shape here
 *     mirrors the SDK's existing public method shape.
 *   - The OAuth-wrapped MCP server (in the backend) hands them an
 *     in-process adapter that calls Feathers v1 services directly,
 *     bypassing the HTTP hop while preserving the same shape.
 *
 * This is hand-written intentionally: the standalone MCP package
 * (which owns this file) doesn't pull in the SDK at the type level
 * for its own MCP-server entrypoints, and the OAuth MCP consumer in
 * the backend repo doesn't need a `blueticks` runtime/types dep just
 * to typecheck its adapter.
 *
 * Method args are typed so tool-builder callsites stay type-safe.
 * Return types are `Promise<unknown>` because tool builders only
 * `JSON.stringify(data ?? {})` the result and never branch on its
 * structure — both the SDK's typed returns (e.g. `Promise<Group>`)
 * and the v1 service's looser returns (`Promise<GroupT>` with
 * nullable fields) satisfy `Promise<unknown>` via covariance, so
 * neither side needs casts at the boundary.
 */
import type { MessageType } from './message-types';
import type { ToolImageMime } from './errors';
import type { AgentToolArgs } from './backend-shims';
import type { QualifyLeadOutcome } from './backend-shims';
import type { LeadStage } from './backend-shims';


/** #1185: the outcome of `qualify_lead` `save` (services/agent-leads). */
export type { QualifyLeadOutcome } from './backend-shims';
/** #1089: the outcomes of `followups` (schedule | list | cancel). */
export type FollowupsScheduleOutcome =
  | { scheduled: true; id: string; send_at: string; target: 'chat' | 'owner' }
  | { scheduled: false; error: string };
export interface FollowupsListOutcome {
  followups: Array<{ id: string; target: 'chat' | 'owner'; send_at: string; text: string }>;
}
export type FollowupsCancelOutcome = { cancelled: true } | { cancelled: false; error: string };

/** #965: the outcome of `report_capability_gap` `report`. */
export interface ReportCapabilityGapOutcome {
  /** All the model gets: the result is internal (the bot never mentions a report in the chat). */
  status: "reported" | "deduped" | "failed";
}

/** #914: the outcome of `browse_page` `image`. Refusals carry the same typed `error` shape as `read`. */
export interface BrowseImageSuccess {
  image: true;
  url: string;
  mimeType: ToolImageMime;
  bytes: number;
  data: string;
}
export interface BrowseImageRefusal {
  image: false;
  error: string;
  host?: string;
  hint: string;
}
export type BrowseImageOutcome = BrowseImageSuccess | BrowseImageRefusal;

export interface BlueticksAudiencesApi {
  list(params: { limit?: number; cursor?: string }): Promise<unknown>;
  get(id: string): Promise<unknown>;
  create(body: { name: string }): Promise<unknown>;
  update(id: string, body: { name: string }): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  appendContacts(
    id: string,
    contacts: Array<{ to: string; variables?: Record<string, string> }>,
  ): Promise<unknown>;
  updateContact(
    audienceId: string,
    contactId: string,
    body: { to?: string; variables?: Record<string, string> },
  ): Promise<unknown>;
  deleteContact(audienceId: string, contactId: string): Promise<unknown>;
}

export interface BlueticksCampaignsApi {
  list(params: { limit?: number; cursor?: string }): Promise<unknown>;
  get(id: string): Promise<unknown>;
  create(body: {
    name: string;
    audience_id: string;
    text?: string;
    media_url?: string;
    media_caption?: string;
    on_missing_variable?: 'fail' | 'skip';
    send_at?: string;
  }): Promise<unknown>;
  pause(id: string): Promise<unknown>;
  resume(id: string): Promise<unknown>;
  cancel(id: string): Promise<unknown>;
}

export interface BlueticksChatsApi {
  // Offset-paginated (`skip`), with triage filters. `cursor` is retired — the
  // adapter forwards `skip` straight to the v1 `skip` offset.
  list(params: {
    query?: string;
    limit?: number;
    skip?: number;
    kinds?: Array<'contact' | 'group' | 'newsletter'>;
    include_last_message?: boolean;
    since?: string;
    include_archive?: boolean;
    // Engine-targeted reads (override BE#302). `engine` = connection type;
    // `engine_id` = exact presence clientId (wins). See tools/chats.ts.
    engine?: 'gateway' | 'regular';
    engine_id?: string;
  }): Promise<unknown>;
  // Most-recent non-archived chats (pinned first), each with their latest
  // messages. Param names mirror the engine tool 1:1.
  getLatestChatsAndMessages(params?: {
    numberOfChats?: number;
    numberOfMessages?: number;
    engine?: 'gateway' | 'regular';
    engine_id?: string;
  }): Promise<unknown>;
  get(chatId: string, opts?: { engine?: 'gateway' | 'regular'; engine_id?: string }): Promise<unknown>;
  listMessages(
    chatId: string,
    params: {
      limit?: number;
      cursor?: string;
      mode?: 'history' | 'latest';
      query?: string;
      // Keyword-set OR search (§4.3) — matches body/caption/filename if ANY
      // term hits. Combined with `query` when both are present.
      query_any?: string[];
      since?: string;
      until?: string;
      // Media/document filters (invoice/document hunts). `mime` is a prefix
      // match ("application/pdf" | "image/"); `filename_contains` / `sender`
      // are case-insensitive substrings; `has_media` gates on attachment.
      mime?: string;
      filename_contains?: string;
      has_media?: boolean;
      sender?: string;
      // Legacy v1 names + WA Web names; ONE list (services/api/v1/lib/message-types.ts)
      // shared with the /v1 schema and the chats-tool zod enum (parity test).
      message_types?: MessageType[];
      engine?: 'gateway' | 'regular';
      engine_id?: string;
    },
  ): Promise<unknown>;
  /**
   * Account-wide message read (GET /v1/messages with no chatId): the engine
   * searches every chat. Optional, like listMessagesBatch — a surface without
   * it makes `list_messages` with no chat an error. Same params as listMessages.
   */
  listAllMessages?(params: Parameters<BlueticksChatsApi['listMessages']>[1]): Promise<unknown>;
  /**
   * Batched multi-chat read (bug B8). Optional — only the in-process backend
   * adapter implements it; the standalone SDK doesn't, so tool dispatchers
   * guard `if (!client.chats.listMessagesBatch)` and fall back to a per-chat
   * loop. `params` is the SAME per-chat query shape as `listMessages` (applied
   * to every chat); the backend loops the chats sequentially (WA-paced) and
   * returns `{ chats: [{ chatId, messages, coverage, autoLoadedPages, total }] }`.
   */
  listMessagesBatch?(
    chatIds: string[],
    params: {
      limit?: number;
      cursor?: string;
      mode?: 'history' | 'latest';
      query?: string;
      query_any?: string[];
      since?: string;
      until?: string;
      mime?: string;
      filename_contains?: string;
      has_media?: boolean;
      sender?: string;
      message_types?: string[];
      // Batch-level wall-time budget (remaining ms from batch start). Chats
      // not reached before it expires come back as skipped:'deadline' entries.
      deadline_ms?: number;
      engine?: 'gateway' | 'regular';
      engine_id?: string;
    },
  ): Promise<unknown>;
  getMedia(
    chatId: string,
    key: string,
    opts?: { engine?: 'gateway' | 'regular'; engine_id?: string },
  ): Promise<unknown>;
  markRead(chatId: string): Promise<unknown>;
  // BE#844 — react to a message; emoji "" clears. POST /v1/messages/reactions/{key}?chatId=.
  react(chatId: string, key: string, emoji: string): Promise<unknown>;
  // A poll's current votes (who voted for which option). GET /v1/messages/poll_results/{key}?chatId=.
  getPollResults(chatId: string | undefined, key: string): Promise<unknown>;
  // Archive / unarchive a chat — hide it from / restore it to the main chat
  // list. Maps to POST /v1/chats/{id}/archive | /unarchive.
  archive(chatId: string): Promise<unknown>;
  unarchive(chatId: string): Promise<unknown>;
  batchMessageAcks(body: { message_keys: string[] }): Promise<unknown>;
  // Method names track the blueticks SDK (v3.4.x renamed
  // `getParticipants` → `listParticipants`, `loadMoreHistory` →
  // `loadOlderMessages`). Tool dispatchers in tools/chats.ts translate
  // the MCP action names to these SDK calls.
  listParticipants(
    chatId: string,
    opts?: { engine?: 'gateway' | 'regular'; engine_id?: string },
  ): Promise<unknown>;
  // `opts` (optional) drives the enriched deep-pull: `pages` (1-10) replays the
  // engine load command WA-paced; `until_date` stops once loaded history
  // reaches that date. Omit for the single-page default. The SDK's
  // `loadOlderMessages(chatId)` structurally satisfies this (extra optional arg).
  loadOlderMessages(
    chatId: string,
    opts?: { pages?: number; until_date?: string | number; engine?: 'gateway' | 'regular'; engine_id?: string },
  ): Promise<unknown>;
  // Immediate send via the POST /v1/messages/{chat_id}
  // endpoint — fire-and-forget, distinct from the queue-managed
  // /v1/scheduled-messages create. Body is the SendInChatRequest
  // discriminated union; the structural type here keeps it open so
  // SDK regen can settle on `create(...)` vs `sendMessage(...)` per
  // language conventions.
  sendMessage(chatId: string, body: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<unknown>;
}

export interface BlueticksContactsApi {
  list(params: { limit?: number; cursor?: string; query?: string }): Promise<unknown>;
  getProfilePicture(chatId: string): Promise<unknown>;
}

export interface BlueticksEnginesApi {
  status(): Promise<unknown>;
  logout(): Promise<unknown>;
  reload(): Promise<unknown>;
}

export interface BlueticksGroupsApi {
  /**
   * @param opts.include - request additional fields inline on the response.
   *   `'participants'` populates `participants[]` (chat_id + admin flags)
   *   so the caller doesn't have to follow up with a participants query.
   */
  // Tracks the SDK signature exactly. The `include: ['participants']`
  // single-round-trip variant isn't part of the SDK yet — tools/groups.ts
  // emulates it by chaining a `chats.listParticipants` call when the
  // MCP `include_participants` flag is set. The in-process adapter
  // accepts `include` directly and translates it to the v1 query string.
  get(
    groupId: string,
    opts?: { signal?: AbortSignal; include?: string[] },
  ): Promise<unknown>;
  create(body: { name: string; participants: string[] }): Promise<unknown>;
  update(
    groupId: string,
    body: {
      name?: string;
      settings?: { announce?: boolean; restrict?: boolean };
    },
  ): Promise<unknown>;
  /**
   * Cancel the authenticated user's membership in the group. WhatsApp
   * doesn't expose a "destroy group" semantic — the group continues to
   * exist for any remaining members; only this user's membership ends.
   */
  leave(groupId: string): Promise<unknown>;
  /** The group's current picture: `{ url }` (short-lived WhatsApp CDN url, null when none). */
  getPicture(groupId: string): Promise<unknown>;
  /** Set the picture from an https `url` or a `fileDataUrl` (data: URL). Admins only on admins-only-edit groups. */
  setPicture(
    groupId: string,
    body: { url?: string; fileDataUrl?: string; fileMimeType?: string },
  ): Promise<unknown>;
  /** Remove the picture. Baileys engine only (the Chrome extension has no handler → 501). */
  removePicture(groupId: string): Promise<unknown>;
}

export interface BlueticksMessagesApi {
  send(body: {
    to: string;
    text?: string;
    media_url?: string;
    media_base64?: string;
    media_kind?: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'voice' | 'gif';
    media_mime_type?: string;
    media_filename?: string;
    media_caption?: string;
    /**
     * Send a WhatsApp poll. Mutually exclusive with `text`/`media_url`.
     * `options` is the flat list of choice labels; `allow_multiple` lets
     * voters pick more than one. Engine handles single-vote vs multi-vote
     * via separate WAWeb call paths internally.
     */
    poll?: {
      question: string;
      options: string[];
      allow_multiple?: boolean;
    };
    send_at?: string;
    /** #734 — repeat rule; requires send_at. */
    recurrence?: {
      frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
      interval?: number;
      by_weekday?: Array<'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'>;
      ends_after?: number;
      ends_on?: string;
      timezone?: string;
    };
    from?: string;
    /** #194 — display name for the recipient, shown in the scheduled-message list. */
    recipient_name?: string;
    /** BE#253 — participant JIDs to @mention in a group send (contextInfo.mentionedJid). */
    mentions?: string[];
  }): Promise<unknown>;
  get(id: string): Promise<unknown>;
  list(params: {
    limit?: number;
    cursor?: string;
    chat_id?: string;
    /** Lifecycle filter — `pending` is pre-dispatch (accepted/waiting);
     *  the rest are post-dispatch. Omit for "all statuses". */
    status?: 'pending' | 'confirmed' | 'received' | 'read' | 'played' | 'failed';
    /** #741 — include messages already SENT (soft-deleted once delivered). Never
     *  includes a cancelled message. Default false. */
    include_sent?: boolean;
    /** #741 — include the ~83 KB embedded link-preview thumbnail. Default false. */
    include_preview?: boolean;
  }): Promise<unknown>;
  /** Edit a queued (pre-dispatch) message. */
  update(
    id: string,
    body: {
      text?: string;
      media_url?: string;
      media_caption?: string;
      send_at?: string;
    },
  ): Promise<unknown>;
  /** Cancel a queued (pre-dispatch) message. */
  cancel(id: string): Promise<unknown>;
}

export interface BlueticksUtilsApi {
  validatePhone(body: { phone_or_chat_id: string }): Promise<unknown>;
  linkPreview(params: { url: string }): Promise<unknown>;
  currentDateTime(): Promise<unknown>;
}

export interface BlueticksSunoApi {
  /** Generate a song from lyrics + style. Returns { jobId, clips:[{id,status}] }. */
  generateSong(body: {
    lyrics: string;
    style: string;
    negativeStyle?: string;
    vocalGender?: 'm' | 'f';
    weirdness?: number;
    styleInfluence?: number;
    /** How closely a cover follows the reference recording (0-1). Needs uploadId. */
    audioInfluence?: number;
    instrumental?: boolean;
    model?: string;
    title?: string;
    /** Reference-audio id from uploadAudio, to cover the user's own recording. */
    uploadId?: string;
  }): Promise<unknown>;
  /** Poll one clip by id → { id, status, audioUrl?, imageUrl? }. */
  getSong(id: string): Promise<unknown>;
  /** Upload reference audio (URL or base64) → { uploadId }. */
  uploadAudio(body: { audioUrl?: string; audioBase64?: string; fileName?: string }): Promise<unknown>;
  /** Remaining Suno credits / plan. */
  account(): Promise<unknown>;
  /**
   * AGENT sessions only: start making 4 songs from lyrics and/or a recording in
   * `chat_id`; returns at once, the songs are sent into the chat when ready.
   */
  makeSongs?(body: { chat_id: string; message_key?: string; lyrics?: string }): Promise<unknown>;
}

/**
 * The calling AGENT's own Google Calendar. The agent and its owner come from the
 * token (never from the input), so there is no calendar id parameter.
 */
export interface BlueticksCalendarApi {
  /** Busy intervals between two RFC3339 instants → { busy:[{start,end}], timeZone }. */
  freebusy(q: { from: string; to: string }): Promise<unknown>;
  /** Create one event → { eventId, htmlLink }; a conflict is a 409 slot_taken. */
  book(body: { start: string; end: string; summary: string; description?: string; attendeeEmail?: string }): Promise<unknown>;
}

export interface BlueticksWebhooksApi {
  list(params: { limit?: number; cursor?: string }): Promise<unknown>;
  get(id: string): Promise<unknown>;
  create(body: { url: string; events: string[] }): Promise<unknown>;
  update(
    id: string,
    body: { url?: string; events?: string[]; status?: 'enabled' | 'disabled' },
  ): Promise<unknown>;
  delete(id: string): Promise<unknown>;
}

/**
 * AI long-term memory boards (Tasks / Leads). Snake_case bodies/params flow
 * straight through — the v1 boards service accepts snake_case natively — while
 * the in-process adapter injects the per-agent `agent_id` isolation key so tool
 * callers never see (or set) it. Every method returns the mapped public shape.
 */
export interface BlueticksBoardsApi {
  list(params: { domain?: string; agent_managed?: boolean }): Promise<unknown>;
  create(body: {
    domain?: string;
    entity_kind?: string;
    name?: string;
    description?: string;
    memory_retention_days?: number;
  }): Promise<unknown>;
  get(boardId: string): Promise<unknown>;
  listItems(
    boardId: string,
    params: {
      active_only?: boolean;
      status?: string;
      updated_since?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<unknown>;
  createItem(
    boardId: string,
    body: {
      text: string;
      status?: string;
      priority?: string;
      due_date?: string;
      cells?: Record<string, string | number>;
      source?: Record<string, unknown>;
      confidence?: number;
    },
  ): Promise<unknown>;
  updateItem(
    boardId: string,
    itemId: string,
    body: {
      text?: string;
      status?: string;
      priority?: string;
      due_date?: string;
      cells?: Record<string, string | number>;
      source?: Record<string, unknown>;
      confidence?: number;
      deleted?: boolean;
      note?: string;
    },
  ): Promise<unknown>;
  bulkUpsert(
    boardId: string,
    items: Array<{
      text: string;
      status?: string;
      priority?: string;
      due_date?: string;
      cells?: Record<string, string | number>;
      source?: Record<string, unknown>;
      confidence?: number;
    }>,
  ): Promise<unknown>;
  findSimilar(
    boardId: string,
    candidates: Array<{ text: string }>,
  ): Promise<unknown>;
}

/** #1457: the provenance of a task on a UI board (where in WhatsApp it came from). */
export interface BlueticksTaskSource {
  chat_id?: string;
  chat_name?: string;
  message_key?: string;
  excerpt?: string;
}

/**
 * #1457: tasks on the user's own UI boards (the boards of the Blueticks web app). Only boards
 * without an AI memory config and that are not audiences are reachable; the in-process
 * adapter enforces that on every call (the `boards` api above is the memory-board one).
 */
export interface BlueticksTasksApi {
  listBoards(params: { limit?: number; offset?: number }): Promise<unknown>;
  getBoard(boardId: string): Promise<unknown>;
  listTasks(
    boardId: string,
    params: { status?: string; updated_since?: string; limit?: number; offset?: number },
  ): Promise<unknown>;
  createTask(
    boardId: string,
    body: {
      text: string;
      status?: string;
      priority?: string;
      due_date?: string;
      cells?: Record<string, string | number>;
      source?: BlueticksTaskSource;
      allow_duplicate?: boolean;
    },
  ): Promise<unknown>;
  updateTask(
    boardId: string,
    taskId: string,
    body: {
      text?: string;
      status?: string;
      priority?: string;
      due_date?: string;
      cells?: Record<string, string | number>;
      deleted?: boolean;
      note?: string;
    },
  ): Promise<unknown>;
}

export interface BlueticksSurface {
  audiences: BlueticksAudiencesApi;
  campaigns: BlueticksCampaignsApi;
  chats: BlueticksChatsApi;
  contacts: BlueticksContactsApi;
  engines: BlueticksEnginesApi;
  groups: BlueticksGroupsApi;
  messages: BlueticksMessagesApi;
  utils: BlueticksUtilsApi;
  webhooks: BlueticksWebhooksApi;
  /**
   * Optional — only the in-process backend adapter implements Suno today.
   * The standalone `blueticks` SDK doesn't ship `.suno` yet, so tool
   * dispatchers must guard `if (!client.suno)` before use.
   */
  suno?: BlueticksSunoApi;
  /** AGENT sessions: an image made from the chat's photos + image urls, sent into the chat. */
  images?: {
    combine(body: { chat_id: string; message_keys?: string[]; image_urls?: string[]; instruction: string }): Promise<unknown>;
  };
  /** AGENT sessions with tools.leads (#1185): record the session's own chat as a lead. */
  qualifyLead?: {
    save(body: { chat_id: string; stage: LeadStage; fields?: Record<string, string> }): Promise<QualifyLeadOutcome>;
  };
  /** AGENT sessions (#1089): follow-ups — one message later, to the agent's own chat or the owner's operator chat. */
  followups?: {
    schedule(body: { chat_id: string; target: 'chat' | 'owner'; text: string; send_at?: string; in_minutes?: number; keep_on_reply?: boolean; calendar_event_id?: string; calendar_id?: string }): Promise<FollowupsScheduleOutcome>;
    list(body: { chat_id: string }): Promise<FollowupsListOutcome>;
    cancel(body: { chat_id: string; followup_id: string }): Promise<FollowupsCancelOutcome>;
  };
  /** AGENT sessions with web access (#829): a page rendered in a browser, as markdown. */
  browsePage?: {
    read(body: { url: string }): Promise<unknown>;
    /** #914: one image as pixels (an MCP image block); refusals are typed, never bytes. */
    image(body: { url: string }): Promise<BrowseImageOutcome>;
  };
  /** AGENT sessions (#965): report a missing capability to the Blueticks team (a Crisp note tagged bot-gap). */
  reportCapabilityGap?: {
    report(body: { capability: string; description: string }): Promise<ReportCapabilityGapOutcome>;
  };
  /** AGENT sessions: the reply spoken as a WhatsApp voice note, sent into the chat. */
  voice?: {
    say(body: { chat_id: string; text: string }): Promise<unknown>;
  };
  /** Optional — only the in-process backend adapter implements the agent calendar. */
  calendar?: BlueticksCalendarApi;
  /**
   * Optional — only the in-process backend adapter implements the AI memory
   * boards today. The standalone `blueticks` SDK doesn't ship `.boards` yet, so
   * the boards tool dispatcher guards `if (!client.boards)` before use.
   */
  boards?: BlueticksBoardsApi;
  /** Optional (#1457) — only the in-process backend adapter implements tasks on UI boards. */
  tasks?: BlueticksTasksApi;
  /**
   * Optional — only the in-process backend adapter implements the "AI
   * Conversation" bridge (create a new linked WhatsApp group + btgpt
   * conversation). The standalone `blueticks` SDK doesn't ship it, so the
   * ai_conversation tool dispatcher guards `if (!client.aiConversations)`.
   */
  aiConversations?: BlueticksAiConversationsApi;
  /**
   * Optional — only the in-process backend adapter implements File Intelligence
   * (identify / ingest_invoice). The standalone SDK doesn't ship `.files`, so
   * the files tool dispatcher guards `if (!client.files)` before use.
   */
  files?: BlueticksFilesApi;
  /**
   * Optional — only the in-process backend adapter implements Bridge-agent
   * creation + scheduling (the standalone SDK doesn't ship them). Lets an
   * interactive session (btgpt / the builder) create a WhatsApp agent and give
   * it a morning/evening trigger. The `agents` tool + `agent_schedules` tool
   * guard on these being present.
   */
  agents?: BlueticksAgentsApi;
  agentSchedules?: BlueticksAgentSchedulesApi;
}

/** Recurrence shape shared by the schedule API + the agent-schedules tool. */
export interface AgentScheduleRecurrenceInput {
  freq: 'hourly' | 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  /** hourly only: every N hours, 1-24 (default 1). */
  interval?: number;
  weekdays?: number[];
  monthday?: number;
  /** IANA tz; omitted = the owner's workspace timezone (agent-schedules service). */
  timezone?: string;
}

/**
 * One wake-up of an agent: a recurrence + what to do + which chat to read +
 * where the result is sent (the Bridge sends it).
 */
export interface AgentTimeTriggerInput {
  recurrence: AgentScheduleRecurrenceInput;
  prompt: string;
  source_chat_id: string;
  dest_chat_id?: string;
  label?: string;
}

/**
 * Create a Bridge WhatsApp agent. Server-enforced grants; the MCP is READ-ONLY
 * (sending is the Bridge's job). `trigger_chat_ids` = chats whose incoming messages
 * activate it (empty = only a schedule activates it); `read_message_chat_ids` = chats
 * it may READ messages from (turns the read MCP on, scoped to them); `read_all_messages`
 * = read any chat; `read_chats_list` = may list the chat list. By DEFAULT (all empty/
 * false) the agent has NO WhatsApp tools.
 */
export interface BlueticksAgentsApi {
  create(body: {
    /** Optional: the server resolves the caller's own project (a foreign id is replaced). */
    client_id?: string;
    label: string;
    /** Required unless `identity_prompt_upload_id` is given (an explicit value wins). */
    identity_prompt?: string;
    /** An owned upload whose TEXT becomes the identity prompt (read server-side). */
    identity_prompt_upload_id?: string;
    /** Owned uploads filed into the agent's knowledge base once it exists. */
    knowledge_upload_ids?: string[];
    trigger_chat_ids?: string[];
    read_message_chat_ids?: string[];
    read_all_messages?: boolean;
    read_chats_list?: boolean;
    /** Creative tools (policy.tools.suno / .images). */
    songs?: boolean;
    images?: boolean;
    include_new_chats?: boolean;
    /** May answer with a voice note (policy tools.voice). */
    voice_replies?: boolean;
    /** When to answer with a voice note (policy voiceWhen). */
    voice_when?: string;
    /** The voice it speaks with — voice notes and calls (policy voiceName). */
    voice_name?: string;
    /** Answers WhatsApp voice calls (policy tools.calls). */
    answer_calls?: boolean;
    /** Trigger filter: 'private' = one-to-one chats only (no groups); 'all' (default) = groups too. */
    chat_types?: 'all' | 'private';
    /** Chats its replies go to INSTEAD of the triggering chat (omit = reply where triggered). */
    send_chat_ids?: string[];
    knowledge_text?: string;
    /** TIME TRIGGERS created ATOMICALLY with the agent (a build never leaves it without its schedule). */
    time_triggers?: AgentTimeTriggerInput[];
    /** Outside apps (MCP servers) to attach UNCONNECTED — each a library id or an https MCP URL; the user connects each. */
    mcp_servers?: string[];
    /** Switch it on/off through the gated agents-page toggle (a new agent is always created paused). */
    enabled?: boolean;
  } & AgentToolArgs): Promise<unknown>;
  /**
   * Change an EXISTING agent (the caller's own). Only the passed fields change;
   * `time_triggers` REPLACES the agent's whole schedule.
   */
  update(body: {
    agent_id: string;
    label?: string;
    identity_prompt?: string;
    identity_prompt_upload_id?: string;
    knowledge_upload_ids?: string[];
    trigger_chat_ids?: string[];
    read_message_chat_ids?: string[];
    read_all_messages?: boolean;
    read_chats_list?: boolean;
    /** Creative tools (policy.tools.suno / .images). */
    songs?: boolean;
    images?: boolean;
    include_new_chats?: boolean;
    /** May answer with a voice note (policy tools.voice). */
    voice_replies?: boolean;
    /** When to answer with a voice note (policy voiceWhen). */
    voice_when?: string;
    /** The voice it speaks with — voice notes and calls (policy voiceName). */
    voice_name?: string;
    /** Answers WhatsApp voice calls (policy tools.calls). */
    answer_calls?: boolean;
    /** Trigger filter: 'private' = one-to-one chats only (no groups); 'all' (default) = groups too. */
    chat_types?: 'all' | 'private';
    send_chat_ids?: string[];
    time_triggers?: AgentTimeTriggerInput[];
    /** Outside apps to ADD (unconnected); servers already on the agent stay. */
    mcp_servers?: string[];
    /** Switch it on/off through the gated agents-page toggle (a new agent is always created paused). */
    enabled?: boolean;
    /** Replaces the agent's knowledge-base text (the pasted blob, not an uploaded file). */
    knowledge_text?: string;
  } & AgentToolArgs): Promise<unknown>;
  /**
   * The caller's own agents, in the shape `/my-bridge/overview` returns them:
   * `{ agents, policies, schedules }` (policies keyed by agent id).
   */
  list(): Promise<unknown>;
  /** One of the caller's agents: `{ agent, policy, schedules }`; a foreign/unknown id is NotFound. */
  get(agentId: string): Promise<unknown>;
  /**
   * Files an owned upload into an agent's knowledge base (the agent must be the
   * caller's own). Optional — only the in-process backend adapter implements it,
   * so tool dispatchers must guard `if (!client.agents.addKnowledgeFile)`.
   */
  addKnowledgeFile?(body: { agent_id: string; upload_id: string; file_name?: string }): Promise<unknown>;
  /**
   * Stores a file the caller supplies inline (exactly one of file_text / file_base64) in the
   * owner-scoped upload store -> { upload_id, name, mime, size }. The upload_id is what
   * add_knowledge_file / knowledge_upload_ids / identity_prompt_upload_id take. Optional - only
   * the in-process backend adapter implements it.
   */
  upload?(body: { file_name: string; file_text?: string; file_base64?: string; mime_type?: string }): Promise<unknown>;
}

/** Set/replace an agent's schedule, and list an agent's schedules. */
export interface BlueticksAgentSchedulesApi {
  set(body: {
    agent_id: string;
    client_id: string;
    prompt: string;
    source_chat_id: string;
    dest_chat_id?: string;
    recurrence: AgentScheduleRecurrenceInput;
    label?: string;
  }): Promise<unknown>;
  list(agentId?: string): Promise<unknown>;
}

/**
 * btgpt "AI Conversation" bridge. Creating a conversation also creates its
 * dedicated WhatsApp group server-side and links the two.
 */
export interface BlueticksAiConversationsApi {
  /** Create a new conversation + its linked WA group → { conversationId, groupId, groupName }. */
  create(body: { topic?: string }): Promise<unknown>;
}

/**
 * File Intelligence — identify documents/images and one-call invoice ingestion.
 * Optional (in-process backend adapter only): the standalone SDK doesn't ship
 * it, so the files tool dispatcher guards `if (!client.files)`. The adapter has
 * the app + user identity the LLM-facing tool lacks (media fetch, GCS, boards).
 */
export interface BlueticksFilesApi {
  /**
   * Fetch bytes (by WhatsApp message_key, a plain url, OR — I3 fix — an
   * `upload_id` from a file the user attached to THIS chat via the AI chat
   * upload path), classify + extract → file_intel result. `upload_id` is
   * resolved owner-scoped (a foreign/unknown id errors) to a short-TTL signed
   * read URL for the ORIGINAL object by the in-process adapter.
   */
  identify(body: { message_key?: string; url?: string; upload_id?: string; filename?: string }): Promise<unknown>;
  /** One-call invoice flow: identify → find-or-create Invoices board → create row → attach file. `upload_id`: see {@link identify}. */
  ingestInvoice(body: {
    message_key?: string;
    url?: string;
    upload_id?: string;
    board_id?: string;
    filename?: string;
  }): Promise<unknown>;
}

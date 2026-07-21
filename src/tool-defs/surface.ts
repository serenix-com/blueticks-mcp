/**
 * The public Blueticks API surface that MCP tool builders depend on.
 *
 * Tool builders take a `BlueticksSurface` rather than the concrete
 * `Blueticks` SDK class so multiple transports can drive the same tools:
 *
 *   - The standalone MCP server hands them a real `Blueticks` instance,
 *     which goes over HTTPS to the Blueticks v1 API. The SDK class
 *     structurally satisfies this interface — every method shape here
 *     mirrors the SDK's existing public method shape (the standalone's
 *     `src/index.ts` types the handed-in client as `BlueticksSurface`,
 *     so any drift between this surface and the real 2.0 SDK is a
 *     compile error).
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
 * and the v1 service's looser returns satisfy `Promise<unknown>` via
 * covariance, so neither side needs casts at the boundary.
 *
 * Naming + shape track the 2.0 SDK (v4.x): responses are camelCase and
 * `{success,data}`-unwrapped, pagination is OFFSET (`limit`/`skip`, not
 * cursor), immediate/history message ops live on `messages`, and the
 * queue lives on `scheduledMessages`.
 */

/** Offset pagination params shared by every list endpoint. */
interface ListParams {
  limit?: number;
  skip?: number;
}

/** Media kinds accepted by direct/scheduled sends (mirrors SDK MediaKind). */
type MediaKind = "image" | "video" | "audio" | "document" | "sticker" | "voice" | "gif";

/** Lifecycle status of a queued/sent message (mirrors SDK MessageStatus). */
type MessageStatus =
  | "pending"
  | "before-wa-send"
  | "bt-sent"
  | "sending"
  | "sent"
  | "sent_pending_ack"
  | "confirmed"
  | "delivered"
  | "received"
  | "read"
  | "played"
  | "cancelled"
  | "error"
  | "failed"
  | "expired";

/** Message kinds accepted by the `messageTypes` filter on `messages.list`. */
type MessageType =
  | "chat"
  | "image"
  | "video"
  | "document"
  | "audio"
  | "ptt"
  | "sticker"
  | "gif"
  | "ptv"
  | "poll_creation"
  | "location"
  | "vcard"
  | "revoked";

/** A single contact in an audience (matches SDK ContactInput). */
interface ContactInput {
  to: string;
  variables?: Record<string, string>;
}

/** Flat body for `messages.send` (immediate, fire-and-forget). */
interface DirectSendMessageBody {
  type: "text" | "media" | "poll";
  text?: string;
  replyTo?: string;
  mediaUrl?: string;
  mediaBase64?: string;
  mediaKind?: MediaKind;
  mediaFilename?: string;
  pollQuestion?: string;
  pollOptions?: string[];
  pollAllowMultiple?: boolean;
  secret?: string;
  withTyping?: boolean;
  typingSeconds?: number;
}

/** Flat body for `scheduledMessages.create` (send now or defer via sendAt). */
interface SendMessageBody {
  type: "text" | "media" | "poll";
  text?: string;
  replyTo?: string;
  mediaUrl?: string;
  mediaBase64?: string;
  mediaKind?: MediaKind;
  mediaFilename?: string;
  pollQuestion?: string;
  pollOptions?: string[];
  pollAllowMultiple?: boolean;
  secret?: string;
  sendAt?: string;
}

/** Flat body for `scheduledMessages.update` (edit a pending message). */
interface UpdateScheduledMessageBody {
  type?: "text" | "media" | "poll";
  text?: string;
  replyTo?: string;
  mediaUrl?: string;
  mediaBase64?: string;
  mediaKind?: MediaKind;
  mediaFilename?: string;
  pollQuestion?: string;
  pollOptions?: string[];
  pollAllowMultiple?: boolean;
  secret?: string;
  sendAt?: string;
}

export interface BlueticksAudiencesApi {
  list(params?: ListParams & { order?: "asc" | "desc" }): Promise<unknown>;
  create(body: { name: string; contacts?: ContactInput[] }): Promise<unknown>;
  get(id: string): Promise<unknown>;
  update(id: string, body: { name: string }): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  appendContacts(id: string, contacts: ContactInput[]): Promise<unknown>;
  updateContact(
    audienceId: string,
    contactId: string,
    body: { to?: string; variables?: Record<string, string> },
  ): Promise<unknown>;
  deleteContact(audienceId: string, contactId: string): Promise<unknown>;
}

export interface BlueticksCampaignsApi {
  list(params?: ListParams & { order?: "asc" | "desc" }): Promise<unknown>;
  create(body: {
    name: string;
    audienceId: string;
    text?: string;
    mediaUrl?: string;
    mediaCaption?: string;
    onMissingVariable?: "fail" | "skip";
  }): Promise<unknown>;
  get(id: string): Promise<unknown>;
  pause(id: string): Promise<unknown>;
  resume(id: string): Promise<unknown>;
  cancel(id: string): Promise<unknown>;
}

export interface BlueticksChatsApi {
  list(
    params?: ListParams & {
      searchToken?: string;
      filter?: "groups" | "contacts" | "newsletters";
      includeLastMessage?: boolean;
      includeExtendedInfo?: boolean;
      includeWithoutName?: boolean;
      includeArchive?: boolean;
    },
  ): Promise<unknown>;
  get(id: string): Promise<unknown>;
  listParticipants(chatId: string, params?: ListParams & { searchToken?: string }): Promise<unknown>;
  markRead(chatId: string): Promise<unknown>;
  archive(chatId: string): Promise<unknown>;
  unarchive(chatId: string): Promise<unknown>;
}

export interface BlueticksContactsApi {
  list(params?: ListParams & { searchToken?: string; includeArchive?: boolean }): Promise<unknown>;
  listCommonGroups(id: string): Promise<unknown>;
}

export interface BlueticksEnginesApi {
  /**
   * List the WhatsApp engines connected to this workspace — one entry per
   * online engine. Empty array when nothing is connected (not an error).
   * Replaces the 1.x single-object `status()`.
   */
  list(): Promise<unknown>;
}

export interface BlueticksGroupsApi {
  list(params?: ListParams & { searchToken?: string; includeArchive?: boolean }): Promise<unknown>;
  /**
   * @param opts.include - `'participants'` populates `participants[]` inline
   *   (chatId + admin flags) so the caller doesn't need a follow-up
   *   participants query. Native in the 2.0 SDK.
   */
  get(groupId: string, opts?: { include?: "participants" }): Promise<unknown>;
  create(body: { name: string; participants: string[] }): Promise<unknown>;
  update(
    groupId: string,
    body: {
      name?: string;
      settings?: {
        announce?: boolean;
        restrict?: boolean;
        editInfoAdminsOnly?: boolean;
        description?: string;
      };
    },
  ): Promise<unknown>;
  /**
   * Cancel the authenticated user's membership in the group. WhatsApp
   * doesn't expose a "destroy group" semantic — the group continues to
   * exist for any remaining members; only this user's membership ends.
   */
  leave(groupId: string): Promise<unknown>;
}

export interface BlueticksMessagesApi {
  /** List messages across all chats (or scoped to `chatId`). Offset-paginated. */
  list(
    params?: ListParams & {
      chatId?: string;
      searchToken?: string;
      order?: "asc" | "desc";
      since?: string;
      until?: string;
      messageTypes?: MessageType[];
      loadFromPhoneIfNeeded?: boolean;
      includeMediaContent?: boolean;
    },
  ): Promise<unknown>;
  /** Send a message NOW to `chatId` (fire-and-forget; no DB row). */
  send(chatId: string, body: DirectSendMessageBody): Promise<unknown>;
  /** Download media attached to a message by its WhatsApp wire key. */
  getMedia(
    waMessageKey: string,
    opts?: { chatId?: string; maxAttempts?: number },
  ): Promise<unknown>;
  /** Ask the engine to pull older history for a not-fully-synced chat. */
  loadOlder(chatId: string): Promise<unknown>;
  /** Batch delivery-status lookup for up to 200 wire keys. */
  batchAcks(body: { messageKeys: string[]; chatId?: string }): Promise<unknown>;
}

export interface BlueticksScheduledMessagesApi {
  list(
    params?: ListParams & {
      chatId?: string;
      searchToken?: string;
      status?: MessageStatus;
      order?: "asc" | "desc";
    },
  ): Promise<unknown>;
  /** Send-now or schedule (via `sendAt`) a message to `chatId`. */
  create(
    chatId: string,
    body: SendMessageBody,
    opts?: { idempotencyKey?: string },
  ): Promise<unknown>;
  retrieve(id: string): Promise<unknown>;
  update(id: string, body: UpdateScheduledMessageBody): Promise<unknown>;
  delete(id: string): Promise<unknown>;
}

export interface BlueticksWebhooksApi {
  list(params?: ListParams & { order?: "asc" | "desc" }): Promise<unknown>;
  get(id: string): Promise<unknown>;
  create(body: { url: string; events: string[]; description?: string }): Promise<unknown>;
  update(
    id: string,
    body: {
      url?: string;
      events?: string[];
      description?: string | null;
      status?: "enabled" | "disabled";
    },
  ): Promise<unknown>;
  delete(id: string): Promise<unknown>;
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
}

export interface BlueticksSurface {
  audiences: BlueticksAudiencesApi;
  campaigns: BlueticksCampaignsApi;
  chats: BlueticksChatsApi;
  contacts: BlueticksContactsApi;
  engines: BlueticksEnginesApi;
  groups: BlueticksGroupsApi;
  messages: BlueticksMessagesApi;
  scheduledMessages: BlueticksScheduledMessagesApi;
  webhooks: BlueticksWebhooksApi;
  /**
   * Optional — only the in-process backend adapter implements Suno today.
   * The standalone `blueticks` SDK doesn't ship `.suno` yet, so tool
   * dispatchers must guard `if (!client.suno)` before use.
   */
  suno?: BlueticksSunoApi;
}

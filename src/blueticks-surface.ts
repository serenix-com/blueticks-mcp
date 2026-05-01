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
    from?: string;
    on_missing_variable?: 'fail' | 'skip';
  }): Promise<unknown>;
  pause(id: string): Promise<unknown>;
  resume(id: string): Promise<unknown>;
  cancel(id: string): Promise<unknown>;
}

export interface BlueticksChatsApi {
  list(params: { query?: string; limit?: number; cursor?: string }): Promise<unknown>;
  get(chatId: string): Promise<unknown>;
  listMessages(
    chatId: string,
    params: {
      limit?: number;
      cursor?: string;
      mode?: 'history' | 'latest';
      query?: string;
      since?: string;
      until?: string;
      // Mirrors the SDK's ListMessagesParams.message_types union — keep
      // these in lockstep with both the SDK and the chats-tool zod enum.
      message_types?: Array<
        | 'chat'
        | 'image'
        | 'video'
        | 'document'
        | 'audio'
        | 'ptt'
        | 'sticker'
        | 'gif'
        | 'ptv'
        | 'poll_creation'
        | 'location'
        | 'vcard'
        | 'revoked'
      >;
    },
  ): Promise<unknown>;
  getMedia(chatId: string, key: string): Promise<unknown>;
  markRead(chatId: string): Promise<unknown>;
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
  get(groupId: string): Promise<unknown>;
  create(body: { name: string; participants: string[] }): Promise<unknown>;
  update(
    groupId: string,
    body: {
      name?: string;
      settings?: { announce?: boolean; restrict?: boolean };
    },
  ): Promise<unknown>;
}

export interface BlueticksMessagesApi {
  send(body: {
    to: string;
    text?: string;
    media_url?: string;
    media_caption?: string;
    send_at?: string;
    from?: string;
  }): Promise<unknown>;
  get(id: string): Promise<unknown>;
  list(params: { limit?: number; cursor?: string }): Promise<unknown>;
}

export interface BlueticksUtilsApi {
  validatePhone(body: { phone_or_chat_id: string }): Promise<unknown>;
  linkPreview(params: { url: string }): Promise<unknown>;
  currentDateTime(): Promise<unknown>;
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
  rotateSecret(id: string): Promise<unknown>;
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
}

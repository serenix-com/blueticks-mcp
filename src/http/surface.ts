// The BlueticksSurface the vendored tool defs call, implemented over /v1 HTTP.
//
// Mirrors the hosted server's in-process adapter
// (whatsapp-scheduler-backend src/mcp/services/in-process-blueticks.ts) route by
// route, reusing the same argument mappers (tool-defs/surface-mapping.ts, plus
// the adapter-local ones ported into ./v1-mapping.ts), so a tool call reaches
// /v1 with the same query and body whichever server it runs on.
//
// Not provided, and why:
// - `chats.listMessagesBatch`: no /v1 route. The chats tool falls back to one
//   `listMessages` call per chat when it is absent.
// - agents / agent schedules: no /v1 route serves them to an API key.
// - suno, images, voice, followups, calendar, browsePage, qualifyLead,
//   reportCapabilityGap, boards, files, aiConversations: agent-session or
//   hosted-only tools; the npm manifest does not register them.
import type {
  BlueticksAudiencesApi,
  BlueticksCampaignsApi,
  BlueticksChatsApi,
  BlueticksContactsApi,
  BlueticksEnginesApi,
  BlueticksGroupsApi,
  BlueticksMessagesApi,
  BlueticksSurface,
  BlueticksTasksApi,
  BlueticksUtilsApi,
  BlueticksWebhooksApi,
} from "../tool-defs";
import {
  compact,
  mapBatchAcksBody,
  mapChatsSendBody,
  mapEngineTarget,
  mapGroupGetQuery,
  mapLatestChatsQuery,
  mapListChatsQuery,
  mapListContactsQuery,
  mapListMessagesQuery,
  mapLoadOlderBody,
} from "../tool-defs/surface-mapping";
import { BlueticksApiError, type HttpTransport, seg } from "./transport";
import {
  buildScheduledMessagePatch,
  buildScheduledMessagesListQuery,
  buildScheduledSendBody,
  omitSigningSecret,
} from "./v1-mapping";

/** The surface this package serves: every core API, plus tasks on the user's UI boards. */
export type HttpSurface = Pick<
  BlueticksSurface,
  | "audiences"
  | "campaigns"
  | "chats"
  | "contacts"
  | "engines"
  | "groups"
  | "messages"
  | "utils"
  | "webhooks"
> & { tasks: BlueticksTasksApi };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function audiences(http: HttpTransport): BlueticksAudiencesApi {
  return {
    list: (q) => http.get("/v1/audiences", q),
    get: (id) => http.get(`/v1/audiences/${seg(id)}`),
    create: (body) => http.post("/v1/audiences", body),
    update: (id, body) => http.patch(`/v1/audiences/${seg(id)}`, body),
    delete: (id) => http.delete(`/v1/audiences/${seg(id)}`),
    appendContacts: (id, contacts) => http.post(`/v1/audiences/${seg(id)}/contacts`, { contacts }),
    updateContact: (audienceId, contactId, body) =>
      http.patch(`/v1/audiences/${seg(audienceId)}/contacts/${seg(contactId)}`, body),
    deleteContact: (audienceId, contactId) =>
      http.delete(`/v1/audiences/${seg(audienceId)}/contacts/${seg(contactId)}`),
  };
}

function campaigns(http: HttpTransport): BlueticksCampaignsApi {
  return {
    list: (q) => http.get("/v1/campaigns", q),
    get: (id) => http.get(`/v1/campaigns/${seg(id)}`),
    // The surface is snake_case; v1 is camelCase.
    create: (body) =>
      http.post(
        "/v1/campaigns",
        compact({
          name: body.name,
          audienceId: body.audience_id,
          text: body.text,
          mediaUrl: body.media_url,
          mediaCaption: body.media_caption,
          onMissingVariable: body.on_missing_variable,
          sendAt: body.send_at,
        }),
      ),
    pause: (id) => http.post(`/v1/campaigns/${seg(id)}/pause`),
    resume: (id) => http.post(`/v1/campaigns/${seg(id)}/resume`),
    cancel: (id) => http.post(`/v1/campaigns/${seg(id)}/cancel`),
  };
}

function chats(http: HttpTransport): BlueticksChatsApi & { listAllMessages: NonNullable<BlueticksChatsApi["listAllMessages"]> } {
  return {
    list: (args = {}) => http.get("/v1/chats", mapListChatsQuery(args)),
    getLatestChatsAndMessages: (args = {}) => http.get("/v1/latest-chats", mapLatestChatsQuery(args)),
    get: (chatId, opts) => http.get(`/v1/chats/${seg(chatId)}`, mapEngineTarget(opts)),
    listMessages: (chatId, args = {}) => http.get("/v1/messages", { chatId, ...mapListMessagesQuery(args) }),
    // No chat: the engine searches every chat.
    listAllMessages: (args = {}) => http.get("/v1/messages", mapListMessagesQuery(args)),
    // BE#145: MCP callers get small images inlined as base64; plain REST gets a url only.
    getMedia: (chatId, key, opts) =>
      http.get(`/v1/messages/media/${seg(key)}`, { chatId, ...mapEngineTarget(opts), inline_base64: true }),
    markRead: (chatId) => http.post(`/v1/chats/${seg(chatId)}/mark_read`),
    react: (chatId, key, emoji) => http.post(`/v1/messages/reactions/${seg(key)}`, { emoji }, { query: { chatId } }),
    getPollResults: (chatId, key) => http.get(`/v1/messages/poll_results/${seg(key)}`, { chatId }),
    archive: (chatId) => http.post(`/v1/chats/${seg(chatId)}/archive`),
    unarchive: (chatId) => http.post(`/v1/chats/${seg(chatId)}/unarchive`),
    batchMessageAcks: (body) => http.post("/v1/messages/acks", mapBatchAcksBody(body)),
    listParticipants: (chatId, opts) => http.get(`/v1/chats/${seg(chatId)}/participants`, mapEngineTarget(opts)),
    loadOlderMessages: (chatId, opts) =>
      http.post(`/v1/messages/load_older/${seg(chatId)}`, mapLoadOlderBody(opts ?? {}), {
        query: mapEngineTarget(opts),
      }),
    // Without a caller key no Idempotency-Key header is sent, so the server's
    // automatic chat+content key (#590) still guards a retried send.
    sendMessage: (chatId, body, opts) =>
      http.post(`/v1/messages/${seg(chatId)}`, mapChatsSendBody(body), {
        ...(opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      }),
  };
}

function contacts(http: HttpTransport): BlueticksContactsApi {
  return {
    list: (args = {}) => http.get("/v1/contacts", mapListContactsQuery(args)),
    getProfilePicture: (chatId) => http.get(`/v1/contacts/${seg(chatId)}/profile_picture`),
  };
}

function engines(http: HttpTransport): BlueticksEnginesApi {
  return {
    status: () => http.get("/v1/engines"),
    logout: () => http.post("/v1/engines/logout"),
    reload: () => http.post("/v1/engines/reload"),
  };
}

function groups(http: HttpTransport): BlueticksGroupsApi {
  return {
    get: (groupId, opts) => http.get(`/v1/groups/${seg(groupId)}`, mapGroupGetQuery(opts)),
    create: (body) => http.post("/v1/groups", body),
    // PATCH answers with a status only; read the group back, as hosted does.
    update: async (groupId, body) => {
      await http.patch(`/v1/groups/${seg(groupId)}`, body);
      return http.get(`/v1/groups/${seg(groupId)}`);
    },
    leave: (groupId) => http.delete(`/v1/groups/${seg(groupId)}/members/me`),
    getPicture: (groupId) => http.get(`/v1/groups/${seg(groupId)}/picture`),
    setPicture: (groupId, body) => http.put(`/v1/groups/${seg(groupId)}/picture`, body),
    removePicture: (groupId) => http.delete(`/v1/groups/${seg(groupId)}/picture`),
  };
}

function messages(http: HttpTransport): BlueticksMessagesApi {
  return {
    send: (body) => http.post(`/v1/scheduled-messages/${seg(body.to)}`, buildScheduledSendBody(body)),
    get: (id) => http.get(`/v1/scheduled-messages/${seg(id)}`),
    list: (q) => http.get("/v1/scheduled-messages", { ...buildScheduledMessagesListQuery(q) }),
    update: (id, body) => http.patch(`/v1/scheduled-messages/${seg(id)}`, buildScheduledMessagePatch(body)),
    cancel: (id) => http.post(`/v1/scheduled-messages/${seg(id)}/cancel`),
  };
}

function utils(http: HttpTransport): BlueticksUtilsApi {
  return {
    validatePhone: (body) => http.post("/v1/utils/validate_phone", { phoneOrChatId: body.phone_or_chat_id }),
    linkPreview: (q) => http.get("/v1/utils/link_preview", q),
    currentDateTime: () => http.get("/v1/utils/current_date_time"),
  };
}

function webhooks(http: HttpTransport): BlueticksWebhooksApi {
  return {
    // #179: the signing secret is returned on create only.
    list: async (q) => omitSigningSecret(await http.get("/v1/webhooks", q)),
    get: async (id) => omitSigningSecret(await http.get(`/v1/webhooks/${seg(id)}`)),
    create: (body) => http.post("/v1/webhooks", body),
    update: async (id, body) => omitSigningSecret(await http.patch(`/v1/webhooks/${seg(id)}`, body)),
    delete: (id) => http.delete(`/v1/webhooks/${seg(id)}`),
  };
}

function boardNotFound(boardId: string): BlueticksApiError {
  return new BlueticksApiError({
    statusCode: 404,
    code: "not_found",
    message: `No board found for id ${boardId}`,
    requestId: null,
  });
}

/**
 * #1457: tasks on the user's own UI boards. Hosted scopes every call to UI
 * boards server-side (`boardScope: 'ui'`), which /v1 does not expose to a REST
 * caller. Here the list drops agent-managed boards, and each by-id call first
 * proves the board is a UI board: not agent-managed, and not an audience (an
 * audience is a board underneath and shares its id). Anything else is a 404,
 * as on hosted. Because the list is filtered client-side, `total` can count
 * hidden memory boards.
 */
function tasks(http: HttpTransport): BlueticksTasksApi {
  const isNotFound = (err: unknown): boolean => err instanceof BlueticksApiError && err.statusCode === 404;

  const requireUiBoard = async (boardId: string): Promise<unknown> => {
    const [board, audience] = await Promise.all([
      http.get(`/v1/boards/${seg(boardId)}`),
      http.get(`/v1/audiences/${seg(boardId)}`).then(
        () => true,
        (err: unknown) => {
          if (isNotFound(err)) return false;
          throw err;
        },
      ),
    ]);
    if (audience || !isRecord(board) || board.agent_managed !== false) throw boardNotFound(boardId);
    return board;
  };

  return {
    listBoards: async ({ limit, offset }) => {
      const page = await http.get("/v1/boards", compact({ limit, skip: offset }));
      if (!isRecord(page) || !Array.isArray(page.data)) return page;
      return { ...page, data: page.data.filter((b) => isRecord(b) && b.agent_managed === false) };
    },
    getBoard: (boardId) => requireUiBoard(boardId),
    listTasks: async (boardId, { status, updated_since, limit, offset }) => {
      await requireUiBoard(boardId);
      return http.get(`/v1/boards/${seg(boardId)}/items`, compact({ status, updated_since, limit, skip: offset }));
    },
    createTask: async (boardId, body) => {
      await requireUiBoard(boardId);
      return http.post(`/v1/boards/${seg(boardId)}/items`, body);
    },
    updateTask: async (boardId, taskId, body) => {
      await requireUiBoard(boardId);
      return http.patch(`/v1/boards/${seg(boardId)}/items/${seg(taskId)}`, body);
    },
  };
}

export function createHttpSurface(http: HttpTransport): HttpSurface {
  return {
    audiences: audiences(http),
    campaigns: campaigns(http),
    chats: chats(http),
    contacts: contacts(http),
    engines: engines(http),
    groups: groups(http),
    messages: messages(http),
    utils: utils(http),
    webhooks: webhooks(http),
    tasks: tasks(http),
  };
}

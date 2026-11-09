/**
 * Pure SDK→v1 argument mappers shared by every BlueticksSurface implementation
 * (the in-process OAuth-MCP surface and the Instinct pilot's HTTP surface). The
 * SDK/tool-facing arg shape is snake_case and paginates with an opaque `cursor`;
 * the v1 services take camelCase query names and a numeric `skip`. Keeping these
 * translations in ONE place means a future tool/query change updates both
 * transports at once (DRY), and the two surfaces can never drift on wire names.
 *
 * These functions are transport-agnostic: they only reshape the argument object.
 * How the reshaped query/body reaches v1 (in-process service call vs HTTP query
 * string) is the transport's concern, not this module's.
 */

/** Drop keys whose value is `undefined` so v1's `.strict()` query schemas don't choke. */
export function compact<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

/** A non-null, non-array object, narrowed so its fields can be read without a cast. */
export function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The SDK surface paginates with an opaque string `cursor`; v1 list endpoints
 * page by a numeric `skip`. Coerce a numeric cursor to `skip`; ignore anything
 * non-numeric so a bad cursor degrades to "page 0" rather than a schema error.
 */
export function cursorToSkip(cursor?: string): number | undefined {
  if (cursor === undefined) return undefined;
  const n = Number(cursor);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** SDK message `mode` → v1 `order` (latest≡desc / history≡asc). */
export function modeToOrder(mode?: string): 'asc' | 'desc' | undefined {
  return mode === 'history' ? 'asc' : mode === 'latest' ? 'desc' : undefined;
}

/** Engine-targeted read (override BE#302): `engine` = kind preference, `engine_id` = exact presence clientId (wins). v1 names: engine/engineId. */
export interface EngineTargetArgs { engine?: string; engine_id?: string; number?: string; fanout_limit?: number; }
/**
 * #1155: `number` is one of the account's WhatsApp numbers: a 24-hex numberId, else an E.164 phone (the backend
 * normalises it). `fanout_limit` caps a no-target read across numbers. Both ride with the engine target.
 */
export function mapNumberSelector(number?: string, fanoutLimit?: number): Record<string, unknown> {
  const isId = number !== undefined && /^[0-9a-f]{24}$/i.test(number);
  return compact({
    numberId: isId ? number : undefined,
    phone: number !== undefined && !isId ? number : undefined,
    fanoutLimit,
  });
}
export function mapEngineTarget(a?: EngineTargetArgs | null): Record<string, unknown> {
  return compact({ engine: a?.engine, engineId: a?.engine_id, ...mapNumberSelector(a?.number, a?.fanout_limit) });
}

export interface ListChatsArgs extends EngineTargetArgs {
  query?: string; limit?: number; skip?: number; kinds?: unknown;
  include_last_message?: boolean; since?: string; include_archive?: boolean;
}
export function mapListChatsQuery(a: ListChatsArgs = {}): Record<string, unknown> {
  return compact({
    searchToken: a.query, limit: a.limit, skip: a.skip, kinds: a.kinds,
    includeLastMessage: a.include_last_message, since: a.since, includeArchive: a.include_archive,
    ...mapEngineTarget(a),
  });
}

export interface LatestChatsArgs extends EngineTargetArgs { numberOfChats?: number; numberOfMessages?: number; }
export function mapLatestChatsQuery(a: LatestChatsArgs = {}): Record<string, unknown> {
  return compact({ numberOfChats: a.numberOfChats, numberOfMessages: a.numberOfMessages, ...mapEngineTarget(a) });
}

export interface ListMessagesArgs extends EngineTargetArgs {
  limit?: number; cursor?: string; mode?: string; query?: string; query_any?: unknown;
  since?: string; until?: string; message_types?: unknown; mime?: string;
  filename_contains?: string; has_media?: boolean; sender?: string;
}
export function mapListMessagesQuery(a: ListMessagesArgs = {}): Record<string, unknown> {
  return compact({
    searchToken: a.query, queryAny: a.query_any, mime: a.mime, filenameContains: a.filename_contains,
    hasMedia: a.has_media, sender: a.sender, limit: a.limit, skip: cursorToSkip(a.cursor),
    order: modeToOrder(a.mode), since: a.since, until: a.until, messageTypes: a.message_types,
  });
}

export interface ListContactsArgs { query?: string; limit?: number; cursor?: string; }
export function mapListContactsQuery(a: ListContactsArgs = {}): Record<string, unknown> {
  return compact({ searchToken: a.query, limit: a.limit, skip: cursorToSkip(a.cursor) });
}

export interface LoadOlderArgs { pages?: number; until_date?: string | number; }
export function mapLoadOlderBody(a: LoadOlderArgs = {}): Record<string, unknown> {
  return compact({ pages: a.pages, until_date: a.until_date });
}

export interface GroupGetOpts { include?: readonly string[]; }
export function mapGroupGetQuery(opts?: GroupGetOpts): Record<string, unknown> {
  return opts?.include?.length ? { include: opts.include.join(',') } : {};
}

/** SDK batch-ack (snake_case) → v1 camelCase body. */
export function mapBatchAcksBody(body: { message_keys: string[] }): { messageKeys: string[] } {
  return { messageKeys: body.message_keys };
}

/**
 * The `chats` send body → v1's FLAT, STRICT `SendInChatRequest` (camelCase).
 *
 * The `chats` MCP tool emits a NESTED, snake_case body —
 * `{type, text?, media:{url?,data_base64?,kind?,mime_type?,caption?,filename?},
 * poll:{question,options,allow_multiple?}, reply_to?, mentions?}` — but
 * `chats.service.createMessage` parses `SendInChatRequest.strict()`, which knows
 * ONLY the flat fields (`mediaUrl`/`mediaBase64`/`mediaKind`/`mediaFilename`/
 * `mediaMimeType`/`pollQuestion`/`pollOptions`/`pollAllowMultiple`/`text`). An
 * unmapped nested `media`/`poll` key made the send 400 with
 * "Unrecognized key(s)" — so `send_message_media`/`send_message_poll` never
 * reached the engine (only the already-flat `send_message_text` worked).
 *
 * This mapper flattens the nested groups AND leaves any ALREADY-flat camelCase
 * body untouched (internal callers — handle-btgpt-wa-event, activation — send
 * `{type:'text', text, replyTo}` / flat `pollQuestion…` directly), so both
 * producers reach the strict schema intact. Media source precedence matches v1
 * (`refineSendType`): `url` wins over `data_base64`, so only the winning source
 * is forwarded. A media `caption` folds into the flat `text` field (v1 has no
 * separate caption). `reply_to` → `replyTo` (the snake_case wire name would be
 * rejected by the strict schema).
 */
export function mapChatsSendBody(body: unknown): Record<string, unknown> {
  const b: Record<string, unknown> = isPlainRecord(body) ? body : {};
  const { reply_to, media, poll, engine_id, ...rest } = b;
  // Pass through everything that is NOT one of the nested groups: `type`,
  // `text`, `mentions`, and any already-flat camelCase field an internal
  // caller supplied (`replyTo`, `mediaUrl`, `pollQuestion`, …).
  const out: Record<string, unknown> = { ...rest };
  if (reply_to !== undefined && out.replyTo === undefined) out.replyTo = reply_to;
  // snake_case engine_id → the v1 body's engineId (engine / from pass through as-is).
  if (engine_id !== undefined && out.engineId === undefined) out.engineId = engine_id;
  if (isPlainRecord(media)) {
    const m = media;
    // url wins over data_base64 — forward only the winning source.
    if (typeof m.url === 'string' && m.url.length > 0) out.mediaUrl = m.url;
    else if (typeof m.data_base64 === 'string' && m.data_base64.length > 0) out.mediaBase64 = m.data_base64;
    if (m.kind !== undefined) out.mediaKind = m.kind;
    if (m.filename !== undefined) out.mediaFilename = m.filename;
    if (m.mime_type !== undefined) out.mediaMimeType = m.mime_type;
    // caption folds into `text` (no separate caption field on v1); don't
    // clobber an explicit top-level `text` if one was somehow provided.
    if (typeof m.caption === 'string' && m.caption.length > 0 && out.text === undefined) out.text = m.caption;
  }
  if (isPlainRecord(poll)) {
    const p = poll;
    if (p.question !== undefined) out.pollQuestion = p.question;
    if (p.options !== undefined) out.pollOptions = p.options;
    if (p.allow_multiple !== undefined) out.pollAllowMultiple = p.allow_multiple;
  }
  return out;
}

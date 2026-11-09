/**
 * Error → MCP-tool-response shaping.
 *
 * Originally `instanceof APIError` / `instanceof BluetickError` against
 * the `blueticks` SDK runtime classes — but tools now run in two
 * contexts: the standalone (with the SDK on hand) AND the OAuth-MCP
 * in-process path (no SDK). To keep this file dependency-free, the SDK
 * error classes are duck-typed via shape checks. Both real
 * `BluetickError`s thrown by the SDK and Feathers-style errors thrown
 * by the in-process adapter route through this without needing
 * `blueticks` as a runtime/types dep.
 */

import { classifyMcpError, type McpErrorCode } from "./error-codes";
import { REASON_STATUSES, reasonForThrown, slugOfCustomMessage } from "./error-reason";

/** The image types an MCP image block may carry (#914): the bytes are sniffed, never the header. Single source. */
export const TOOL_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ToolImageMime = (typeof TOOL_IMAGE_MIMES)[number];

export type ToolContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: ToolImageMime };

export interface ToolResult {
  isError?: boolean;
  content: ToolContentBlock[];
}

/** The text of a content block; an image block has none (""), so text-only consumers can join blocks safely. */
export function toolText(block: ToolContentBlock | undefined): string {
  return block?.type === "text" ? block.text : "";
}

interface ApiErrorLike {
  statusCode?: number;
  code?: string;
  message: string;
  requestId?: string | null;
  details?: unknown[];
}

function isApiErrorLike(err: unknown): err is ApiErrorLike {
  if (!err || typeof err !== "object") return false;
  // SDK's APIError sets `requestId`; Feathers/standalone HTTP errors
  // don't. Use it as the discriminator so we only enter this branch
  // for SDK-shaped errors and not for plain HTTP-flavored ones.
  return "requestId" in err && "statusCode" in err;
}

interface BluetickErrorLike {
  statusCode?: number;
  code?: string;
  message: string;
  details?: unknown[];
}

function isBluetickErrorLike(err: unknown): err is BluetickErrorLike {
  if (!err || typeof err !== "object") return false;
  // Has a numeric statusCode + a code string but no requestId — the
  // SDK's BluetickError shape (validation/transport errors that haven't
  // hit the API yet).
  return "statusCode" in err && "code" in err && !("requestId" in err);
}

interface FeathersErrorLike {
  name: string;
  code: number;       // Feathers uses numeric `code` as the HTTP status
  className?: string; // e.g. 'not-found', 'bad-request', 'unprocessable'
  message: string;
  data?: unknown;
  errors?: unknown;
}

function isFeathersErrorLike(err: unknown): err is FeathersErrorLike {
  if (!err || typeof err !== "object") return false;
  // Feathers error shape: numeric `code` (the HTTP status) + `name`.
  // Distinct from the SDK's BluetickError which uses string `code`
  // and `statusCode`. Without this branch, a NotFound thrown inside a
  // /v1 service goes through `toolErrorResult` and gets recoded as
  // `{status: 500, code: 'internal_error'}`, hiding the real 404.
  const e = err as { code?: unknown; name?: unknown };
  return typeof e.code === "number" && typeof e.name === "string";
}

/** Where a user connects WhatsApp (extension or Gateway). */
export const CONNECT_WHATSAPP_URL = "https://app.blueticks.co/connections";

/** #497 — the typed MCP code for "this account has no WhatsApp engine online". */
export const NO_ENGINE_CONNECTED = "no_engine_connected";

/**
 * `no_engine`: nothing is connected. `gateway_reconnecting`: a Gateway session is
 * connected in the DB but its engine is not online yet (pod restart / reconnect).
 */
export type NoEngineReason = "no_engine" | "gateway_reconnecting";

const NO_ENGINE_MESSAGES: Record<NoEngineReason, string> = {
  no_engine:
    `No WhatsApp is connected to this Blueticks account. Tell the user to connect it at ${CONNECT_WHATSAPP_URL} ` +
    `(Gateway, or the Chrome extension with web.whatsapp.com open), then try again.`,
  gateway_reconnecting:
    `The user's WhatsApp Gateway is reconnecting and is not online yet. ` +
    `Retry in a minute; if it keeps failing, tell the user to check it at ${CONNECT_WHATSAPP_URL}.`,
};

export function noEngineConnectedResult(reason: NoEngineReason = "no_engine"): ToolResult {
  return wrap({
    status: 503,
    code: NO_ENGINE_CONNECTED,
    reason,
    message: NO_ENGINE_MESSAGES[reason],
    connect_url: CONNECT_WHATSAPP_URL,
  });
}

/** `data.code` of a Feathers-shaped error: the engine / dispatch code callEngineTool attaches. */
function dataCodeOf(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * callEngineTool's presence gate: zero engines online, nothing was published
 * (`Unavailable` with `data.code: 'no_engine_online'`). The /v1 REST envelope does
 * not expose `data.code`, so only the in-process (Feathers) shape carries it.
 */
function isNoEngineOnline(err: unknown): boolean {
  return dataCodeOf(err) === "no_engine_online";
}

/** An engine IS online but its WhatsApp is not ready: unpaired / QR showing / still syncing. */
export const ENGINE_NOT_READY = "engine_not_ready";

/** The engine is online but did not answer in time (engine-dispatch GatewayTimeout, incl. `ambiguous`). */
export const ENGINE_TIMEOUT = "engine_timeout";

/** The retry hint for a transient engine state (sync in progress, a slow engine). */
export const ENGINE_RETRY_AFTER_SEC = 60;

export type EngineNotReadyReason = "unpaired" | "syncing" | "unknown";

/** WhatsApp Web `AppState.state` values that mean "no linked device" (QR showing or expired). */
const UNPAIRED_STATES: ReadonlySet<string> = new Set(["UNPAIRED", "UNPAIRED_IDLE"]);
/** Values that mean "linking / opening / connected, sync not done". */
const SYNCING_STATES: ReadonlySet<string> = new Set(["OPENING", "PAIRING", "CONNECTED"]);

/**
 * Which not-ready state the engine reported, from its message text (the code alone is
 * one `not_connected` for all of them):
 *   extension / Chrome Gateway — wa-sync-guard.ts embeds `(state=<AppState.state>, …)`;
 *   Baileys pod — the read gate says "initial WhatsApp sync not finished".
 * Anything else (e.g. the pod's "Socket not ready") is `unknown`.
 */
export function classifyEngineNotReady(message: string): EngineNotReadyReason {
  const state = /\bstate=([A-Z_]+)/.exec(message)?.[1];
  if (state !== undefined && UNPAIRED_STATES.has(state)) return "unpaired";
  if (state !== undefined && SYNCING_STATES.has(state)) return "syncing";
  if (/initial WhatsApp sync not finished/i.test(message)) return "syncing";
  return "unknown";
}

const ENGINE_NOT_READY_MESSAGES: Record<EngineNotReadyReason, string> = {
  unpaired:
    `WhatsApp is not linked to this Blueticks account right now (it is waiting for a QR scan), so this could not be done. ` +
    `Tell the user to link WhatsApp at ${CONNECT_WHATSAPP_URL} and then try again.`,
  syncing:
    `WhatsApp is connected but still syncing, so this could not be done yet. ` +
    `Retry in about ${ENGINE_RETRY_AFTER_SEC} seconds.`,
  unknown:
    `WhatsApp is connected to Blueticks but not ready right now. Retry in about ${ENGINE_RETRY_AFTER_SEC} seconds; ` +
    `if it keeps failing, tell the user to check their connection at ${CONNECT_WHATSAPP_URL}.`,
};

export function engineNotReadyResult(reason: EngineNotReadyReason, detail?: string): ToolResult {
  return wrap({
    status: 503,
    code: ENGINE_NOT_READY,
    reason,
    message: ENGINE_NOT_READY_MESSAGES[reason],
    ...(reason !== "syncing" ? { connect_url: CONNECT_WHATSAPP_URL } : {}),
    ...(reason !== "unpaired" ? { retry_after_sec: ENGINE_RETRY_AFTER_SEC } : {}),
    ...(detail ? { detail } : {}),
  });
}

/** `not_connected` (contract taxonomy) or the pre-contract `NO_WHATSAPP_CONNECTION`. */
function isEngineNotReady(err: unknown): boolean {
  const code = dataCodeOf(err);
  return code === "not_connected" || code === "NO_WHATSAPP_CONNECTION";
}

/** engine-dispatch's GatewayTimeout: FeathersError(message, 'gateway-timeout', 504, 'GatewayTimeout'). */
function isEngineTimeout(err: unknown): boolean {
  if (!isFeathersErrorLike(err) || err.code !== 504) return false;
  return err.name === "gateway-timeout" || err.className === "GatewayTimeout";
}

/**
 * Could the timed-out command have run anyway? engine-dispatch stamps `data.readOnly` from its
 * READ_ONLY_COMMANDS list. Only a timeout it marks read-only is safe to retry: the engine's
 * `ambiguous` (send outcome unknown) and a timeout with no command info both count as maybe-run.
 */
function timeoutMayHaveExecuted(err: unknown): boolean {
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== "object") return true;
  const d = data as { code?: unknown; readOnly?: unknown };
  return d.code === "ambiguous" || d.readOnly !== true;
}

export function engineTimeoutResult(detail?: string, mayHaveExecuted = true, reason = "engine_no_reply"): ToolResult {
  if (mayHaveExecuted) {
    return wrap({
      status: 504,
      code: ENGINE_TIMEOUT,
      reason,
      message:
        `Do NOT resend until you've confirmed it did not go through (check the chat or the scheduled-message status): ` +
        `the user's WhatsApp did not answer in time, so this may have been done anyway.`,
      may_have_executed: true,
      ...(detail ? { detail } : {}),
    });
  }
  return wrap({
    status: 504,
    code: ENGINE_TIMEOUT,
    reason,
    message: `The user's WhatsApp did not answer in time. Retry in about ${ENGINE_RETRY_AFTER_SEC} seconds.`,
    retry_after_sec: ENGINE_RETRY_AFTER_SEC,
    ...(detail ? { detail } : {}),
  });
}

/** #590 — an earlier attempt of this same send may still be going out; nothing was sent now. */
export const SEND_IN_FLIGHT = "send_in_flight";

/** The direct-send lease (lib/direct-send-idempotency.ts DIRECT_SEND_LEASE_MS), for a 409 without a hint. */
const SEND_IN_FLIGHT_FALLBACK_SEC = 240;

/**
 * The direct send's in-flight 409: `send_in_flight` (an identical un-keyed retry) or
 * `idempotency_in_flight` (same Idempotency-Key), with `data.retryAfterSec`.
 */
function sendInFlightRetryAfter(err: unknown): number | undefined {
  if (!isFeathersErrorLike(err) || err.code !== 409) return undefined;
  const code = dataCodeOf(err);
  if (code !== SEND_IN_FLIGHT && code !== "idempotency_in_flight") return undefined;
  const hint = (err.data as { retryAfterSec?: unknown }).retryAfterSec;
  return typeof hint === "number" && hint > 0 ? hint : SEND_IN_FLIGHT_FALLBACK_SEC;
}

export function sendInFlightResult(retryAfterSec: number): ToolResult {
  return wrap({
    status: 409,
    code: SEND_IN_FLIGHT,
    reason: SEND_IN_FLIGHT,
    message:
      `Nothing was sent now: an earlier attempt of this same message may still be going out. ` +
      `Wait ${retryAfterSec} seconds, then repeat the same call unchanged; it will confirm the earlier send or send it once. ` +
      `Do NOT change the text to get around this.`,
    retry_after_sec: retryAfterSec,
    sent: false,
  });
}

/**
 * The `code` / `status` / `reason` of an error ToolResult, for analytics (#496). Reads both
 * the toolErrorResult shape (`code`) and the scope / agent-caps refusals (`error`).
 * `{}` for a success or a body that isn't a JSON object.
 */
/** Most zod issues one failed call records. */
const MAX_VALIDATION_ISSUES = 5;
/** Longest `custom` message kept (our own static text; the cap is a guard, not a filter). */
const MAX_CUSTOM_MESSAGE = 200;

/** One zod issue of a bad_request, as the analytics record it (`message` only for `custom`). */
export interface ValidationIssue {
  path: string;
  code: string;
  message?: string;
}

/**
 * The zod issues behind a bad_request (#496), so an AI client's refusal says WHICH field failed and
 * WHY. Paths keep only schema-owned segments: an identifier-shaped or numeric segment is kept, any
 * other client-supplied key becomes `(field)`. The message is kept only for a `custom` issue, because
 * that text is written in our schema; zod's other messages can echo a client value ("received 'x'"),
 * so they are never recorded. Capped at {@link MAX_VALIDATION_ISSUES}.
 */
export function validationIssuesOf(details: unknown): ValidationIssue[] {
  if (!Array.isArray(details)) return [];
  const list: readonly unknown[] = details;
  const out: ValidationIssue[] = [];
  for (const d of list) {
    if (out.length >= MAX_VALIDATION_ISSUES) break;
    if (typeof d !== "object" || d === null) continue;
    const code: unknown = Reflect.get(d, "code");
    if (typeof code !== "string" || !ZOD_CODE.test(code)) continue;
    const rawPath: unknown = Reflect.get(d, "path");
    const segments = typeof rawPath === "string" && rawPath !== "" ? rawPath.split(".") : [];
    const path = segments.length === 0
      ? "(root)"
      : segments.map((seg) => (FIELD_NAME.test(seg) || /^\d{1,3}$/.test(seg) ? seg : "(field)")).join(".");
    const message: unknown = Reflect.get(d, "message");
    out.push(
      code === "custom" && typeof message === "string"
        ? { path, code, message: message.slice(0, MAX_CUSTOM_MESSAGE) }
        : { path, code },
    );
  }
  return out;
}

export function readToolError(result: ToolResult): { code?: McpErrorCode; status?: number; reason?: string; unrecognizedKeys?: string[]; validationIssues?: ValidationIssue[] } {
  if (!result.isError) return {};
  let body: unknown;
  try {
    body = JSON.parse(toolText(result.content[0]));
  } catch {
    // A failure whose body is not JSON still counts: `unparsed_error`, never a null code.
    return { code: "unparsed_error" };
  }
  if (!body || typeof body !== "object") return { code: "unparsed_error" };
  const b = body as { code?: unknown; error?: unknown; status?: unknown; reason?: unknown; details?: unknown; message?: unknown };
  const raw = typeof b.code === "string" ? b.code : typeof b.error === "string" ? b.error : undefined;
  const status = typeof b.status === "number" ? b.status : undefined;
  const code = classifyMcpError(raw, status);
  const reason = typeof b.reason === "string" ? b.reason : code === "bad_request" ? badRequestReason(b.details) : undefined;
  const unrecognizedKeys = code === "bad_request" ? unrecognizedKeyNames(b.details) : [];
  const validationIssues = code === "bad_request" ? validationIssuesOf(b.details) : [];
  return {
    code,
    ...(status !== undefined ? { status } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(unrecognizedKeys.length > 0 ? { unrecognizedKeys } : {}),
    ...(validationIssues.length > 0 ? { validationIssues } : {}),
  };
}

/** Most key names one failed call records. */
const MAX_UNRECOGNIZED_KEYS = 10;

/**
 * The NAMES of the keys a schema refused (zod `unrecognized_keys`), so a drifting client shows up
 * as "sends `media_caption`" rather than "(root):unrecognized_keys". Names only, never values. A
 * key name is client text, so only identifier-shaped names are kept (the same FIELD_NAME gate as
 * badRequestReason); anything else is dropped, not masked. Deduped, sorted, capped.
 */
export function unrecognizedKeyNames(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  const list: readonly unknown[] = details;
  const names = new Set<string>();
  for (const d of list) {
    if (typeof d !== "object" || d === null) continue;
    const code: unknown = Reflect.get(d, "code");
    const keys: unknown = Reflect.get(d, "keys");
    if (code !== "unrecognized_keys" || !Array.isArray(keys)) continue;
    const keyList: readonly unknown[] = keys;
    for (const k of keyList) if (typeof k === "string" && FIELD_NAME.test(k)) names.add(k);
  }
  return [...names].sort().slice(0, MAX_UNRECOGNIZED_KEYS);
}

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const ZOD_CODE = /^[a-z_]{1,40}$/;

/**
 * Which check refused a bad_request, so the analytics can split them. It never carries a value, so
 * it is built only from things the schema owns: a validation issue is its TOP-LEVEL field and zod
 * code (`sendAt:invalid_date`, `items.…:invalid_type`). Deeper segments are dropped because a
 * z.record key is client text. Any other refusal is `unclassified`: messages interpolate client
 * values in ways no mask can catch, so they are never recorded. A throw site that wants its own
 * bucket sets a static `reason` on the result body.
 */
export function badRequestReason(details: unknown): string {
  // No issue list at all: a hand-thrown BadRequest (message only). Named so it stops hiding in `unclassified`.
  if (!Array.isArray(details) || details.length === 0) return "no_details";
  const first = details[0] as { path?: unknown; code?: unknown; message?: unknown } | undefined;
  if (!first || typeof first.code !== "string" || !ZOD_CODE.test(first.code)) return "malformed_issue";
  const segments = typeof first.path === "string" && first.path !== "" ? first.path.split(".") : [];
  const head = segments[0];
  const top = head === undefined ? "(root)" : FIELD_NAME.test(head) ? head : "(field)";
  const base = `${top}${segments.length > 1 ? ".…" : ""}:${first.code}`;
  // A `custom` refinement is named by its own schema-owned message (the same text validationIssuesOf records).
  if (first.code === "custom" && typeof first.message === "string") {
    const slug = slugOfCustomMessage(first.message);
    if (slug) return `${base}:${slug}`;
  }
  return base;
}

export function toolErrorResult(err: unknown): ToolResult {
  if (isNoEngineOnline(err)) return noEngineConnectedResult();
  if (isEngineNotReady(err)) {
    const message = (err as { message?: unknown }).message;
    const text = typeof message === "string" ? message : "";
    return engineNotReadyResult(classifyEngineNotReady(text), text || undefined);
  }
  if (isEngineTimeout(err)) {
    const message = (err as { message?: unknown }).message;
    return engineTimeoutResult(
      typeof message === "string" && message ? message : undefined,
      timeoutMayHaveExecuted(err),
      reasonForThrown(message, isFeathersErrorLike(err) ? err.data : undefined),
    );
  }
  const inFlightRetryAfter = sendInFlightRetryAfter(err);
  if (inFlightRetryAfter !== undefined) return sendInFlightResult(inFlightRetryAfter);
  if (isApiErrorLike(err)) {
    return wrap(withDetails({
      status: err.statusCode ?? 500,
      code: err.code ?? "api_error",
      message: err.message,
      request_id: err.requestId ?? null,
      ...reasonFields(err.statusCode, err.message, undefined),
    }, err));
  }
  if (isBluetickErrorLike(err)) {
    return wrap(withDetails({
      status: err.statusCode ?? 500,
      code: err.code ?? "client_error",
      message: err.message,
      ...reasonFields(err.statusCode, err.message, undefined),
    }, err));
  }
  if (isFeathersErrorLike(err)) {
    // Map either `className` (kebab-case in stock Feathers errors) or
    // `name` (PascalCase like 'NotFound', 'GatewayTimeout') down to a
    // single snake_case public `code`. Some custom subclasses pass the
    // args flipped (kebab in `name`, Pascal in `className`) — handle
    // both. Status comes straight from `code`.
    const raw = err.className ?? err.name;
    const code = raw
      .replace(/-/g, "_")                               // kebab → snake
      .replace(/([a-z\d])([A-Z])/g, "$1_$2")            // PascalCase → snake_Case
      .toLowerCase();
    // A /v1 zod BadRequest carries its issues in `data.details` (Feathers' data arg), not `details`.
    const dataDetails = (err.data as { details?: unknown } | undefined)?.details;
    return wrap(withDetails({
      status: err.code,
      code,
      message: err.message,
      ...reasonFields(err.code, err.message, err.data),
    }, { details: (err as { details?: unknown[] }).details ?? (Array.isArray(dataDetails) ? dataDetails : undefined) }));
  }
  if (err instanceof Error) {
    // eslint-disable-next-line no-console
    console.error("[mcp] unexpected error:", err);
    return wrap({ status: 500, code: "internal_error", message: err.message });
  }
  return wrap({ status: 500, code: "internal_error", message: String(err) });
}

/** `{ reason }` for the statuses that used to be unnamed (#514); nothing for the rest. */
function reasonFields(status: number | undefined, message: string, data: unknown): { reason?: string } {
  return status !== undefined && REASON_STATUSES.has(status) ? { reason: reasonForThrown(message, data) } : {};
}

function withDetails(body: Record<string, unknown>, err: { details?: unknown[] }): Record<string, unknown> {
  if (Array.isArray(err.details) && err.details.length > 0) {
    return { ...body, details: err.details };
  }
  return body;
}

function wrap(body: Record<string, unknown>): ToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

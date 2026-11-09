/**
 * #514 — a safe `reason` for the failures that used to land in an unnamed bucket
 * (forbidden 403, conflict 409, unprocessable 422, bad_gateway 502, gateway timeout 504).
 *
 * A reason is a slug the CODE owns, never client text. Three sources, in order:
 *   1. the error's own `data.reason` / `data.code` when it is a short identifier (set by our throw
 *      sites: `slot_taken`, `menu_not_found`, `ambiguous`, an engine contract code, ...);
 *   2. a closed table that matches a known STATIC message (anchored, or a fixed prefix whose
 *      remainder is dynamic) and yields the table's own slug, so interpolated values never reach it;
 *   3. `unlabeled`, which keeps an unmatched failure countable so the table can be extended.
 * Observability only: the error, its status and its message are untouched.
 */

import { MCP_ERROR_CODES } from "./error-codes";

const IDENT = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/**
 * The closed MCP error codes, as reason candidates to REJECT: a `data.code` that is itself the
 * top-level code (e.g. an engine 504 whose `data.code` is `engine_timeout`) is not a sub-cause —
 * it only echoes `errorCode`. Skipping it lets the message-rule table yield the real sub-cause
 * (`engine_no_reply`, `media_fetch_timeout`, …) instead (#1167 RCA-2a residual).
 */
const ECHOED_CODES: ReadonlySet<string> = new Set(MCP_ERROR_CODES);

/** A `data` field that is a short identifier, lower-cased; anything else is dropped. */
function identOf(data: unknown, key: "reason" | "code"): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const value: unknown = Reflect.get(data, key);
  return typeof value === "string" && IDENT.test(value) ? value.toLowerCase() : undefined;
}

interface ReasonRule {
  pattern: RegExp;
  reason: string;
}

/** Static messages of the throw sites an MCP tool can reach. A dynamic tail is never captured. */
const MESSAGE_RULES: readonly ReasonRule[] = [
  // 403
  { pattern: /^This resource is restricted to admin users$/, reason: "admin_only" },
  { pattern: /^You do not have access to this (record|automation)$/, reason: "not_owner" },
  { pattern: /^Not authenticated$/, reason: "not_authenticated" },
  { pattern: /^not permitted to modify these rows$/, reason: "board_rows_not_permitted" },
  { pattern: /^a multi write needs a filter$/, reason: "board_multi_write_no_filter" },
  { pattern: /^The calendar tool is only available to an agent\.$/, reason: "calendar_agent_only" },
  // 409
  { pattern: /^Audience is in use by an active campaign$/, reason: "audience_in_use" },
  { pattern: /^Requested engine is not online$/, reason: "requested_engine_offline" },
  { pattern: /^Engine command already in flight for this lockId\.$/, reason: "engine_cmd_in_flight" },
  { pattern: /^An earlier attempt of this send is still in flight/, reason: "send_in_flight" },
  { pattern: /^An identical message to this chat may still be going out/, reason: "send_in_flight" },
  { pattern: /^Idempotency-Key already used for a different (request|chat)\./, reason: "idempotency_key_reused" },
  { pattern: /^Cannot transition from /, reason: "campaign_bad_transition" },
  { pattern: /^Cannot delete a message in status /, reason: "message_not_deletable" },
  { pattern: /^Message was dispatched before it could be edited$/, reason: "message_already_dispatched" },
  { pattern: /^User message .* is not pending /, reason: "message_not_pending" },
  { pattern: /^A server with this name is already connected to the agent\.$/, reason: "agent_server_name_taken" },
  { pattern: /^Too many servers with this name\.$/, reason: "agent_server_name_limit" },
  { pattern: /^Gateway storage is already used by /, reason: "gateway_storage_in_use" },
  { pattern: /^Button replies are only supported on gateway/, reason: "button_reply_engine_unsupported" },
  { pattern: /^The menu being answered is no longer available/, reason: "menu_not_found" },
  { pattern: /^This action requires a WhatsApp Business account/, reason: "wa_business_required" },
  { pattern: /^Assistant-enabled workspaces cannot be |^Workspace became assistant-enabled/, reason: "assistant_workspace_protected" },
  // 422
  { pattern: /^Unknown .+ label "/, reason: "board_unknown_label" },
  { pattern: /^A custom \(entity_kind\) board requires a `description`/, reason: "board_description_required" },
  { pattern: /^Message has no media content$/, reason: "message_has_no_media" },
  { pattern: /^WhatsApp engine rejected the label change$/, reason: "engine_rejected_label_change" },
  { pattern: /^WhatsApp engine rejected the request$/, reason: "engine_rejected_request" },
  // 502
  { pattern: /^WhatsApp engine returned a non-object response$/, reason: "engine_bad_response" },
  { pattern: /^WhatsApp engine response missing canonical /, reason: "engine_bad_response" },
  { pattern: /^WhatsApp engine response failed schema validation /, reason: "engine_bad_response" },
  { pattern: /^WhatsApp engine request failed: /, reason: "engine_request_failed" },
  { pattern: /^WhatsApp engine temporarily unavailable after repeated failures$/, reason: "engine_circuit_open" },
  { pattern: /^WhatsApp engine reported this command as already in flight/, reason: "engine_cmd_deduplicated" },
  { pattern: /^apiKeyAuth did not populate the account fields$/, reason: "api_key_auth_unpopulated" },
  { pattern: /^Missing account\.userId on request$/, reason: "account_user_missing" },
  { pattern: /^account\.userId missing; /, reason: "account_user_missing" },
  { pattern: /^(The calendar|AI-conversation|Suno) tools? (is|are) not available in this context\.$/, reason: "tool_unavailable_in_context" },
  // 504
  { pattern: /^WhatsApp engine did not respond in time$/, reason: "engine_no_reply" },
  { pattern: /^Media fetch timed out/, reason: "media_fetch_timeout" },
  { pattern: /^Could not confirm whether the earlier attempt of this send went out/, reason: "ambiguous" },
];

/** `Missing required scope: messages:read` -> `missing_scope:messages:read` (the scope name is ours). */
const MISSING_SCOPE = /^Missing required scope: ([a-z_]{1,30}:[a-z_]{1,30})$/;

/** The reason for an error thrown with a status the analytics could not split. Never throws. */
export function reasonForThrown(message: unknown, data: unknown): string {
  // Prefer a schema-owned sub-cause from data.reason/data.code, but skip one that merely echoes
  // the closed error code (e.g. `engine_timeout`) — it adds nothing over errorCode and hides the
  // specific message-rule reason that follows.
  for (const own of [identOf(data, "reason"), identOf(data, "code")]) {
    if (own && !ECHOED_CODES.has(own)) return own;
  }
  if (typeof message !== "string") return "unlabeled";
  const scope = MISSING_SCOPE.exec(message);
  if (scope) return `missing_scope:${scope[1]}`;
  for (const rule of MESSAGE_RULES) if (rule.pattern.test(message)) return rule.reason;
  return "unlabeled";
}

/** Statuses whose failures are named centrally; other statuses keep their own reason logic. */
export const REASON_STATUSES: ReadonlySet<number> = new Set([403, 409, 422, 502, 504]);

/** Longest schema-owned `custom` message slugged into a bad_request reason. */
const MAX_CUSTOM_SLUG = 48;

/** `Phone must be E.164` -> `phone_must_be_e_164`. Only used on a zod `custom` message, which is our schema text. */
export function slugOfCustomMessage(message: string): string {
  return message.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, MAX_CUSTOM_SLUG).replace(/_+$/, "");
}

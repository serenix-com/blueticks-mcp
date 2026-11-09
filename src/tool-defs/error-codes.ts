/**
 * #496 — the closed set of `errorCode` values an MCP failure event can carry.
 *
 * Raw codes are open-ended (SDK `err.code`, Feathers `className`, ad-hoc `error` strings), so
 * grouping `mcp_tool_failed` by them splits one cause into many rows. Every failure is mapped
 * onto this set, so the analytics column is never null and never unbounded.
 */
export const MCP_ERROR_CODES = [
  'no_engine_connected',
  'engine_not_ready',
  'engine_timeout',
  'insufficient_scope',
  'forbidden',
  'action_not_available',
  'not_authenticated',
  'rate_limited',
  'bad_request',
  'not_found',
  // #504: a by-key message lookup missed, most often because WA Web unloaded the message.
  'not_loaded',
  'conflict',
  'unprocessable',
  'payment_required',
  'timeout',
  'unavailable',
  'internal_error',
  'unparsed_error',
  'unknown',
] as const;

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

const KNOWN = new Set<string>(MCP_ERROR_CODES);

/** Raw code spellings that mean one of the closed codes. */
const ALIASES: Readonly<Record<string, McpErrorCode>> = {
  unauthorized: 'not_authenticated',
  too_many_requests: 'rate_limited',
  rate_limit_exceeded: 'rate_limited',
  validation_error: 'bad_request',
  invalid_request: 'bad_request',
  method_not_allowed: 'bad_request',
  not_acceptable: 'bad_request',
  gone: 'not_found',
  payment_error: 'payment_required',
  gateway_timeout: 'timeout',
  bad_gateway: 'unavailable',
  service_unavailable: 'unavailable',
  // #496: the engine's own 403 code; keeps it classified as forbidden even without an HTTP status.
  not_authorized: 'forbidden',
  not_implemented: 'unavailable',
  general_error: 'internal_error',
  api_error: 'internal_error',
  client_error: 'internal_error',
};

function fromStatus(status: number | undefined): McpErrorCode | undefined {
  switch (status) {
    case undefined: return undefined;
    case 400: return 'bad_request';
    case 401: return 'not_authenticated';
    case 402: return 'payment_required';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 408: case 504: return 'timeout';
    case 409: return 'conflict';
    case 422: return 'unprocessable';
    case 429: return 'rate_limited';
    case 502: case 503: return 'unavailable';
    default: return status >= 500 ? 'internal_error' : undefined;
  }
}

/**
 * Map a raw code (and/or HTTP status) onto the closed set. Never returns undefined: a failure
 * we cannot classify is `unknown`, which is a countable row, not a silent null.
 */
export function classifyMcpError(raw: string | undefined, status?: number): McpErrorCode {
  const norm = raw?.trim().toLowerCase().replace(/-/g, '_');
  if (norm) {
    if (KNOWN.has(norm)) return norm as McpErrorCode;
    const alias = ALIASES[norm];
    if (alias) return alias;
  }
  return fromStatus(status) ?? 'unknown';
}

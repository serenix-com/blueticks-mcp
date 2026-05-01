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

export interface ToolResult {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
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

export function toolErrorResult(err: unknown): ToolResult {
  if (isApiErrorLike(err)) {
    return wrap(withDetails({
      status: err.statusCode ?? 500,
      code: err.code ?? "api_error",
      message: err.message,
      request_id: err.requestId ?? null,
    }, err));
  }
  if (isBluetickErrorLike(err)) {
    return wrap(withDetails({
      status: err.statusCode ?? 500,
      code: err.code ?? "client_error",
      message: err.message,
    }, err));
  }
  if (err instanceof Error) {
    // eslint-disable-next-line no-console
    console.error("[mcp] unexpected error:", err);
    return wrap({ status: 500, code: "internal_error", message: err.message });
  }
  return wrap({ status: 500, code: "internal_error", message: String(err) });
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

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
    return wrap(withDetails({
      status: err.code,
      code,
      message: err.message,
    }, err as { details?: unknown[] }));
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

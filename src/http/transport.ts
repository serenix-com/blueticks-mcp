// A small JSON client for the Blueticks /v1 REST API.
//
// The tool defs call a `BlueticksSurface`; src/http/surface.ts implements it on
// top of this transport, one method per /v1 route. Errors are thrown in the
// shape the tool defs' error mapper reads (`statusCode` + `code` + `requestId`),
// so a /v1 error reaches the model the same way it does on the hosted server.

/** A query value as the /v1 routes parse it: arrays go as repeated keys. */
export type QueryValue = string | number | boolean | ReadonlyArray<string | number | boolean> | undefined;
export type Query = Readonly<Record<string, QueryValue>>;

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RequestOptions {
  query?: Query | Record<string, unknown>;
  body?: unknown;
  idempotencyKey?: string;
}

export interface TransportOptions {
  apiKey: string;
  baseUrl?: string;
  userAgent: string;
  /** Per-attempt timeout. Engine reads (history loads) can be slow, so this is generous. */
  timeoutMs?: number;
  /** Retries for GET only, on 429 and 502/503/504. Writes are never retried. */
  maxRetries?: number;
  fetch?: typeof fetch;
}

export const DEFAULT_BASE_URL = "https://api.blueticks.co";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRIABLE = new Set([429, 502, 503, 504]);

/**
 * A /v1 error response. `requestId` being present (even as null) is what the
 * tool defs' `isApiErrorLike` keys on, so keep it on every instance.
 */
export class BlueticksApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown[] | undefined;

  constructor(init: { statusCode: number; code: string; message: string; requestId: string | null; details?: unknown[] }) {
    super(init.message);
    this.name = "BlueticksApiError";
    this.statusCode = init.statusCode;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details;
  }
}

/** A failure before any response arrived (DNS, refused, timeout). */
export class BlueticksConnectionError extends Error {
  readonly statusCode = 503;
  readonly code = "connection_error";
  constructor(message: string) {
    super(message);
    this.name = "BlueticksConnectionError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** Append one query key. Non-scalar values (nested objects) are a programming error. */
function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isScalar(item)) params.append(key, String(item));
    }
    return;
  }
  if (isScalar(value)) params.append(key, String(value));
}

export function buildUrl(baseUrl: string, path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, baseUrl.replace(/\/+$/, "") + "/");
  if (query) {
    for (const [k, v] of Object.entries(query)) appendQuery(url.searchParams, k, v);
  }
  return url.toString();
}

/** Encode one path segment. Message keys contain `@`, `_` and `.`; all must survive. */
export function seg(value: string): string {
  return encodeURIComponent(value);
}

function errorFromBody(status: number, body: unknown, fallbackMessage: string): BlueticksApiError {
  const envelope = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  const code = typeof envelope?.code === "string" ? envelope.code : `http_${status}`;
  const message = typeof envelope?.message === "string" ? envelope.message : fallbackMessage;
  const requestId =
    typeof envelope?.request_id === "string" ? envelope.request_id
      : typeof envelope?.requestId === "string" ? envelope.requestId
        : null;
  const details = Array.isArray(envelope?.details) ? envelope.details : undefined;
  return new BlueticksApiError({ statusCode: status, code, message, requestId, details });
}

function retryDelayMs(attempt: number, response: Response | undefined): number {
  const header = response?.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return Math.min(500 * 2 ** attempt, 4_000) + Math.random() * 250;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchFn: typeof fetch;

  constructor(opts: TransportOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.userAgent = opts.userAgent;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
  }

  get(path: string, query?: RequestOptions["query"]): Promise<unknown> {
    return this.request("GET", path, { query });
  }
  post(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}): Promise<unknown> {
    return this.request("POST", path, { ...opts, body: body ?? {} });
  }
  patch(path: string, body: unknown, query?: RequestOptions["query"]): Promise<unknown> {
    return this.request("PATCH", path, { body, query });
  }
  put(path: string, body: unknown): Promise<unknown> {
    return this.request("PUT", path, { body });
  }
  delete(path: string): Promise<unknown> {
    return this.request("DELETE", path, {});
  }

  async request(method: HttpMethod, path: string, opts: RequestOptions): Promise<unknown> {
    const url = buildUrl(this.baseUrl, path, opts.query);
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      "user-agent": this.userAgent,
      accept: "application/json",
    };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchFn(url, { method, headers, body, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        // A write may have reached the server before the connection dropped:
        // never resend it blind.
        if (method === "GET" && attempt < this.maxRetries) {
          await sleep(retryDelayMs(attempt, undefined));
          continue;
        }
        const reason = controller.signal.aborted
          ? `timed out after ${this.timeoutMs}ms`
          : err instanceof Error ? err.message : String(err);
        throw new BlueticksConnectionError(`${method} ${path}: ${reason}`);
      }
      clearTimeout(timer);

      if (response.ok) {
        if (response.status === 204) return undefined;
        const text = await response.text();
        if (text.length === 0) return undefined;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      }

      if (method === "GET" && RETRIABLE.has(response.status) && attempt < this.maxRetries) {
        await sleep(retryDelayMs(attempt, response));
        continue;
      }
      const text = await response.text().catch(() => "");
      let parsed: unknown = text;
      try {
        parsed = text ? (JSON.parse(text) as unknown) : undefined;
      } catch {
        // keep the raw text
      }
      throw errorFromBody(response.status, parsed, `${method} ${path} failed with HTTP ${response.status}`);
    }
  }
}

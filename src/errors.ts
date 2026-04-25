import { APIError, BluetickError } from "blueticks";

export interface ToolResult {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

export function toolErrorResult(err: unknown): ToolResult {
  if (err instanceof APIError) {
    return wrap({
      status: err.statusCode ?? 500,
      code: err.code ?? "api_error",
      message: err.message,
      request_id: err.requestId ?? null,
    });
  }
  if (err instanceof BluetickError) {
    return wrap({
      status: err.statusCode ?? 500,
      code: err.code ?? "client_error",
      message: err.message,
    });
  }
  if (err instanceof Error) {
    // eslint-disable-next-line no-console
    console.error("[mcp] unexpected error:", err);
    return wrap({ status: 500, code: "internal_error", message: err.message });
  }
  return wrap({ status: 500, code: "internal_error", message: String(err) });
}

function wrap(body: Record<string, unknown>): ToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

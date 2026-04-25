import { APIError, BluetickError } from "blueticks";

export interface ToolResult {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

export function toolErrorResult(err: unknown): ToolResult {
  if (err instanceof APIError) {
    return wrap(withDetails({
      status: err.statusCode ?? 500,
      code: err.code ?? "api_error",
      message: err.message,
      request_id: err.requestId ?? null,
    }, err));
  }
  if (err instanceof BluetickError) {
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

// Surface backend validation field paths to the MCP caller. The SDK exposes
// these as BluetickError.details when the API returns error.details[].
function withDetails(body: Record<string, unknown>, err: BluetickError): Record<string, unknown> {
  if (Array.isArray(err.details) && err.details.length > 0) {
    return { ...body, details: err.details };
  }
  return body;
}

function wrap(body: Record<string, unknown>): ToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

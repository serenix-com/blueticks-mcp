import { describe, it, expect } from "vitest";
import { APIError, BluetickError } from "blueticks";
import { toolErrorResult } from "../src/errors";

describe("toolErrorResult", () => {
  it("maps APIError to MCP error with status, code, message, request_id", () => {
    const err = new APIError({
      statusCode: 503,
      code: "internal_error",
      message: "No WhatsApp engine is connected for this account",
      requestId: "req_abc",
      _rawMessage: true,
    });

    const result = toolErrorResult(err);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({
      status: 503,
      code: "internal_error",
      message: "No WhatsApp engine is connected for this account",
      request_id: "req_abc",
    });
  });

  it("maps generic BluetickError to a stable shape", () => {
    const err = new BluetickError({ message: "connection refused", _rawMessage: true });
    const result = toolErrorResult(err);
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({ message: "connection refused" });
  });

  it("includes details from APIError when the SDK populated them from envelope", () => {
    const err = new APIError({
      statusCode: 400,
      code: "invalid_request",
      message: "contacts.0.to: Invalid",
      requestId: "req_x",
      details: [{ path: "contacts.0.to", code: "invalid_string", message: "Invalid" }],
      _rawMessage: true,
    });
    const result = toolErrorResult(err);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body.details).toEqual([
      { path: "contacts.0.to", code: "invalid_string", message: "Invalid" },
    ]);
  });

  it("omits details when the SDK error has none", () => {
    const err = new APIError({
      statusCode: 503,
      code: "internal_error",
      message: "x",
      requestId: "r",
      _rawMessage: true,
    });
    const body = JSON.parse((toolErrorResult(err).content[0] as { text: string }).text);
    expect(body).not.toHaveProperty("details");
  });

  it("maps unknown errors to internal-error envelope without leaking stack", () => {
    const err = new Error("kaboom");
    const result = toolErrorResult(err);
    expect(result.isError).toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toEqual({ status: 500, code: "internal_error", message: "kaboom" });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { resolveApiKey } from "../src/client";

describe("resolveApiKey", () => {
  beforeEach(() => {
    delete process.env.BLUETICKS_API_KEY;
  });

  it("uses --api-key argument when provided", () => {
    expect(resolveApiKey(["--api-key", "bt_live_cli"], {})).toBe("bt_live_cli");
  });

  it("falls back to BLUETICKS_API_KEY env var", () => {
    expect(resolveApiKey([], { BLUETICKS_API_KEY: "bt_live_env" })).toBe("bt_live_env");
  });

  it("CLI argument overrides env", () => {
    expect(
      resolveApiKey(["--api-key", "bt_live_cli"], { BLUETICKS_API_KEY: "bt_live_env" }),
    ).toBe("bt_live_cli");
  });

  it("throws a usage error when neither is set", () => {
    expect(() => resolveApiKey([], {})).toThrow(/BLUETICKS_API_KEY/);
  });

  it("supports --api-key=value syntax", () => {
    expect(resolveApiKey(["--api-key=bt_live_inline"], {})).toBe("bt_live_inline");
  });
});

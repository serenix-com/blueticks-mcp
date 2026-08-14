import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { MCP_CLIENT_UA, getClient, _resetClientForTests } from "../src/client";

// The local stdio server authenticates with an API key, so it reaches neither
// mcp_oauth_approved nor mcp_tool_used — local installs are absent from every MCP
// number we publish. The backend now counts a request whose User-Agent carries a
// DELIMITED `blueticks-mcp/<version>` token; this is the half that sends it.

describe("MCP_CLIENT_UA", () => {
  it("is a delimited blueticks-mcp token with a semver version", () => {
    expect(MCP_CLIENT_UA).toMatch(/^blueticks-mcp\/\d+\.\d+\.\d+$/);
  });

  it("matches the published package version, so the two cannot drift", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(MCP_CLIENT_UA).toBe(`blueticks-mcp/${pkg.version}`);
  });

  it("survives the backend's delimited-token matcher once the SDK prefixes it", () => {
    const sent = `blueticks-node/1.4.2 ${MCP_CLIENT_UA}`;
    const m = /(?:^|[\s(;,])blueticks-mcp\/(\d+\.\d+\.\d+[\w.-]*)/i.exec(sent);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(MCP_CLIENT_UA.split("/")[1]);
  });
});

describe("the User-Agent actually sent on the wire", () => {
  beforeEach(() => _resetClientForTests());

  it("reaches the API as a delimited blueticks-mcp token", async () => {
    const { Blueticks } = await import("blueticks");
    let seen = "";
    const fakeFetch = (async (_url: unknown, init: { headers?: Record<string, string> }) => {
      const h = init?.headers ?? {};
      seen = h["User-Agent"] ?? h["user-agent"] ?? "";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new Blueticks({
      apiKey: "bt_live_test",
      userAgent: MCP_CLIENT_UA,
      fetch: fakeFetch,
    });
    await client.ping().catch(() => undefined);

    expect(seen).toContain(MCP_CLIENT_UA);
    // the exact matcher the backend uses
    expect(/(?:^|[\s(;,])blueticks-mcp\/(\d+\.\d+\.\d+[\w.-]*)/i.test(seen)).toBe(true);
  });

  it("getClient returns a usable singleton", () => {
    const a = getClient("bt_live_x");
    const b = getClient("bt_live_x");
    expect(a).toBe(b);
  });
});

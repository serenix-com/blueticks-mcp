import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MCP_CLIENT_UA, createClient, resolveApiKey } from "../src/client";

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
});

describe("the User-Agent actually sent on the wire", () => {
  it("reaches the API as a delimited blueticks-mcp token", async () => {
    let seen = "";
    const fakeFetch: typeof fetch = async (_url, init) => {
      seen = new Headers(init?.headers).get("user-agent") ?? "";
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createClient("bt_live_test", { fetch: fakeFetch });
    await client.engines.status();

    expect(/(?:^|[\s(;,])blueticks-mcp\/(\d+\.\d+\.\d+[\w.-]*)/i.test(seen)).toBe(true);
  });

  it("defaults to the production API", async () => {
    let url = "";
    const fakeFetch: typeof fetch = async (input) => {
      url = String(input);
      return new Response("{}", { status: 200 });
    };
    await createClient("bt_live_test", { fetch: fakeFetch }).utils.currentDateTime();
    expect(url).toBe("https://api.blueticks.co/v1/utils/current_date_time");
  });
});

describe("resolveApiKey", () => {
  it("prefers --api-key over the environment", () => {
    expect(resolveApiKey(["--api-key", "a"], { BLUETICKS_API_KEY: "b" })).toBe("a");
    expect(resolveApiKey(["--api-key=c"], {})).toBe("c");
    expect(resolveApiKey([], { BLUETICKS_API_KEY: "b" })).toBe("b");
  });

  it("fails clearly without a key", () => {
    expect(() => resolveApiKey([], {})).toThrow(/BLUETICKS_API_KEY/);
  });
});

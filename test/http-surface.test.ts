import { describe, it, expect } from "vitest";
import { createClient, MCP_CLIENT_UA } from "../src/client";
import { BlueticksApiError, buildUrl, HttpTransport } from "../src/http/transport";
import { findTool } from "../src/manifest";
import { fakeFetch, type FakeRoute } from "./fake-fetch";

const BASE = "https://api.test";

async function call(name: string, input: Record<string, unknown>, routes: FakeRoute[] = []) {
  const f = fakeFetch(routes);
  const client = createClient("bt_live_test", { baseUrl: BASE, fetch: f.fetch, maxRetries: 0 });
  const tool = findTool(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  const result = await tool.dispatch(input, client);
  const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
  return { result, seen: f.seen, text };
}

describe("transport", () => {
  it("sends the API key as a bearer token and the MCP user agent", async () => {
    const { seen } = await call("engine", { action: "status" }, [
      { method: "GET", path: "/v1/engines", body: { data: [] } },
    ]);
    const ua = seen[0]?.headers.get("user-agent") ?? "";
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer bt_live_test");
    expect(ua).toBe(MCP_CLIENT_UA);
    // the matcher the backend counts local installs with
    expect(/(?:^|[\s(;,])blueticks-mcp\/(\d+\.\d+\.\d+[\w.-]*)/i.test(ua)).toBe(true);
  });

  it("writes arrays as repeated keys and skips undefined", () => {
    const url = new URL(buildUrl(BASE, "/v1/chats", { kinds: ["contact", "group"], limit: 5, since: undefined, x: true }));
    expect(url.searchParams.getAll("kinds")).toEqual(["contact", "group"]);
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("x")).toBe("true");
    expect(url.searchParams.has("since")).toBe(false);
  });

  it("turns the v1 error envelope into a BlueticksApiError", async () => {
    const f = fakeFetch([
      {
        method: "GET",
        path: "/v1/engines",
        status: 409,
        body: { success: false, error: { code: "no_engine_online", message: "No engine", request_id: "req_1" } },
      },
    ]);
    const http = new HttpTransport({ apiKey: "k", baseUrl: BASE, userAgent: "ua", fetch: f.fetch, maxRetries: 0 });
    const err = await http.get("/v1/engines").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BlueticksApiError);
    expect(err).toMatchObject({ statusCode: 409, code: "no_engine_online", requestId: "req_1", message: "No engine" });
  });

  it("retries a GET on 503 but never a POST", async () => {
    let gets = 0;
    let posts = 0;
    const fetchFn: typeof fetch = async (_url, init) => {
      if ((init?.method ?? "GET") === "GET") gets += 1;
      else posts += 1;
      return new Response("{}", { status: 503, headers: { "retry-after": "0" } });
    };
    const http = new HttpTransport({ apiKey: "k", baseUrl: BASE, userAgent: "ua", fetch: fetchFn, maxRetries: 2 });
    await http.get("/v1/engines").catch(() => undefined);
    await http.post("/v1/engines/reload").catch(() => undefined);
    expect(gets).toBe(3);
    expect(posts).toBe(1);
  });
});

describe("tool errors over HTTP", () => {
  it("reach the model with status, code and request id", async () => {
    const { result, text } = await call("engine", { action: "status" }, [
      {
        method: "GET",
        path: "/v1/engines",
        status: 401,
        body: { success: false, error: { code: "unauthorized", message: "Invalid API key", request_id: "req_9" } },
      },
    ]);
    expect(result.isError).toBe(true);
    expect(text).toContain("unauthorized");
    expect(text).toContain("req_9");
  });
});

describe("routes match the hosted adapter", () => {
  it("chats list maps the surface names onto v1 query names", async () => {
    const { seen } = await call(
      "chats_read",
      { action: "list", limit: 3, kinds: ["group"], include_last_message: true, engine: "gateway" },
      [{ method: "GET", path: "/v1/chats", body: { data: [] } }],
    );
    expect(seen[0]?.path).toBe("/v1/chats");
    expect(seen[0]?.query).toMatchObject({
      limit: ["3"],
      kinds: ["group"],
      includeLastMessage: ["true"],
      engine: ["gateway"],
    });
  });

  it("list_messages for one chat reads /v1/messages with chatId", async () => {
    const { seen } = await call("chats_read", { action: "list_messages", chat_id: "1@c.us", limit: 2 }, [
      { method: "GET", path: "/v1/messages", body: { data: [] } },
    ]);
    expect(seen[0]?.query).toMatchObject({ chatId: ["1@c.us"], limit: ["2"] });
  });

  it("get_media asks for inline base64 and keeps the key intact in the path", async () => {
    const key = "false_1@c.us_3EB0ABC";
    const { seen } = await call("chats_read", { action: "get_media", chat_id: "1@c.us", key }, [
      { method: "GET", path: /^\/v1\/messages\/media\//, body: { url: "https://x" } },
    ]);
    expect(decodeURIComponent(seen[0]?.path ?? "")).toBe(`/v1/messages/media/${key}`);
    expect(seen[0]?.query).toMatchObject({ chatId: ["1@c.us"], inline_base64: ["true"] });
  });

  it("send_message_text posts a flat v1 body", async () => {
    const { seen } = await call("chats_write", { action: "send_message_text", chat_id: "1@c.us", text: "hi" }, [
      { method: "POST", path: /^\/v1\/messages\//, body: { id: "m1" } },
    ]);
    expect(seen[0]?.method).toBe("POST");
    expect(decodeURIComponent(seen[0]?.path ?? "")).toBe("/v1/messages/1@c.us");
    expect(seen[0]?.body).toMatchObject({ type: "text", text: "hi" });
  });

  it("scheduled send goes to /v1/scheduled-messages/{to} in camelCase", async () => {
    const { seen } = await call(
      "scheduled_messages_write",
      {
        action: "send",
        to: "1@c.us",
        poll: { question: "Q", options: ["a", "b"], allow_multiple: true },
        send_at: "2026-12-01T09:00:00+02:00",
      },
      [{ method: "POST", path: /^\/v1\/scheduled-messages\//, body: { id: "s1" } }],
    );
    expect(decodeURIComponent(seen[0]?.path ?? "")).toBe("/v1/scheduled-messages/1@c.us");
    expect(seen[0]?.body).toEqual({
      type: "poll",
      pollQuestion: "Q",
      pollOptions: ["a", "b"],
      pollAllowMultiple: true,
      sendAt: "2026-12-01T09:00:00+02:00",
    });
  });

  it("scheduled list maps chat_id and cursor", async () => {
    const { seen } = await call("scheduled_messages_read", { action: "list", chat_id: "1@c.us", cursor: "20" }, [
      { method: "GET", path: "/v1/scheduled-messages", body: { data: [] } },
    ]);
    expect(seen[0]?.query).toMatchObject({ chatId: ["1@c.us"], skip: ["20"] });
  });

  it("validate_phone posts phoneOrChatId", async () => {
    const { seen } = await call("utils", { action: "validate_phone", phone_or_chat_id: "+15550100123" }, [
      { method: "POST", path: "/v1/utils/validate_phone", body: { valid: true } },
    ]);
    expect(seen[0]?.body).toEqual({ phoneOrChatId: "+15550100123" });
  });

  it("webhook reads never carry the signing secret", async () => {
    const { text } = await call("webhooks", { action: "list" }, [
      {
        method: "GET",
        path: "/v1/webhooks",
        body: { data: [{ id: "wh_1", url: "https://h", signingSecret: "whsec_x" }] },
      },
    ]);
    expect(text).toContain("wh_1");
    expect(text).not.toContain("whsec_x");
  });
});

describe("tasks stay on the user's UI boards", () => {
  it("list_boards drops agent-managed memory boards", async () => {
    const { text } = await call("tasks", { action: "list_boards" }, [
      {
        method: "GET",
        path: "/v1/boards",
        body: { data: [{ board_id: "b1", agent_managed: false }, { board_id: "m1", agent_managed: true }], total: 2 },
      },
    ]);
    expect(text).toContain("b1");
    expect(text).not.toContain("m1");
  });

  it("a memory board is not found and its items are never read", async () => {
    const { result, seen } = await call("tasks", { action: "list_tasks", board_id: "m1" }, [
      { method: "GET", path: "/v1/boards/m1", body: { board_id: "m1", agent_managed: true } },
    ]);
    expect(result.isError).toBe(true);
    expect(seen.some((r) => r.path.endsWith("/items"))).toBe(false);
  });

  it("an audience is not a task board", async () => {
    const { result, seen } = await call("tasks", { action: "create_task", board_id: "a1", text: "call back" }, [
      { method: "GET", path: "/v1/boards/a1", body: { board_id: "a1", agent_managed: false } },
      { method: "GET", path: "/v1/audiences/a1", body: { id: "a1" } },
    ]);
    expect(result.isError).toBe(true);
    expect(seen.some((r) => r.method === "POST")).toBe(false);
  });

  it("a UI board's tasks are listed", async () => {
    const { result, seen } = await call("tasks", { action: "list_tasks", board_id: "b1", status: "Open" }, [
      { method: "GET", path: "/v1/boards/b1", body: { board_id: "b1", agent_managed: false } },
      { method: "GET", path: "/v1/boards/b1/items", body: { data: [] } },
    ]);
    expect(result.isError).toBeFalsy();
    expect(seen.find((r) => r.path === "/v1/boards/b1/items")?.query).toMatchObject({ status: ["Open"] });
  });
});

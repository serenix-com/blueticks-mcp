// BE#1599: an unreadable chat must never look like an empty one. Mirrors the hosted fix
// (whatsapp-scheduler-backend #2641) for this API-key server, which reads over REST: /v1/messages
// keeps answering an empty 200 when no engine is online and the backup tier has nothing (BE#1553).
import { describe, it, expect } from "vitest";
import { createClient } from "../src/client";
import { findTool } from "../src/manifest";
import { fakeFetch, type FakeRoute } from "./fake-fetch";

const BASE = "https://api.test";

async function call(input: Record<string, unknown>, routes: FakeRoute[]) {
  const f = fakeFetch(routes);
  const client = createClient("bt_live_test", { baseUrl: BASE, fetch: f.fetch, maxRetries: 0 });
  const tool = findTool("chats_read");
  if (!tool) throw new Error("missing tool chats_read");
  const result = await tool.dispatch(input, client);
  const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
  return { result, text, paths: f.seen.map((s) => s.path) };
}

const emptyPage: FakeRoute = {
  method: "GET",
  path: "/v1/messages",
  body: { success: true, data: [], limit: 20, skip: 0, total: 0 },
};
const noEngines: FakeRoute = { method: "GET", path: "/v1/engines", body: { success: true, data: [] } };
const oneEngine: FakeRoute = {
  method: "GET",
  path: "/v1/engines",
  body: { success: true, data: [{ id: "e1", type: "regular", connected: true }] },
};

describe("list_messages with no engine online (BE#1599)", () => {
  it("an unanswered empty page with no engine connected is no_engine_connected, not an empty chat", async () => {
    const { result, text, paths } = await call({ action: "list_messages", chat_id: "1@c.us" }, [emptyPage, noEngines]);
    expect(result.isError).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ status: 503, code: "no_engine_connected", reason: "no_engine" });
    expect(paths).toEqual(["/v1/messages", "/v1/engines"]);
  });

  it("the same for a read across every chat (no chat_id)", async () => {
    const { result, text } = await call({ action: "list_messages" }, [emptyPage, noEngines]);
    expect(result.isError).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ code: "no_engine_connected" });
  });

  it("batch: each unreadable chat carries the no-engine error", async () => {
    const { result, text } = await call({ action: "list_messages", chat_ids: ["1@c.us", "2@c.us"] }, [emptyPage, noEngines]);
    expect(result.isError).toBeFalsy();
    expect(text).toContain("No WhatsApp engine is connected for this account");
    expect(text).not.toContain('"result"');
  });

  it("an engine online with a genuinely empty chat still returns the empty page", async () => {
    const { result, text } = await call({ action: "list_messages", chat_id: "1@c.us" }, [emptyPage, oneEngine]);
    expect(result.isError).toBeFalsy();
    expect(text).toContain('"total":0');
  });

  it("an engine-answered empty page (answeredBy) is returned without probing the engines", async () => {
    const answered: FakeRoute = {
      ...emptyPage,
      body: { success: true, data: [], limit: 20, skip: 0, total: 0, answeredBy: { engineId: "e1" } },
    };
    const { result, paths } = await call({ action: "list_messages", chat_id: "1@c.us" }, [answered, noEngines]);
    expect(result.isError).toBeFalsy();
    expect(paths).toEqual(["/v1/messages"]);
  });

  it("a page served from the backup tier (sources) is returned without probing the engines", async () => {
    const fromBackup: FakeRoute = {
      ...emptyPage,
      body: { success: true, data: [{ id: "m1" }], limit: 20, skip: 0, total: 1, sources: { backup: 1 } },
    };
    const { result, paths } = await call({ action: "list_messages", chat_id: "1@c.us" }, [fromBackup, noEngines]);
    expect(result.isError).toBeFalsy();
    expect(paths).toEqual(["/v1/messages"]);
  });

  it("a failed engine probe keeps the empty page as before", async () => {
    const probeDown: FakeRoute = { method: "GET", path: "/v1/engines", status: 500, body: { success: false, error: { code: "internal", message: "x", request_id: "r" } } };
    const { result, text } = await call({ action: "list_messages", chat_id: "1@c.us" }, [emptyPage, probeDown]);
    expect(result.isError).toBeFalsy();
    expect(text).toContain('"total":0');
  });
});

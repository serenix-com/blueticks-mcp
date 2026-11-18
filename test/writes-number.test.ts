// #2106 / #2102: chat writes, contacts list and groups leave must forward the number / engine selector to the /v1 route.
// Dropping it let a multi-number account act on its default engine.
import { describe, it, expect } from "vitest";
import { createClient } from "../src/client";
import { findTool } from "../src/manifest";
import { fakeFetch, type SeenRequest } from "./fake-fetch";

const NUM = "+972500000001";
const CHAT = "972547602737@c.us";
const KEY = "false_972547602737@c.us_3EB0ABCDEF";

async function call(tool: string, input: Record<string, unknown>, route: { method: string; path: RegExp }): Promise<SeenRequest> {
  const f = fakeFetch([{ ...route, body: { success: true, data: {} } }]);
  const client = createClient("bt_live_test", { baseUrl: "https://api.test", fetch: f.fetch, maxRetries: 0 });
  const t = findTool(tool);
  if (!t) throw new Error(`missing tool ${tool}`);
  await t.dispatch(input, client);
  const req = f.seen[0];
  if (!req) throw new Error("no request sent");
  return req;
}

describe("number selector on writes (#2106)", () => {
  it("mark_read", async () => {
    const r = await call("chats_write", { action: "mark_read", chat_id: CHAT, number: NUM }, { method: "POST", path: /mark_read/ });
    expect(r.query.phone).toEqual([NUM]);
  });
  it("react", async () => {
    const r = await call("chats_write", { action: "react", chat_id: CHAT, key: KEY, emoji: "👍", number: NUM }, { method: "POST", path: /reactions/ });
    expect(r.query.phone).toEqual([NUM]);
    expect(r.query.chatId).toEqual([CHAT]);
  });
  it("get_poll_results", async () => {
    const r = await call("chats_read", { action: "get_poll_results", chat_id: CHAT, key: KEY, number: NUM }, { method: "GET", path: /poll_results/ });
    expect(r.query.phone).toEqual([NUM]);
  });
  it("archive and unarchive", async () => {
    const a = await call("chats_write", { action: "archive", chat_id: CHAT, number: NUM }, { method: "POST", path: /\/archive$/ });
    const u = await call("chats_write", { action: "unarchive", chat_id: CHAT, number: NUM }, { method: "POST", path: /unarchive$/ });
    expect(a.query.phone).toEqual([NUM]);
    expect(u.query.phone).toEqual([NUM]);
  });
  it("no number adds no target", async () => {
    const r = await call("chats_write", { action: "mark_read", chat_id: CHAT }, { method: "POST", path: /mark_read/ });
    expect(r.query.phone).toBeUndefined();
    expect(r.query.numberId).toBeUndefined();
  });
});

describe("number selector on contacts list and groups leave (#2106, #2102)", () => {
  it("contacts list", async () => {
    const r = await call("contacts", { action: "list", query: "a", number: NUM }, { method: "GET", path: /\/v1\/contacts/ });
    expect(r.query.phone).toEqual([NUM]);
  });
  it("groups leave honours number and engine_id", async () => {
    const r = await call("groups", { action: "leave", group_id: "120363000000000000@g.us", number: NUM, engine_id: "e1" }, { method: "DELETE", path: /members\/me/ });
    expect(r.query.phone).toEqual([NUM]);
    expect(r.query.engineId).toEqual(["e1"]);
  });
});

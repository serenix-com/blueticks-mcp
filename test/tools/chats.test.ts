import { describe, it, expect, vi } from "vitest";
import chatsTool from "../../src/tools/chats";

const makeClient = () => ({
  chats: {
    list: vi.fn().mockResolvedValue({ data: [{ id: "972...@c.us", name: "X" }], has_more: false, next_cursor: null }),
    get: vi.fn().mockResolvedValue({ id: "972...@c.us", name: "X" }),
    listMessages: vi.fn().mockResolvedValue({ data: [], has_more: false, next_cursor: null }),
    markRead: vi.fn().mockResolvedValue({ ok: true }),
  },
});

describe("whatsapp_chats tool", () => {
  it("list forwards limit/cursor", async () => {
    const client = makeClient() as any;
    await chatsTool.dispatch({ action: "list", limit: 5 }, client);
    expect(client.chats.list).toHaveBeenCalledWith({ limit: 5 });
  });

  it("search calls list with query forwarded as `query`", async () => {
    const client = makeClient() as any;
    await chatsTool.dispatch({ action: "search", query: "noam" }, client);
    expect(client.chats.list).toHaveBeenCalledWith({ query: "noam" });
  });

  it("get forwards chat_id", async () => {
    const client = makeClient() as any;
    await chatsTool.dispatch({ action: "get", chat_id: "972@c.us" }, client);
    expect(client.chats.get).toHaveBeenCalledWith("972@c.us");
  });

  it("list_messages forwards chat_id, limit, cursor", async () => {
    const client = makeClient() as any;
    await chatsTool.dispatch(
      { action: "list_messages", chat_id: "972@c.us", limit: 10 },
      client,
    );
    expect(client.chats.listMessages).toHaveBeenCalledWith("972@c.us", { limit: 10 });
  });

  it("mark_read forwards chat_id", async () => {
    const client = makeClient() as any;
    await chatsTool.dispatch({ action: "mark_read", chat_id: "972@c.us" }, client);
    expect(client.chats.markRead).toHaveBeenCalledWith("972@c.us");
  });
});

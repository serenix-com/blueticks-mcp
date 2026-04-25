import { describe, it, expect, vi } from "vitest";
import messagesTool from "../../src/tools/messages";

const makeClient = () => ({
  messages: {
    send: vi.fn().mockResolvedValue({ id: "m1", to: "+972544325389", status: "queued" }),
    get: vi.fn().mockResolvedValue({ id: "m1", status: "delivered" }),
    list: vi.fn().mockResolvedValue({ data: [], has_more: false, next_cursor: null }),
  },
});

describe("whatsapp_messages tool", () => {
  it("send forwards to, text, and media_url to client.messages.send", async () => {
    const client = makeClient() as any;
    await messagesTool.dispatch(
      { action: "send", to: "+972544325389", text: "hi" },
      client,
    );
    expect(client.messages.send).toHaveBeenCalledWith({
      to: "+972544325389",
      text: "hi",
    });
  });

  it("get forwards id", async () => {
    const client = makeClient() as any;
    await messagesTool.dispatch({ action: "get", id: "m1" }, client);
    expect(client.messages.get).toHaveBeenCalledWith("m1");
  });

  it("list forwards limit and cursor", async () => {
    const client = makeClient() as any;
    await messagesTool.dispatch({ action: "list", limit: 10 }, client);
    expect(client.messages.list).toHaveBeenCalledWith({ limit: 10 });
  });
});

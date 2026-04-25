import { describe, it, expect, vi } from "vitest";
import webhooksTool from "../../src/tools/webhooks";

const makeClient = () => ({
  webhooks: {
    list: vi.fn().mockResolvedValue({ data: [], has_more: false, next_cursor: null }),
    create: vi.fn().mockResolvedValue({ id: "wh_1", secret: "whsec_..." }),
    get: vi.fn().mockResolvedValue({ id: "wh_1" }),
    update: vi.fn().mockResolvedValue({ id: "wh_1" }),
    delete: vi.fn().mockResolvedValue(undefined),
    rotateSecret: vi.fn().mockResolvedValue({ id: "wh_1", secret: "whsec_new" }),
  },
});

describe("whatsapp_webhooks tool", () => {
  it("list", async () => {
    const c = makeClient() as any;
    await webhooksTool.dispatch({ action: "list", limit: 3 }, c);
    expect(c.webhooks.list).toHaveBeenCalledWith({ limit: 3 });
  });
  it("create", async () => {
    const c = makeClient() as any;
    await webhooksTool.dispatch(
      { action: "create", url: "https://example.com/hook", events: ["message.delivered"] },
      c,
    );
    expect(c.webhooks.create).toHaveBeenCalledWith({
      url: "https://example.com/hook",
      events: ["message.delivered"],
    });
  });
  it("get / update / delete / rotate_secret", async () => {
    const c = makeClient() as any;
    await webhooksTool.dispatch({ action: "get", webhook_id: "wh_1" }, c);
    expect(c.webhooks.get).toHaveBeenCalledWith("wh_1");
    await webhooksTool.dispatch(
      { action: "update", webhook_id: "wh_1", url: "https://new" },
      c,
    );
    expect(c.webhooks.update).toHaveBeenCalledWith("wh_1", { url: "https://new" });
    await webhooksTool.dispatch({ action: "delete", webhook_id: "wh_1" }, c);
    expect(c.webhooks.delete).toHaveBeenCalledWith("wh_1");
    await webhooksTool.dispatch({ action: "rotate_secret", webhook_id: "wh_1" }, c);
    expect(c.webhooks.rotateSecret).toHaveBeenCalledWith("wh_1");
  });
});

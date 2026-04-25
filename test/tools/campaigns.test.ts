import { describe, it, expect, vi } from "vitest";
import campaignsTool from "../../src/tools/campaigns";

const makeClient = () => ({
  campaigns: {
    list: vi.fn().mockResolvedValue({ data: [], has_more: false, next_cursor: null }),
    create: vi.fn().mockResolvedValue({ id: "camp_1", status: "pending" }),
    get: vi.fn().mockResolvedValue({ id: "camp_1" }),
    pause: vi.fn().mockResolvedValue({ id: "camp_1", status: "paused" }),
    resume: vi.fn().mockResolvedValue({ id: "camp_1", status: "running" }),
    cancel: vi.fn().mockResolvedValue({ id: "camp_1", status: "aborted" }),
  },
});

describe("whatsapp_campaigns tool", () => {
  it("list", async () => {
    const c = makeClient() as any;
    await campaignsTool.dispatch({ action: "list", limit: 5 }, c);
    expect(c.campaigns.list).toHaveBeenCalledWith({ limit: 5 });
  });

  it("create forwards name, audience_id, text, from, on_missing_variable", async () => {
    const c = makeClient() as any;
    await campaignsTool.dispatch(
      {
        action: "create",
        name: "My Campaign",
        audience_id: "aud_1",
        text: "Hi {{name}}",
        from: "gw_1",
        on_missing_variable: "skip" as const,
      },
      c,
    );
    expect(c.campaigns.create).toHaveBeenCalledWith({
      name: "My Campaign",
      audience_id: "aud_1",
      text: "Hi {{name}}",
      from: "gw_1",
      on_missing_variable: "skip",
    });
  });

  it.each([
    ["get", "get"],
    ["pause", "pause"],
    ["resume", "resume"],
    ["cancel", "cancel"],
  ] as const)("%s forwards campaign_id", async (action, method) => {
    const c = makeClient() as any;
    await campaignsTool.dispatch({ action, campaign_id: "camp_1" }, c);
    expect(c.campaigns[method]).toHaveBeenCalledWith("camp_1");
  });
});

import { describe, it, expect, vi } from "vitest";
import groupsTool from "../../src/tools/groups";

const makeClient = () => ({
  groups: {
    get: vi.fn().mockResolvedValue({ id: "g1@g.us", name: "Test" }),
    create: vi.fn().mockResolvedValue({ id: "g1@g.us", name: "Test" }),
    update: vi.fn().mockResolvedValue({ id: "g1@g.us", name: "Renamed" }),
  },
});

describe("whatsapp_groups tool", () => {
  it("get forwards group_id (no include by default)", async () => {
    const client = makeClient() as any;
    await groupsTool.dispatch({ action: "get", group_id: "g@g.us" }, client);
    // Second arg is `undefined` when include_participants is not set —
    // the dispatch always passes a 2-arity call, the SDK's optional
    // second param is ignored on that side.
    expect(client.groups.get).toHaveBeenCalledWith("g@g.us", undefined);
  });

  it("get forwards include=participants when include_participants=true", async () => {
    const client = makeClient() as any;
    await groupsTool.dispatch(
      { action: "get", group_id: "g@g.us", include_participants: true },
      client,
    );
    expect(client.groups.get).toHaveBeenCalledWith("g@g.us", { include: ["participants"] });
  });

  it("create forwards name and participants", async () => {
    const client = makeClient() as any;
    await groupsTool.dispatch(
      { action: "create", name: "Test", participants: ["972544325389"] },
      client,
    );
    expect(client.groups.create).toHaveBeenCalledWith({ name: "Test", participants: ["972544325389"] });
  });

  it("update forwards group_id and changes", async () => {
    const client = makeClient() as any;
    await groupsTool.dispatch(
      { action: "update", group_id: "g@g.us", name: "Renamed" },
      client,
    );
    expect(client.groups.update).toHaveBeenCalledWith("g@g.us", { name: "Renamed" });
  });
});

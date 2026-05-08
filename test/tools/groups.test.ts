import { describe, it, expect, vi } from "vitest";
import groupsTool from "../../src/tools/groups";

const makeClient = () => ({
  groups: {
    get: vi.fn().mockResolvedValue({ id: "g1@g.us", name: "Test" }),
    create: vi.fn().mockResolvedValue({ id: "g1@g.us", name: "Test" }),
    update: vi.fn().mockResolvedValue({ id: "g1@g.us", name: "Renamed" }),
  },
  chats: {
    listParticipants: vi
      .fn()
      .mockResolvedValue([{ id: "972544325389@c.us", admin: true }]),
  },
});

describe("whatsapp_groups tool", () => {
  it("get forwards group_id (no include by default)", async () => {
    const client = makeClient() as any;
    await groupsTool.dispatch({ action: "get", group_id: "g@g.us" }, client);
    // SDK signature is single-arg. The dispatcher omits the include
    // option when not set so it's a clean 1-arity call.
    expect(client.groups.get).toHaveBeenCalledWith("g@g.us");
    expect(client.chats.listParticipants).not.toHaveBeenCalled();
  });

  it("emulates include=participants by chaining chats.listParticipants", async () => {
    const client = makeClient() as any;
    const result = await groupsTool.dispatch(
      { action: "get", group_id: "g@g.us", include_participants: true },
      client,
    );
    expect(client.groups.get).toHaveBeenCalledWith("g@g.us");
    expect(client.chats.listParticipants).toHaveBeenCalledWith("g@g.us");
    // Result merges both calls — `participants` from the chats call
    // is added to the group object.
    const payload = JSON.parse(result.content[0]!.text);
    expect(payload.id).toBe("g1@g.us");
    expect(payload.participants).toEqual([
      { id: "972544325389@c.us", admin: true },
    ]);
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

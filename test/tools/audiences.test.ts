import { describe, it, expect, vi } from "vitest";
import audiencesTool from "../../src/tools/audiences";

const makeClient = () => {
  const audiences = {
    list: vi.fn().mockResolvedValue({ data: [], has_more: false, next_cursor: null }),
    create: vi.fn().mockResolvedValue({ id: "aud_1", name: "Leads" }),
    get: vi.fn().mockResolvedValue({ id: "aud_1", name: "Leads" }),
    update: vi.fn().mockResolvedValue({ id: "aud_1", name: "Renamed" }),
    delete: vi.fn().mockResolvedValue(undefined),
    appendContacts: vi.fn().mockResolvedValue({ added: 2, contact_count: 5 }),
    updateContact: vi.fn().mockResolvedValue({ id: "c1", to: "+972..." }),
    deleteContact: vi.fn().mockResolvedValue(undefined),
  };
  return { audiences };
};

describe("whatsapp_audiences tool", () => {
  it("list", async () => {
    const c = makeClient() as any;
    await audiencesTool.dispatch({ action: "list", limit: 3 }, c);
    expect(c.audiences.list).toHaveBeenCalledWith({ limit: 3 });
  });
  it("create", async () => {
    const c = makeClient() as any;
    await audiencesTool.dispatch({ action: "create", name: "Leads" }, c);
    expect(c.audiences.create).toHaveBeenCalledWith({ name: "Leads" });
  });
  it("get/update/delete", async () => {
    const c = makeClient() as any;
    await audiencesTool.dispatch({ action: "get", audience_id: "aud_1" }, c);
    expect(c.audiences.get).toHaveBeenCalledWith("aud_1");
    await audiencesTool.dispatch(
      { action: "update", audience_id: "aud_1", name: "Renamed" },
      c,
    );
    expect(c.audiences.update).toHaveBeenCalledWith("aud_1", { name: "Renamed" });
    await audiencesTool.dispatch({ action: "delete", audience_id: "aud_1" }, c);
    expect(c.audiences.delete).toHaveBeenCalledWith("aud_1");
  });
  it("append_contacts", async () => {
    const c = makeClient() as any;
    await audiencesTool.dispatch(
      {
        action: "append_contacts",
        audience_id: "aud_1",
        contacts: [{ to: "+972544325389" }],
      },
      c,
    );
    // SDK takes (id, contacts[]) — array directly, not wrapped in { contacts }
    expect(c.audiences.appendContacts).toHaveBeenCalledWith("aud_1", [{ to: "+972544325389" }]);
  });
  it("update_contact / remove_contact", async () => {
    const c = makeClient() as any;
    await audiencesTool.dispatch(
      {
        action: "update_contact",
        audience_id: "aud_1",
        contact_id: "c1",
        to: "+1234567890",
      },
      c,
    );
    expect(c.audiences.updateContact).toHaveBeenCalledWith("aud_1", "c1", { to: "+1234567890" });
    await audiencesTool.dispatch(
      { action: "remove_contact", audience_id: "aud_1", contact_id: "c1" },
      c,
    );
    // SDK method is deleteContact, not removeContact
    expect(c.audiences.deleteContact).toHaveBeenCalledWith("aud_1", "c1");
  });
});

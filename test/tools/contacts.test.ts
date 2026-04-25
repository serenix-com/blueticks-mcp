import { describe, it, expect, vi } from "vitest";
import contactsTool from "../../src/tools/contacts";

const makeClient = () => ({
  contacts: {
    list: vi.fn().mockResolvedValue({ data: [], has_more: false, next_cursor: null }),
    getProfilePicture: vi.fn().mockResolvedValue({ url: "https://x.com/p.jpg" }),
  },
});

describe("whatsapp_contacts tool", () => {
  it("list forwards limit + cursor + query", async () => {
    const client = makeClient() as any;
    await contactsTool.dispatch({ action: "list", query: "doug", limit: 10 }, client);
    expect(client.contacts.list).toHaveBeenCalledWith({ query: "doug", limit: 10 });
  });

  it("get_profile_picture forwards chat_id", async () => {
    const client = makeClient() as any;
    await contactsTool.dispatch(
      { action: "get_profile_picture", chat_id: "972@c.us" },
      client,
    );
    expect(client.contacts.getProfilePicture).toHaveBeenCalledWith("972@c.us");
  });
});

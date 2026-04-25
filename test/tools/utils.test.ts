import { describe, it, expect, vi } from "vitest";
import utilsTool from "../../src/tools/utils";

describe("whatsapp_utils tool", () => {
  it("dispatches validate_phone -> client.utils.validatePhone with phone_or_chat_id", async () => {
    const validatePhone = vi.fn().mockResolvedValue({ valid: true, formatted_chat_id: null });
    const client = { utils: { validatePhone, linkPreview: vi.fn() } } as any;
    const r = await utilsTool.dispatch(
      { action: "validate_phone", phone_or_chat_id: "+972544325389" },
      client,
    );
    expect(validatePhone).toHaveBeenCalledWith({ phone_or_chat_id: "+972544325389" });
    expect(r.isError).toBeFalsy();
  });

  it("dispatches link_preview -> client.utils.linkPreview", async () => {
    const linkPreview = vi.fn().mockResolvedValue({ url: "https://blueticks.co" });
    const client = { utils: { linkPreview, validatePhone: vi.fn() } } as any;
    await utilsTool.dispatch({ action: "link_preview", url: "https://blueticks.co" }, client);
    expect(linkPreview).toHaveBeenCalledWith({ url: "https://blueticks.co" });
  });
});

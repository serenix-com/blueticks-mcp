import { describe, it, expect, vi } from "vitest";
import groupsTool from "../src/tool-defs/tools/groups";
import type { BlueticksSurface } from "../src/tool-defs/surface";

function surface() {
  const groups = {
    getPicture: vi.fn().mockResolvedValue({ url: "https://cdn.test/p.jpg" }),
    setPicture: vi.fn().mockResolvedValue({ id: "g@g.us" }),
    removePicture: vi.fn().mockResolvedValue({ ok: true }),
  };
  return { groups, client: { groups } as unknown as BlueticksSurface };
}

describe("groups picture actions", () => {
  it("get_picture and remove_picture delegate to the SDK", async () => {
    const { groups, client } = surface();
    await groupsTool.dispatch({ action: "get_picture", group_id: "g@g.us" }, client);
    await groupsTool.dispatch({ action: "remove_picture", group_id: "g@g.us" }, client);
    expect(groups.getPicture).toHaveBeenCalledWith("g@g.us");
    expect(groups.removePicture).toHaveBeenCalledWith("g@g.us");
  });

  it("set_picture sends an https url as { url }", async () => {
    const { groups, client } = surface();
    await groupsTool.dispatch(
      { action: "set_picture", group_id: "g@g.us", picture_url: "https://cdn.test/p.jpg" },
      client,
    );
    expect(groups.setPicture).toHaveBeenCalledWith("g@g.us", { url: "https://cdn.test/p.jpg" });
  });

  it("set_picture wraps bare base64 into a data URL, defaulting to image/jpeg", async () => {
    const { groups, client } = surface();
    await groupsTool.dispatch(
      { action: "set_picture", group_id: "g@g.us", picture_base64: "QUJD" },
      client,
    );
    expect(groups.setPicture).toHaveBeenCalledWith("g@g.us", {
      fileDataUrl: "data:image/jpeg;base64,QUJD",
    });
  });

  it("set_picture passes a data: URL through untouched", async () => {
    const { groups, client } = surface();
    await groupsTool.dispatch(
      { action: "set_picture", group_id: "g@g.us", picture_base64: "data:image/png;base64,QUJD" },
      client,
    );
    expect(groups.setPicture).toHaveBeenCalledWith("g@g.us", {
      fileDataUrl: "data:image/png;base64,QUJD",
    });
  });

  it("the input schema lists the three picture actions", () => {
    expect(JSON.stringify(groupsTool.inputSchema)).toContain("remove_picture");
    expect(JSON.stringify(groupsTool.inputSchema)).toContain("picture_base64");
  });
});

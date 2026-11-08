import { describe, it, expect, vi } from "vitest";
import { buildToolList, findTool, type ManifestTool } from "../src/manifest";
import type { BlueticksSurface } from "../src/tool-defs/surface";

const names = (): string[] => buildToolList().map((t) => t.name);

function actionsOf(tool: ManifestTool): string[] {
  const props = tool.inputSchema.properties as { action?: { enum?: string[] } } | undefined;
  return props?.action?.enum ?? [];
}

function required(name: string): ManifestTool {
  const tool = findTool(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

describe("hosted-default tool names", () => {
  it("lists the split names, not the mixed ones", () => {
    expect(names().sort()).toEqual(
      [
        "audiences",
        "campaigns",
        "chats_read",
        "chats_write",
        "contacts",
        "engine",
        "groups",
        "scheduled_messages_read",
        "scheduled_messages_write",
        "utils",
        "webhooks",
      ].sort(),
    );
    expect(names()).not.toContain("chats");
    expect(names()).not.toContain("scheduled_messages");
  });
});

describe("read/write halves", () => {
  it("chats_read holds only read-only actions", () => {
    expect(actionsOf(required("chats_read")).sort()).toEqual(
      ["get", "get_media", "get_participants", "list", "list_messages", "search"].sort(),
    );
  });

  it("chats_write holds the rest", () => {
    expect(actionsOf(required("chats_write")).sort()).toEqual(
      [
        "archive",
        "load_more_history",
        "mark_read",
        "send_message_media",
        "send_message_poll",
        "send_message_text",
        "unarchive",
      ].sort(),
    );
  });

  it("scheduled_messages halves partition the actions", () => {
    expect(actionsOf(required("scheduled_messages_read")).sort()).toEqual(["ack", "get", "list"]);
    expect(actionsOf(required("scheduled_messages_write")).sort()).toEqual(["cancel", "send", "update"]);
  });

  it("marks hints: read is read-only, write is destructive", () => {
    expect(required("chats_read").annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(required("chats_write").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it("description of a half names only its own actions", () => {
    const read = required("chats_read").description;
    expect(read).toContain("list_messages");
    expect(read).not.toContain("send_message_text");
    expect(required("chats_write").description).not.toContain("  - list_messages");
  });
});

describe("dispatch", () => {
  const client = { chats: { list: vi.fn().mockResolvedValue({}) } } as unknown as BlueticksSurface;

  it("refuses a write action on the read half, naming the sibling", async () => {
    const res = await required("chats_read").dispatch(
      { action: "send_message_text", chat_id: "1@c.us", text: "hi" },
      client,
    );
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("chats_write");
  });

  it("runs a read action on the read half", async () => {
    const res = await required("chats_read").dispatch({ action: "list" }, client);
    expect(res.isError).toBeFalsy();
  });

  it("returns undefined for the retired mixed name", () => {
    expect(findTool("chats")).toBeUndefined();
  });
});

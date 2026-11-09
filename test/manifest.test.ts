import { describe, it, expect } from "vitest";
import { buildServerInstructions, buildToolList, findTool, type ManifestTool } from "../src/manifest";
import { createClient } from "../src/client";
import { SPLIT_TOOL_DESCRIPTIONS } from "../src/tool-defs/hosted/default-descriptions";
import { fakeFetch } from "./fake-fetch";
import messagesTool from "../src/tool-defs/tools/scheduled-messages";

const names = (): string[] => buildToolList().map((t) => t.name);

function actionsOf(tool: ManifestTool): string[] {
  const props = tool.inputSchema.properties as { action?: { enum?: string[] } } | undefined;
  return props?.action?.enum ?? [];
}

function listed(name: string): ManifestTool {
  const tool = buildToolList().find((t) => t.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

describe("hosted-default tool names", () => {
  it("lists what an API-key connection sees on hosted", () => {
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
        "tasks",
        "utils",
        "webhooks",
      ].sort(),
    );
  });

  it("does not list the mixed names, but still accepts them on call", () => {
    expect(names()).not.toContain("chats");
    expect(names()).not.toContain("scheduled_messages");
    expect(findTool("chats")).toBeDefined();
    expect(findTool("scheduled_messages")).toBeDefined();
  });
});

describe("read/write halves", () => {
  it("chats_read holds only read-only actions", () => {
    expect(actionsOf(listed("chats_read")).sort()).toEqual(
      ["get", "get_latest", "get_media", "get_participants", "get_poll_results", "list", "list_messages", "search"].sort(),
    );
  });

  it("chats_write holds the rest", () => {
    expect(actionsOf(listed("chats_write")).sort()).toEqual(
      [
        "archive",
        "load_more_history",
        "mark_read",
        "react",
        "send_button_reply",
        "send_message_media",
        "send_message_poll",
        "send_message_text",
        "unarchive",
      ].sort(),
    );
  });

  it("scheduled_messages halves partition the actions", () => {
    expect(actionsOf(listed("scheduled_messages_read")).sort()).toEqual(["ack", "get", "list"]);
    expect(actionsOf(listed("scheduled_messages_write")).sort()).toEqual(["cancel", "send", "update"]);
  });

  it("marks hints: read is read-only, write is destructive", () => {
    expect(listed("chats_read").annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(listed("chats_write").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it("uses the hosted listed descriptions", () => {
    expect(listed("chats_read").description).toBe(SPLIT_TOOL_DESCRIPTIONS.chats.read);
    expect(listed("scheduled_messages_write").description).toBe(SPLIT_TOOL_DESCRIPTIONS.scheduledMessages.write);
  });

  it("each half's description names exactly its own actions", () => {
    for (const name of ["chats_read", "chats_write", "scheduled_messages_read", "scheduled_messages_write"]) {
      const tool = listed(name);
      const described = [...tool.description.matchAll(/^ {2}- ([\w /]+):/gm)].flatMap((m) =>
        (m[1] ?? "").split(" / ").map((s) => s.trim()),
      );
      expect(described.sort()).toEqual(actionsOf(tool).sort());
    }
  });
});

describe("server instructions", () => {
  it("carry the untrusted-content notice and guidance for the listed tools only", () => {
    const text = buildServerInstructions();
    expect(text).toContain("untrusted data");
    expect(text).toContain("chats_read / chats_write:");
    expect(text).toContain("tasks:");
    expect(text).not.toContain("agents:");
    expect(text).not.toContain("calendar:");
  });
});

describe("dispatch", () => {
  const f = fakeFetch([{ method: "GET", path: "/v1/chats", body: { data: [] } }]);
  const client = createClient("bt_live_test", { baseUrl: "https://api.test", fetch: f.fetch, maxRetries: 0 });

  it("refuses a write action on the read half, naming the sibling", async () => {
    const res = await listed("chats_read").dispatch(
      { action: "send_message_text", chat_id: "1@c.us", text: "hi" },
      client,
    );
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("chats_write");
    expect(f.seen).toHaveLength(0);
  });

  it("runs a read action on the read half", async () => {
    const res = await listed("chats_read").dispatch({ action: "list" }, client);
    expect(res.isError).toBeFalsy();
    expect(f.seen.map((r) => r.path)).toContain("/v1/chats");
  });

  it("rejects an action the tool does not declare", async () => {
    const res = await listed("utils").dispatch({ action: "nope" }, client);
    expect(res.isError).toBe(true);
  });
});

describe("send_at takes a UTC offset (#1597)", () => {
  // The manifest dispatch skips zod, so check the tool's own schema directly.
  it.each([
    ["send", { action: "send", to: "1@c.us", text: "hi", send_at: "2030-12-01T09:00:00+02:00" }],
    ["update", { action: "update", id: "m1", send_at: "2030-12-01T09:00:00-05:00" }],
  ])("%s", (_name, input) => {
    expect(messagesTool.parse(input)).toMatchObject({ send_at: input.send_at });
  });
});

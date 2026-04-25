import { describe, it, expect, vi } from "vitest";
import audiencesTool from "../../src/tools/audiences";
import campaignsTool from "../../src/tools/campaigns";
import chatsTool from "../../src/tools/chats";
import engineTool from "../../src/tools/engine";
import webhooksTool from "../../src/tools/webhooks";

// Regression: SDK methods that resolve to `undefined` (delete, cancel,
// mark_read, logout, ...) used to produce MCP content with no `text` field
// because `JSON.stringify(undefined) === undefined`. The MCP client then
// rejects the response with a union-validation error. Every tool's return
// site must coerce undefined to a JSON-safe value.

type Case = {
  name: string;
  // `any` for input/client to bypass TS contravariance: each tool's dispatch
  // takes a narrow input union (WebhooksInput, AudiencesInput, etc.) and a
  // typed Blueticks client; widening to unknown here would reject the
  // assignment. Test bodies cast to never anyway.
  tool: { dispatch: (input: any, client: any) => Promise<unknown> };
  input: Record<string, unknown>;
  client: Record<string, unknown>;
};

const voidResolved = vi.fn().mockResolvedValue(undefined);

const cases: Case[] = [
  {
    name: "webhooks delete",
    tool: webhooksTool,
    input: { action: "delete", webhook_id: "wh_1" },
    client: { webhooks: { delete: voidResolved } },
  },
  {
    name: "audiences delete",
    tool: audiencesTool,
    input: { action: "delete", audience_id: "aud_1" },
    client: { audiences: { delete: voidResolved } },
  },
  {
    name: "audiences remove_contact",
    tool: audiencesTool,
    input: { action: "remove_contact", audience_id: "aud_1", contact_id: "c_1" },
    client: { audiences: { deleteContact: voidResolved } },
  },
  {
    name: "campaigns cancel",
    tool: campaignsTool,
    input: { action: "cancel", campaign_id: "camp_1" },
    client: { campaigns: { cancel: voidResolved } },
  },
  {
    name: "chats mark_read",
    tool: chatsTool,
    input: { action: "mark_read", chat_id: "972544325389@c.us" },
    client: { chats: { markRead: voidResolved } },
  },
  {
    name: "engine logout",
    tool: engineTool,
    input: { action: "logout" },
    client: { engines: { logout: voidResolved } },
  },
];

describe("void SDK responses produce MCP-valid content", () => {
  for (const c of cases) {
    it(c.name, async () => {
      const result = (await c.tool.dispatch(c.input as never, c.client as never)) as {
        content: { type: string; text: string }[];
      };
      expect(result.content).toBeInstanceOf(Array);
      expect(result.content.length).toBeGreaterThan(0);
      const block = result.content[0]!;
      expect(block.type).toBe("text");
      expect(typeof block.text).toBe("string");
      expect(block.text.length).toBeGreaterThan(0);
    });
  }
});

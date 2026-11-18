// #2104: list_messages must forward the number / engine / engine_id selector to /v1/messages.
// Dropping them made a multi-number account answer 409 AMBIGUOUS_NUMBER.
import { describe, it, expect } from "vitest";
import { createClient } from "../src/client";
import { findTool } from "../src/manifest";
import { fakeFetch } from "./fake-fetch";

const BASE = "https://api.test";
const page = {
  method: "GET" as const,
  path: "/v1/messages",
  body: { success: true, data: [{ id: "m1" }], limit: 20, skip: 0, total: 1 },
};

async function readQuery(input: Record<string, unknown>): Promise<(k: string) => string | undefined> {
  const f = fakeFetch([page]);
  const client = createClient("bt_live_test", { baseUrl: BASE, fetch: f.fetch, maxRetries: 0 });
  const tool = findTool("chats_read");
  if (!tool) throw new Error("missing tool chats_read");
  await tool.dispatch(input, client);
  const query = f.seen[0].query;
  return (k) => query[k]?.[0];
}

describe("list_messages number selector (#2104)", () => {
  it("forwards an E.164 number as phone", async () => {
    const q = await readQuery({ action: "list_messages", chat_id: "1@c.us", number: "+972501234567" });
    expect(q("phone")).toBe("+972501234567");
  });

  it("forwards a 24-hex number id as numberId", async () => {
    const q = await readQuery({ action: "list_messages", number: "6a0000000000000000000001" });
    expect(q("numberId")).toBe("6a0000000000000000000001");
  });

  it("forwards engine and engine_id", async () => {
    const q = await readQuery({ action: "list_messages", chat_id: "1@c.us", engine: "baileys", engine_id: "abc" });
    expect(q("engine")).toBe("baileys");
    expect(q("engineId")).toBe("abc");
  });
});

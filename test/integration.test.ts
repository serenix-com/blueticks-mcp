import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(here, "..", "src", "index.ts");

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: unknown;
}

function sendAndCollect(child: ReturnType<typeof spawn>, msg: object): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j: JsonRpcResponse = JSON.parse(line);
          if (j.id !== undefined) {
            child.stdout?.off("data", onData);
            resolve(j);
            return;
          }
        } catch {
          // ignore non-JSON noise
        }
      }
    };
    child.stdout?.on("data", onData);
    child.on("error", reject);
    child.stdin?.write(JSON.stringify(msg) + "\n");
  });
}

describe("MCP server (integration)", () => {
  it("lists exactly 9 tools, all whatsapp_*", async () => {
    const child = spawn("npx", ["tsx", ENTRY, "--api-key", "bt_live_test"], {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, NODE_ENV: "test" },
    });

    // initialize
    await sendAndCollect(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });

    // tools/list
    const resp = await sendAndCollect(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    child.kill();

    const tools = (resp.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "whatsapp_audiences",
        "whatsapp_campaigns",
        "whatsapp_chats",
        "whatsapp_contacts",
        "whatsapp_engine",
        "whatsapp_groups",
        "whatsapp_messages",
        "whatsapp_utils",
        "whatsapp_webhooks",
      ].sort(),
    );
  }, 15000);
});

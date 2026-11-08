// The tool list this stdio server advertises. It mirrors the hosted server's
// default manifest (api.blueticks.co/mcp, backend client-manifests.ts): `chats`
// and `scheduled_messages` are mixed tools, so they are listed as a read-only
// half (`<name>_read`) and a write half (`<name>_write`). A half's actions are
// decided by the per-action `readOnlyHint` annotation in the tool def, the same
// rule the hosted OAuth write-gate uses. The other tools are listed unchanged.
import {
  audiencesTool,
  campaignsTool,
  chatsTool,
  contactsTool,
  engineTool,
  groupsTool,
  scheduledMessagesTool,
  utilsTool,
  webhooksTool,
  type BlueticksSurface,
  type ToolResult,
} from "./tool-defs";

export type ToolHalf = "read" | "write";

export interface ToolHints {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
}

export interface ManifestTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown> & { type: "object" };
  annotations?: ToolHints;
  dispatch(input: unknown, client: BlueticksSurface): Promise<ToolResult>;
}

interface SourceTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown> };
  annotations: Readonly<Record<string, { readOnlyHint?: boolean }>>;
  dispatch(input: never, client: BlueticksSurface): Promise<ToolResult>;
}

const HALF_HEADERS: Readonly<Record<string, Readonly<Record<ToolHalf, string>>>> = {
  chats: {
    read: "Read WhatsApp chats and messages on the connected engine. Read-only: it changes nothing in WhatsApp.",
    write: "Send WhatsApp messages into chats now, and mark chats read, archive or unarchive them, and load older history.",
  },
  scheduled_messages: {
    read: "Look up scheduled WhatsApp messages and their delivery status. Read-only.",
    write: "Send, schedule, edit or cancel WhatsApp messages.",
  },
};

const HINTS: Readonly<Record<ToolHalf, ToolHints>> = {
  read: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  write: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
};

const asDispatch = (
  tool: SourceTool,
): ((input: unknown, client: BlueticksSurface) => Promise<ToolResult>) =>
  tool.dispatch as unknown as (input: unknown, client: BlueticksSurface) => Promise<ToolResult>;

/** Keep the description's header plus only the `  - <action>:` blocks in `keep`. */
function describeHalf(source: SourceTool, half: ToolHalf, keep: ReadonlySet<string>): string {
  const lines = source.description.split("\n");
  const out: string[] = [HALF_HEADERS[source.name]?.[half] ?? "", "Available actions:"];
  let inKept = false;
  let inBlocks = false;
  for (const line of lines) {
    const head = /^ {2}- (\w+):/.exec(line);
    if (head) {
      inBlocks = true;
      inKept = keep.has(head[1] ?? "");
    } else if (inBlocks && !/^ {4,}/.test(line)) {
      break;
    }
    if (inKept) out.push(line);
  }
  return out.join("\n");
}

function splitTool(source: SourceTool): ManifestTool[] {
  const all = Object.keys(source.annotations);
  const dispatch = asDispatch(source);
  const isRead = (a: string): boolean => source.annotations[a]?.readOnlyHint === true;
  const actions: Record<ToolHalf, string[]> = {
    read: all.filter(isRead),
    write: all.filter((a) => !isRead(a)),
  };

  return (["read", "write"] as const).map((half): ManifestTool => {
    const name = `${source.name}_${half}`;
    const sibling = `${source.name}_${half === "read" ? "write" : "read"}`;
    const own = new Set(actions[half]);
    return {
      name,
      description: describeHalf(source, half, own),
      inputSchema: {
        ...source.inputSchema,
        properties: {
          ...source.inputSchema.properties,
          action: { type: "string", enum: actions[half] },
        },
      },
      annotations: HINTS[half],
      async dispatch(input, client) {
        const action = (input as { action?: unknown } | null | undefined)?.action;
        if (typeof action !== "string" || !own.has(action)) {
          const where = typeof action === "string" && all.includes(action) ? ` Use '${sibling}' for '${action}'.` : "";
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: "action_not_available",
                  error_description: `'${name}' accepts these actions: ${actions[half].join(", ")}.${where}`,
                }),
              },
            ],
          };
        }
        return dispatch(input, client);
      },
    };
  });
}

const whole = (tool: SourceTool): ManifestTool => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  dispatch: asDispatch(tool),
});

export function buildToolList(): ManifestTool[] {
  return [
    ...splitTool(scheduledMessagesTool as unknown as SourceTool),
    ...splitTool(chatsTool as unknown as SourceTool),
    whole(contactsTool as unknown as SourceTool),
    whole(groupsTool as unknown as SourceTool),
    whole(audiencesTool as unknown as SourceTool),
    whole(campaignsTool as unknown as SourceTool),
    whole(webhooksTool as unknown as SourceTool),
    whole(engineTool as unknown as SourceTool),
    whole(utilsTool as unknown as SourceTool),
  ];
}

export function findTool(name: string): ManifestTool | undefined {
  return buildToolList().find((t) => t.name === name);
}

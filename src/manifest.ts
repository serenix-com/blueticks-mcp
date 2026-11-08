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

interface SourceTool<I extends { action: string } = { action: string }> {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown> };
  annotations: Readonly<Record<string, { readOnlyHint?: boolean; destructiveHint?: boolean }>>;
  dispatch(input: I, client: BlueticksSurface): Promise<ToolResult>;
}

/** A tool with its per-tool input type erased behind a runtime action check. */
interface Source {
  name: string;
  description: string;
  inputSchema: SourceTool["inputSchema"];
  annotations: SourceTool["annotations"];
  dispatch(input: unknown, client: BlueticksSurface): Promise<ToolResult>;
}

function hasAction(input: unknown, actions: ReadonlySet<string>): input is { action: string } {
  if (typeof input !== "object" || input === null || !("action" in input)) return false;
  return typeof input.action === "string" && actions.has(input.action);
}

/** Erase a tool's own input type; unknown actions are rejected before dispatch. */
function toSource<I extends { action: string }>(
  tool: SourceTool<I>,
  isInput: (input: { action: string }) => input is I,
): Source {
  const actions = new Set(Object.keys(tool.annotations));
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    dispatch(input, client) {
      if (!hasAction(input, actions) || !isInput(input)) {
        return Promise.resolve({
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: "invalid_input" }) }],
        });
      }
      return tool.dispatch(input, client);
    },
  };
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

/** Keep the description's header plus only the `  - <action>:` blocks in `keep`. */
function describeHalf(source: Source, half: ToolHalf, keep: ReadonlySet<string>): string {
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

function splitTool(source: Source): ManifestTool[] {
  const all = Object.keys(source.annotations);
  const { dispatch } = source;
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
        const action = typeof input === "object" && input !== null && "action" in input ? input.action : undefined;
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

const whole = (tool: Source): ManifestTool => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  dispatch: tool.dispatch,
});

// The per-tool input unions are validated by the Blueticks API; the guard only
// confirms the action is one the tool declares (checked in `toSource`).
const trustApi = <I extends { action: string }>(_input: { action: string }): _input is I => true;

export function buildToolList(): ManifestTool[] {
  return [
    ...splitTool(toSource(scheduledMessagesTool, trustApi)),
    ...splitTool(toSource(chatsTool, trustApi)),
    whole(toSource(contactsTool, trustApi)),
    whole(toSource(groupsTool, trustApi)),
    whole(toSource(audiencesTool, trustApi)),
    whole(toSource(campaignsTool, trustApi)),
    whole(toSource(webhooksTool, trustApi)),
    whole(toSource(engineTool, trustApi)),
    whole(toSource(utilsTool, trustApi)),
  ];
}

export function findTool(name: string): ManifestTool | undefined {
  return buildToolList().find((t) => t.name === name);
}

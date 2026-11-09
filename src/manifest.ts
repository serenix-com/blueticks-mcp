// The tool list this stdio server advertises: the hosted server's default
// manifest (api.blueticks.co/mcp, backend src/mcp/tools/client-manifests.ts) as
// an API-key connection sees it, with the same names, titles, hints, listed
// descriptions and server instructions. The descriptions and instructions are
// vendored from the backend (tool-defs/hosted/default-descriptions.ts).
//
// `chats` and `scheduled_messages` mix reads and writes, so each is listed as a
// read-only half (`<name>_read`) and a write half (`<name>_write`). An action
// belongs to the read half when its tool-def annotation is `readOnlyHint: true`,
// the rule hosted uses for both the split and its OAuth write-gate.
//
// Not listed: `agents` and `agent_schedules` (hosted lists them only behind the
// Claude-agents feature gate, and /v1 has no route for them yet), and the
// agent-session tools (calendar, followups, images, ...), which an API-key
// connection never sees on hosted either.
import {
  audiencesTool,
  campaignsTool,
  chatsTool,
  contactsTool,
  engineTool,
  groupsTool,
  scheduledMessagesTool,
  tasksTool,
  utilsTool,
  webhooksTool,
  type BlueticksSurface,
  type ToolResult,
} from "./tool-defs";
import {
  buildDefaultServerInstructions,
  DEFAULT_TOOL_DESCRIPTIONS,
  SPLIT_TOOL_DESCRIPTIONS,
  type DefaultToolKey,
  type SplitToolKey,
  type UnsplitToolKey,
} from "./tool-defs/hosted/default-descriptions";
import { MCP_TOOL_NAMES } from "./tool-defs/hosted/tool-names";

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
  inputSchema: SourceTool["inputSchema"];
  annotations: SourceTool["annotations"];
  dispatch(input: unknown, client: BlueticksSurface): Promise<ToolResult>;
}

function hasAction(input: unknown, actions: ReadonlySet<string>): input is { action: string } {
  if (typeof input !== "object" || input === null || !("action" in input)) return false;
  return typeof input.action === "string" && actions.has(input.action);
}

function errorResult(body: Record<string, string>): ToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

// The per-tool input unions are validated by each tool's own zod schema and by
// the API; this guard only confirms the action is one the tool declares.
const trustApi = <I extends { action: string }>(_input: { action: string }): _input is I => true;

/** Erase a tool's own input type; unknown actions are rejected before dispatch. */
function toSource<I extends { action: string }>(tool: SourceTool<I>): Source {
  const actions = new Set(Object.keys(tool.annotations));
  return {
    name: tool.name,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    dispatch(input, client) {
      if (!hasAction(input, actions) || !trustApi<I>(input)) {
        return Promise.resolve(errorResult({ error: "invalid_input" }));
      }
      return tool.dispatch(input, client);
    },
  };
}

const HALF_HINTS: Readonly<Record<ToolHalf, ToolHints>> = {
  read: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  write: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
};

function splitTool(internal: SplitToolKey, source: Source, titles: Readonly<Record<ToolHalf, string>>): ManifestTool[] {
  const all = Object.keys(source.annotations);
  const isRead = (a: string): boolean => source.annotations[a]?.readOnlyHint === true;
  const actions: Record<ToolHalf, string[]> = {
    read: all.filter(isRead),
    write: all.filter((a) => !isRead(a)),
  };
  const base = MCP_TOOL_NAMES[internal];

  return (["read", "write"] as const).map((half): ManifestTool => {
    const name = `${base}_${half}`;
    const sibling = `${base}_${half === "read" ? "write" : "read"}`;
    const own = new Set(actions[half]);
    return {
      name,
      description: SPLIT_TOOL_DESCRIPTIONS[internal][half],
      inputSchema: {
        ...source.inputSchema,
        properties: { ...source.inputSchema.properties, action: { type: "string", enum: actions[half] } },
      },
      annotations: { title: titles[half], ...HALF_HINTS[half] },
      dispatch(input, client) {
        const action = typeof input === "object" && input !== null && "action" in input ? input.action : undefined;
        if (typeof action !== "string" || !own.has(action)) {
          const where = typeof action === "string" && all.includes(action) ? ` Use '${sibling}' for '${action}'.` : "";
          return Promise.resolve(
            errorResult({
              error: "action_not_available",
              error_description: `'${name}' accepts these actions: ${actions[half].join(", ")}.${where}`,
            }),
          );
        }
        return source.dispatch(input, client);
      },
    };
  });
}

function wholeTool(internal: UnsplitToolKey, source: Source, annotations: ToolHints): ManifestTool {
  return {
    name: MCP_TOOL_NAMES[internal],
    description: DEFAULT_TOOL_DESCRIPTIONS[internal],
    inputSchema: source.inputSchema,
    annotations,
    dispatch: source.dispatch,
  };
}

const DEFAULT_TOOL_KEYS: readonly DefaultToolKey[] = [
  "audiences", "campaigns", "chats", "contacts", "engine", "groups", "scheduledMessages", "tasks", "utils", "webhooks",
];

const chats = toSource(chatsTool);
const scheduledMessages = toSource(scheduledMessagesTool);

// Titles and hints copied from hosted DEFAULT_TOOLS, in its order.
const TOOLS: readonly ManifestTool[] = [
  wholeTool("audiences", toSource(audiencesTool), { title: "WhatsApp audiences", readOnlyHint: false, destructiveHint: true, openWorldHint: false }),
  wholeTool("campaigns", toSource(campaignsTool), { title: "WhatsApp campaigns", readOnlyHint: false, destructiveHint: true, openWorldHint: false }),
  wholeTool("contacts", toSource(contactsTool), { title: "WhatsApp contacts", readOnlyHint: true, destructiveHint: false, openWorldHint: false }),
  wholeTool("engine", toSource(engineTool), { title: "WhatsApp engine controls", readOnlyHint: false, destructiveHint: true, openWorldHint: false }),
  wholeTool("groups", toSource(groupsTool), { title: "WhatsApp groups", readOnlyHint: false, destructiveHint: true, openWorldHint: false }),
  wholeTool("tasks", toSource(tasksTool), { title: "Tasks on the user’s Blueticks boards", readOnlyHint: false, destructiveHint: false, openWorldHint: false }),
  wholeTool("utils", toSource(utilsTool), { title: "WhatsApp utilities (date/time, validate phone, link preview)", readOnlyHint: true, destructiveHint: false, openWorldHint: false }),
  wholeTool("webhooks", toSource(webhooksTool), { title: "WhatsApp webhooks", readOnlyHint: false, destructiveHint: true, openWorldHint: false }),
  ...splitTool("chats", chats, { read: "Read WhatsApp chats and messages", write: "Send WhatsApp messages and act on chats" }),
  ...splitTool("scheduledMessages", scheduledMessages, {
    read: "Read scheduled WhatsApp messages and delivery status",
    write: "Send, schedule, edit or cancel WhatsApp messages",
  }),
];

/**
 * Names accepted on call but never listed. 1.2.x listed the mixed `chats` and
 * `scheduled_messages`; a client with a cached tool list keeps every action it
 * was shown (hosted keeps the same two aliases).
 */
const ALIASES: ReadonlyMap<string, Source> = new Map([
  [MCP_TOOL_NAMES.chats, chats],
  [MCP_TOOL_NAMES.scheduledMessages, scheduledMessages],
]);

export function buildToolList(): readonly ManifestTool[] {
  return TOOLS;
}

export function findTool(name: string): Pick<ManifestTool, "dispatch"> | undefined {
  return TOOLS.find((t) => t.name === name) ?? ALIASES.get(name);
}

/** The server `instructions`: hosted's summary, untrusted-content notice and per-tool guidance. */
export function buildServerInstructions(): string {
  const internalByName = new Map<string, DefaultToolKey>();
  for (const key of DEFAULT_TOOL_KEYS) {
    const name = MCP_TOOL_NAMES[key];
    for (const listed of [name, `${name}_read`, `${name}_write`]) internalByName.set(listed, key);
  }
  return buildDefaultServerInstructions(
    TOOLS.flatMap((t) => {
      const internal = internalByName.get(t.name);
      return internal ? [{ internal, mcpName: t.name }] : [];
    }),
  );
}

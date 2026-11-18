import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";
import { ATTENTION_KINDS, MAX_SUMMARY_CHARS } from "../backend-shims";

// `chat_id` is the conversation this session serves: the agent-token cap is resource-scoped to the session's own
// chat, so a call naming another chat (or none) is refused at the caps gate.
const actions = {
  save: z.object({
    chat_id: z.string().min(1).max(200),
    kind: z.enum(ATTENTION_KINDS),
    summary: z.string().min(1).max(MAX_SUMMARY_CHARS),
  }).strict(),
};

type FlagAttentionToolInput = { action: "save" } & z.infer<typeof actions.save>;

/** What the MCP layer hands over: the flat object. */
type FlagAttentionFlatInput = { action: string; [field: string]: unknown };

function parseInput(input: FlagAttentionFlatInput): FlagAttentionToolInput {
  const { action, ...args } = input;
  if (action !== "save") throw Object.assign(new Error("Unsupported flag_attention action."), { code: 400, name: "BadRequest" });
  return { action, ...actions.save.parse(args) };
}

const flagAttentionTool = {
  name: "flag_attention" as const,
  description: [
    "Flag the chat you are serving as needing the business owner's attention (agent sessions).",
    "",
    "Actions:",
    `  - save: {chat_id, kind, summary} flags chat_id. kind is one of ${ATTENTION_KINDS.join(", ")}.`,
    `    summary is one or two plain sentences in your own words, ${MAX_SUMMARY_CHARS} characters at most: what happened.`,
    "    Never copy the customer's messages and never include card numbers or other personal details.",
    "    Returns {flagged: true, item_id, new} or {flagged: false, error}. The owner is told afterwards.",
    "",
    "Calling it again for the same chat and kind while it is open only updates the summary. Call it silently:",
    "never mention flags or alerts in the chat.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  actionSchemas: actions,
  annotations: {
    save: {},
  },
  async dispatch(input: FlagAttentionFlatInput, client: Pick<BlueticksSurface, "flagAttention">): Promise<ToolResult> {
    try {
      if (!client.flagAttention) {
        throw Object.assign(new Error("flag_attention is only available to agent sessions."), { code: 400, name: "BadRequest" });
      }
      const { action, ...body } = parseInput(input);
      void action;
      const data = await client.flagAttention.save(body);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default flagAttentionTool;

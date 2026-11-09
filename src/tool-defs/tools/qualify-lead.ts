import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";
import { LEAD_STAGES, MAX_FIELD_NAME_CHARS, MAX_FIELD_VALUE_CHARS, MAX_LEAD_FIELDS } from "../backend-shims";

// `chat_id` is the conversation this session serves: the agent-token cap is resource-scoped to the session's own
// chat, so a call naming another chat (or none) is refused at the caps gate.
const actions = {
  save: z.object({
    chat_id: z.string().min(1).max(200),
    stage: z.enum(LEAD_STAGES),
    fields: z
      .record(z.string().min(1).max(MAX_FIELD_NAME_CHARS), z.string().max(MAX_FIELD_VALUE_CHARS))
      .refine((f) => Object.keys(f).length <= MAX_LEAD_FIELDS, { message: `at most ${MAX_LEAD_FIELDS} fields` })
      .optional(),
  }).strict(),
};

type QualifyLeadToolInput = { action: "save" } & z.infer<typeof actions.save>;

/** What the MCP layer hands over: the flat object. */
type QualifyLeadFlatInput = { action: string; [field: string]: unknown };

function parseInput(input: QualifyLeadFlatInput): QualifyLeadToolInput {
  const { action, ...args } = input;
  if (action !== "save") throw Object.assign(new Error("Unsupported qualify_lead action."), { code: 400, name: "BadRequest" });
  return { action, ...actions.save.parse(args) };
}

const qualifyLeadTool = {
  name: "qualify_lead" as const,
  description: [
    "Record the chat you are serving as a sales lead for the business owner (agent sessions).",
    "",
    "Actions:",
    `  - save: {chat_id, stage, fields?} saves the lead of chat_id. stage is one of ${LEAD_STAGES.join(", ")}.`,
    "    fields is {name: value} using ONLY the field names your instructions list (any other name is dropped);",
    `    at most ${MAX_LEAD_FIELDS}, each value ${MAX_FIELD_VALUE_CHARS} characters at most. Returns {saved: true, lead_id, stage, score}`,
    "    or {saved: false, error}. The lead is scored for the owner afterwards; you do not get the score.",
    "",
    "Call it again when the stage or a field changes (it updates the same lead). Never record a support request,",
    "spam or a personal chat. Call it silently: never mention leads, stages or scores in the chat.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  actionSchemas: actions,
  annotations: {
    save: {},
  },
  async dispatch(input: QualifyLeadFlatInput, client: Pick<BlueticksSurface, "qualifyLead">): Promise<ToolResult> {
    try {
      if (!client.qualifyLead) {
        throw Object.assign(new Error("qualify_lead is only available to agent sessions."), { code: 400, name: "BadRequest" });
      }
      const { action, ...body } = parseInput(input);
      void action;
      const data = await client.qualifyLead.save(body);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default qualifyLeadTool;

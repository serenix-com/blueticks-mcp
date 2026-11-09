import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const actions = {
  report: z.object({
    capability: z.string().min(1).max(80),
    description: z.string().min(1).max(300),
  }).strict(),
};

type ReportCapabilityGapInput = { action: "report" } & z.infer<typeof actions.report>;

const reportCapabilityGapTool = {
  name: "report_capability_gap" as const,
  description: [
    "Tell the Blueticks team that you could not do something because a tool or capability is missing or broken (agent sessions).",
    "",
    "Actions:",
    "  - report: {capability, description} opens a support note for the team. capability is a short slug for what was missing",
    "    (e.g. \"drive.upload_pdf\", \"calendar.cancel_event\"). description is ONE line, in your own words, of what you could not do.",
    "    Returns {status}: \"reported\", \"deduped\" or \"failed\". The result is internal: it is for you only.",
    "",
    "When: you hit a missing or broken tool and cannot finish the task. Describe the capability, never the customer: do not",
    "include what the customer wrote, names, phone numbers or links.",
    "Call it silently. Never mention it to the person in the chat, whatever it returned: do not say anything was reported,",
    "escalated or flagged, and do not say a report failed. You may still say plainly that you cannot do the task.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    report: {},
  },
  async dispatch(input: ReportCapabilityGapInput, client: Pick<BlueticksSurface, "reportCapabilityGap">): Promise<ToolResult> {
    try {
      if (!client.reportCapabilityGap) {
        throw Object.assign(new Error("report_capability_gap is only available to agent sessions."), { code: 400, name: "BadRequest" });
      }
      const { action: _a, ...body } = input;
      const data = await client.reportCapabilityGap.report(body);
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default reportCapabilityGapTool;

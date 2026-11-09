import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const Recurrence = z
  .object({
    freq: z.enum(["hourly", "daily", "weekly", "monthly"]),
    hour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .describe("Wall-clock hour 0-23 in `timezone`. For hourly this is the ANCHOR the interval counts from."),
    minute: z.number().int().min(0).max(59),
    interval: z
      .number()
      .int()
      .min(1)
      .max(24)
      .optional()
      .describe("hourly only: fire every N hours (default 1). Use ONE hourly row, never one row per hour."),
    weekdays: z.array(z.number().int().min(0).max(6)).optional().describe("weekly only: 0=Sun … 6=Sat."),
    monthday: z.number().int().min(1).max(31).optional().describe("monthly only: day of month."),
    timezone: z.string().min(1).optional().describe("IANA timezone. Omit it: the user's own timezone (their workspace's) is applied. Set it ONLY when the user names a different place/zone."),
  })
  .strict();

const SetArgs = z
  .object({
    agent_id: z.string().min(1).describe("The agent this schedule fires (from agents.create)."),
    client_id: z.string().min(1),
    prompt: z.string().min(1).describe("What the agent should do when it fires, e.g. 'summarize today's conversation and send the summary'."),
    source_chat_id: z.string().min(1).describe("The chat the run reads/acts on (its session context)."),
    dest_chat_id: z.string().optional().describe("Where to send the result. Omit to reply in the source chat."),
    recurrence: Recurrence,
    label: z.string().optional(),
  })
  .strict();

const ListArgs = z.object({ agent_id: z.string().optional() }).strict();

const actions = { set: SetArgs, list: ListArgs };

type ScheduleInput =
  | ({ action: "set" } & z.infer<typeof SetArgs>)
  | ({ action: "list" } & z.infer<typeof ListArgs>);

const agentSchedulesTool = {
  name: "agent_schedules" as const,
  description: [
    "Give a Bridge agent a recurring time trigger (a morning/evening summary, a daily report, etc.).",
    "Actions:",
    "  - set: create a schedule for an agent. Provide the recurrence (daily/weekly/monthly + hour:minute + timezone),",
    "         the source_chat_id (what to read), an optional dest_chat_id (where to send), and the prompt.",
    "         If the user didn't give exact times, ask — or state clearly the times + timezone you chose.",
    "  - list: list an agent's schedules.",
    "The scheduler fires the SAME agent through the shared Bridge/Claude-Code infra; the agent must already be allowed",
    "to read the source chat (read_message_chat_ids) or the run cannot read it.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    set: { readOnlyHint: false },
    list: { readOnlyHint: true },
  },
  async dispatch(input: ScheduleInput, client: BlueticksSurface): Promise<ToolResult> {
    if (!client.agentSchedules) {
      return toolErrorResult(new Error("Agent scheduling is not available on this connection."));
    }
    try {
      switch (input.action) {
        case "set": {
          const data = await client.agentSchedules.set({
            agent_id: input.agent_id,
            client_id: input.client_id,
            prompt: input.prompt,
            source_chat_id: input.source_chat_id,
            dest_chat_id: input.dest_chat_id,
            recurrence: input.recurrence,
            label: input.label,
          });
          return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
        }
        case "list": {
          const data = await client.agentSchedules.list(input.agent_id);
          return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
        }
        default:
          return toolErrorResult(new Error(`Unknown action: ${String((input as { action?: string }).action)}`));
      }
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default agentSchedulesTool;

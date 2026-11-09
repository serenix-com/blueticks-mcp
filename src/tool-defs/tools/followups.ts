import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

// Every action names the chat (`chat_id`, the conversation this session serves): the agent-token caps are
// resource-scoped to the session's own chat, and a call without a chat id would be refused at the caps gate.
// There is deliberately NO recipient field: "chat" goes to that customer, "owner" to the owner's operator chat.
const ChatId = z.string().min(1).max(200);

const actions = {
  schedule: z.object({
    chat_id: ChatId,
    target: z.enum(["chat", "owner"]),
    text: z.string().min(1).max(1000),
    send_at: z.string().max(40).optional(),
    in_minutes: z.number().int().min(1).max(43200).optional(),
    keep_on_reply: z.boolean().optional(),
    calendar_event_id: z.string().min(1).max(200).optional(),
    calendar_id: z.string().min(1).max(200).optional(),
  }).strict(),
  list: z.object({
    chat_id: ChatId,
  }).strict(),
  cancel: z.object({
    chat_id: ChatId,
    followup_id: z.string().regex(/^[0-9a-f]{24}$/),
  }).strict(),
};

type FollowupsInput =
  | ({ action: "schedule" } & z.infer<typeof actions.schedule>)
  | ({ action: "list" } & z.infer<typeof actions.list>)
  | ({ action: "cancel" } & z.infer<typeof actions.cancel>);

/** What the MCP layer hands over: the flat object (every per-action field optional). */
type FollowupsFlatInput = { action: string; [field: string]: unknown };

function parseInput(input: FollowupsFlatInput): FollowupsInput {
  const { action, ...args } = input;
  switch (action) {
    case "schedule": return { action, ...actions.schedule.parse(args) };
    case "list": return { action, ...actions.list.parse(args) };
    case "cancel": return { action, ...actions.cancel.parse(args) };
    default: throw Object.assign(new Error("Unsupported followups action."), { code: 400, name: "BadRequest" });
  }
}

const followupsTool = {
  name: "followups" as const,
  description: [
    "Schedule a follow-up for the conversation you are in: ONE message, sent later (agent sessions).",
    "",
    "Actions:",
    "  - schedule: {chat_id, target, text, in_minutes | send_at} schedules the message. target \"chat\" sends `text` to the customer",
    "    of chat_id at that time; target \"owner\" sends `text` as a reminder to the owner's own operator chat (an internal",
    "    note: say who the customer is and what to do). Give exactly one of in_minutes (whole minutes from now, 1 to 43200) or",
    "    send_at (ISO 8601 date-time WITH an offset, e.g. 2026-11-06T09:00:00+02:00; within 30 days).",
    "    Optional keep_on_reply: true keeps it even if the customer writes before it is sent (for a reminder; default false).",
    "    Optional calendar_event_id (+ calendar_id, default the primary calendar): the Google Calendar event this follow-up is for;",
    "    if that event no longer exists when the time comes, the follow-up is dropped instead of sent.",
    "    Returns {scheduled: true, id, send_at, target} or {scheduled: false, error}. At most 5 pending per chat.",
    "  - list: {chat_id} returns the pending follow-ups of this chat: {followups: [{id, target, send_at, text}]}.",
    "  - cancel: {chat_id, followup_id} cancels one pending follow-up of this chat. Returns {cancelled: true} or {cancelled: false, error}.",
    "",
    "Unless keep_on_reply is true, a follow-up is cancelled by itself when the customer writes in the chat before it is sent, so schedule it as a",
    "\"if they have not answered by then\" nudge. The text goes out exactly as you wrote it: write the finished message, in the",
    "customer's language. Use list before scheduling another one, and cancel one that is no longer wanted.",
    "Only schedule a follow-up the customer agreed to or that your instructions tell you to send.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  actionSchemas: actions,
  annotations: {
    schedule: {},
    list: { readOnlyHint: true },
    cancel: {},
  },
  async dispatch(input: FollowupsFlatInput, client: Pick<BlueticksSurface, "followups">): Promise<ToolResult> {
    try {
      if (!client.followups) {
        throw Object.assign(new Error("followups is only available to agent sessions."), { code: 400, name: "BadRequest" });
      }
      const parsed = parseInput(input);
      let data: unknown;
      switch (parsed.action) {
        case "schedule": {
          const { action, ...body } = parsed;
          void action;
          data = await client.followups.schedule(body);
          break;
        }
        case "list": {
          const { action, ...body } = parsed;
          void action;
          data = await client.followups.list(body);
          break;
        }
        case "cancel": {
          const { action, ...body } = parsed;
          void action;
          data = await client.followups.cancel(body);
          break;
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default followupsTool;

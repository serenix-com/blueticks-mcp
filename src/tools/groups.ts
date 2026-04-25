import { z } from "zod";
import type { Blueticks } from "blueticks";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

// NOTE: `list` action is omitted — the Blueticks Node SDK's GroupsResource
// does not expose a `list` method (only `get`, `create`, `update`).

const GroupId = z.string().min(3);

const GetArgs = z.object({ group_id: GroupId }).strict();
const CreateArgs = z
  .object({ name: z.string().min(1), participants: z.array(z.string().min(3)).min(1) })
  .strict();
const UpdateArgs = z
  .object({
    group_id: GroupId,
    name: z.string().min(1).optional(),
    settings: z
      .object({ announce: z.boolean().optional(), restrict: z.boolean().optional() })
      .optional(),
  })
  .strict();

const actions = { get: GetArgs, create: CreateArgs, update: UpdateArgs };

type GroupsInput =
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "create" } & z.infer<typeof CreateArgs>)
  | ({ action: "update" } & z.infer<typeof UpdateArgs>);

/** Strip keys whose value is undefined so SDK param objects stay clean. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;
}

const groupsTool = {
  name: "whatsapp_groups" as const,
  description: [
    "Create and manage WhatsApp groups via the connected engine.",
    "Available actions:",
    "  - get: retrieve a group by group_id (e.g. 972...-1597620113@g.us)",
    "  - create: create a new group with a name and a list of participant phone numbers",
    "  - update: rename a group or change its admin/messaging settings",
    "",
    "Notes:",
    "  - Newly-created groups default to admins-only-post (announce=true) and admins-only-edit (restrict=true) — that's WAWeb's default. To open posting/editing to all members, follow create with `update settings={announce:false, restrict:false}`.",
    "  - participant_count includes the creator/owner. Inviting your own phone number deduplicates into the owner slot rather than adding a separate participant.",
    "",
    "Examples:",
    "  - get: 'fetch group 972...-1597620113@g.us'",
    "  - create: 'create a group called Crew with +972544325389 and +1234567890'",
    "  - update: 'rename group g@g.us to Sales Team'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: { get: { readOnlyHint: true }, create: {}, update: {} },
  async dispatch(input: GroupsInput, client: Blueticks): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "get":
          data = await client.groups.get(input.group_id);
          break;
        case "create": {
          const { action: _action, ...body } = input;
          data = await client.groups.create(body);
          break;
        }
        case "update": {
          const { action: _action, group_id, ...body } = input;
          data = await client.groups.update(group_id, compact(body));
          break;
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default groupsTool;

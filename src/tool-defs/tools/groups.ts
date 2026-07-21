import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const GroupId = z.string().min(3);

const ListArgs = z
  .object({
    query: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).optional(),
  })
  .strict();
const GetArgs = z
  .object({
    group_id: GroupId,
    // When true, the returned group carries `participants[]` inline —
    // a single round-trip instead of a follow-up participants call.
    // Native in the 2.0 SDK via `get(groupId, { include: 'participants' })`.
    include_participants: z.boolean().optional(),
  })
  .strict();
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

const LeaveArgs = z.object({ group_id: GroupId }).strict();

const actions = {
  list: ListArgs,
  get: GetArgs,
  create: CreateArgs,
  update: UpdateArgs,
  leave: LeaveArgs,
};

type GroupsInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "create" } & z.infer<typeof CreateArgs>)
  | ({ action: "update" } & z.infer<typeof UpdateArgs>)
  | ({ action: "leave" } & z.infer<typeof LeaveArgs>);

/** Strip keys whose value is undefined so SDK param objects stay clean. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

const groupsTool = {
  name: "groups" as const,
  description: [
    "Create and manage WhatsApp groups via the connected engine.",
    "Available actions:",
    "  - list: list groups the engine sees (offset pagination; optional name query)",
    "  - get: retrieve a group by group_id (e.g. 972...-1597620113@g.us); set include_participants for the member list inline",
    "  - create: create a new group with a name and a list of participant phone numbers",
    "  - update: rename a group or change its admin/messaging settings",
    "  - leave: cancel the authenticated user's membership. NOTE: WhatsApp has no \"destroy group\" — the group continues for any remaining members; only your membership ends.",
    "",
    "Notes:",
    "  - Newly-created groups default to admins-only-post (announce=true) and admins-only-edit (restrict=true) — that's WAWeb's default. To open posting/editing to all members, follow create with `update settings={announce:false, restrict:false}`.",
    "  - participant_count includes the creator/owner. Inviting your own phone number deduplicates into the owner slot rather than adding a separate participant.",
    "  - `create` always returns participants[] inline so you can confirm membership immediately.",
    "",
    "Examples:",
    "  - list: 'show me my groups'",
    "  - get: 'fetch group 972...-1597620113@g.us'",
    "  - create: 'create a group called Crew with +972544325389 and +1234567890'",
    "  - update: 'rename group g@g.us to Sales Team'",
    "  - leave: 'leave group g@g.us'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    list: { readOnlyHint: true },
    get: { readOnlyHint: true },
    create: {},
    update: {},
    leave: { destructiveHint: true },
  },
  async dispatch(input: GroupsInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "list": {
          // MCP `query` → SDK `searchToken`.
          const { query, limit, skip } = input;
          data = await client.groups.list(compact({ searchToken: query, limit, skip }));
          break;
        }
        case "get":
          // The 2.0 SDK serves participants inline via the `include` flag —
          // no need to chain a separate participants call anymore.
          data = await client.groups.get(
            input.group_id,
            input.include_participants ? { include: "participants" } : undefined,
          );
          break;
        case "create":
          data = await client.groups.create({
            name: input.name,
            participants: input.participants,
          });
          break;
        case "update":
          data = await client.groups.update(
            input.group_id,
            compact({ name: input.name, settings: input.settings }),
          );
          break;
        case "leave":
          data = await client.groups.leave(input.group_id);
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default groupsTool;

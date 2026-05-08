import { z } from "zod";
import type { BlueticksSurface } from "../blueticks-surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

// NOTE: `list` action is omitted — the Blueticks Node SDK's GroupsResource
// does not expose a `list` method (only `get`, `create`, `update`).

const GroupId = z.string().min(3);

const GetArgs = z
  .object({
    group_id: GroupId,
    // When true, the returned group carries `participants[]` inline —
    // a single round-trip instead of a follow-up wa_get_chat_participants
    // call. Default false.
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

const actions = { get: GetArgs, create: CreateArgs, update: UpdateArgs, leave: LeaveArgs };

type GroupsInput =
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
  name: "whatsapp_groups" as const,
  description: [
    "Create and manage WhatsApp groups via the connected engine.",
    "Available actions:",
    "  - get: retrieve a group by group_id (e.g. 972...-1597620113@g.us)",
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
    "  - get: 'fetch group 972...-1597620113@g.us'",
    "  - create: 'create a group called Crew with +972544325389 and +1234567890'",
    "  - update: 'rename group g@g.us to Sales Team'",
    "  - leave: 'leave group g@g.us'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    get: { readOnlyHint: true },
    create: {},
    update: {},
    leave: { destructiveHint: true },
  },
  async dispatch(input: GroupsInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "get":
          // Single-round-trip variant (`include: ['participants']`) isn't
          // exposed by the blueticks SDK yet (v3.4.x). Emulate it by
          // chaining a chats.listParticipants call and merging the
          // results — keeps the public MCP shape (`group + participants`)
          // stable while we wait for the SDK to add the include flag.
          if (input.include_participants) {
            const [group, participants] = await Promise.all([
              client.groups.get(input.group_id),
              client.chats.listParticipants(input.group_id),
            ]);
            data = { ...(group as Record<string, unknown>), participants };
          } else {
            data = await client.groups.get(input.group_id);
          }
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

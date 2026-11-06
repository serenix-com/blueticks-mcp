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

const GetPictureArgs = z.object({ group_id: GroupId }).strict();
const RemovePictureArgs = z.object({ group_id: GroupId }).strict();
// set_picture: exactly one image source — an https url, or base64 bytes (bare, or a data: URL).
const SetPictureArgs = z
  .object({
    group_id: GroupId,
    picture_url: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), "picture_url must use https://")
      .optional(),
    picture_base64: z.string().min(1).optional(),
    // Content-type for a BARE base64 string (a data: URL carries its own). Defaults to image/jpeg.
    picture_mime_type: z.string().max(127).optional(),
  })
  .strict()
  .refine((v) => (v.picture_url !== undefined) !== (v.picture_base64 !== undefined), {
    message: "set_picture needs exactly one of picture_url or picture_base64",
  });

const actions = {
  list: ListArgs,
  get: GetArgs,
  create: CreateArgs,
  update: UpdateArgs,
  leave: LeaveArgs,
  get_picture: GetPictureArgs,
  set_picture: SetPictureArgs,
  remove_picture: RemovePictureArgs,
};

type GroupsInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "create" } & z.infer<typeof CreateArgs>)
  | ({ action: "update" } & z.infer<typeof UpdateArgs>)
  | ({ action: "leave" } & z.infer<typeof LeaveArgs>)
  | ({ action: "get_picture" } & z.infer<typeof GetPictureArgs>)
  | ({ action: "set_picture" } & z.infer<typeof SetPictureArgs>)
  | ({ action: "remove_picture" } & z.infer<typeof RemovePictureArgs>);

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
    "  - get_picture: the group's current picture as a short-lived WhatsApp image url (`url` is null when the group has none)",
    "  - set_picture: set the group picture from `picture_url` (https) or `picture_base64` (bare base64 with optional `picture_mime_type`, or a data: URL). Only group admins can when the group is admins-only-edit (the default for new groups); otherwise 403 not_authorized.",
    "  - remove_picture: remove the group picture. Baileys (gateway) engine only; the Chrome extension cannot remove a picture (501 unsupported_command). Same admin rule as set_picture.",
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
    get_picture: { readOnlyHint: true },
    set_picture: {},
    remove_picture: { destructiveHint: true },
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
        case "get_picture":
          data = await client.groups.getPicture(input.group_id);
          break;
        case "set_picture": {
          const { picture_url, picture_base64, picture_mime_type } = input;
          if (picture_url) {
            data = await client.groups.setPicture(input.group_id, { url: picture_url });
          } else {
            const b64 = picture_base64 as string;
            const isDataUrl = b64.startsWith("data:");
            const mime = picture_mime_type ?? (isDataUrl ? undefined : "image/jpeg");
            data = await client.groups.setPicture(
              input.group_id,
              compact({
                fileDataUrl: isDataUrl ? b64 : `data:${mime};base64,${b64}`,
                fileMimeType: picture_mime_type,
              }),
            );
          }
          break;
        }
        case "remove_picture":
          data = await client.groups.removePicture(input.group_id);
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default groupsTool;

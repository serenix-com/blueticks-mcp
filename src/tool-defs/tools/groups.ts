import { z } from "zod";
import type { BlueticksSurface } from "../surface";
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
// BE#600 — models often pass one number (or a comma-separated list) as a bare string;
// accept it and normalise to the array every layer below expects.
export function normalizeParticipants(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
}

const CreateArgs = z
  .object({ name: z.string().min(1), participants: z.array(z.string().min(3)).min(1) })
  .strict();
const UpdateArgs = z
  .object({
    group_id: GroupId,
    name: z.string().min(1).optional(),
    settings: z
      .object({
        announce: z.boolean().optional(),
        restrict: z.boolean().optional(),
        // Group description (the "about" text). REST already supported it; the MCP
        // schema silently stripped it, so an update reported success and changed nothing.
        description: z.string().min(1).max(2048).optional(),
      })
      // strict: an unknown key must fail loudly, not be dropped while the call "succeeds".
      .strict()
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
    picture_url: z.string().url().refine((u) => u.startsWith("https://"), "picture_url must use https://").optional(),
    picture_base64: z.string().min(1).optional(),
    // Content-type for a BARE base64 string (a data: URL carries its own). Defaults to image/jpeg.
    picture_mime_type: z.string().max(127).optional(),
  })
  .strict()
  .refine((v) => (v.picture_url !== undefined) !== (v.picture_base64 !== undefined), {
    message: "set_picture needs exactly one of picture_url or picture_base64",
  });

const actions = {
  get: GetArgs,
  create: CreateArgs,
  update: UpdateArgs,
  leave: LeaveArgs,
  get_picture: GetPictureArgs,
  set_picture: SetPictureArgs,
  remove_picture: RemovePictureArgs,
};

type GroupsInput =
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "create" } & z.infer<typeof CreateArgs>)
  | ({ action: "update" } & z.infer<typeof UpdateArgs>)
  | ({ action: "leave" } & z.infer<typeof LeaveArgs>)
  | ({ action: "get_picture" } & z.infer<typeof GetPictureArgs>)
  | ({ action: "set_picture" } & z.infer<typeof SetPictureArgs>)
  | ({ action: "remove_picture" } & z.infer<typeof RemovePictureArgs>);

/**
 * What dispatch can actually receive. The shared OAuth-MCP path validates with the FLAT schema, where
 * `group_id` is optional for every action, so an id-bearing action can arrive without one even though
 * the strict `GroupsInput` says it cannot.
 */
export type GroupsDispatchInput = GroupsInput | { action: "get" | "update" | "leave"; group_id?: string };

/** Just the client surface this tool uses, so a fake can be built to the real method signatures. */
export type GroupsToolClient = {
  groups: BlueticksSurface["groups"];
  chats: Pick<BlueticksSurface["chats"], "listParticipants">;
};

/** Type guard: an id-bearing action must carry a well-formed group_id; any other action passes. */
function hasValidGroupId(input: GroupsDispatchInput): input is GroupsInput {
  if (input.action === "get" || input.action === "update" || input.action === "leave") {
    return GroupId.safeParse(input.group_id).success;
  }
  return true;
}

/** Strip keys whose value is undefined so SDK param objects stay clean. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** A user-input error ToolResult: a raw throw/ZodError would otherwise surface as internal_error/500. */
function badRequestResult(message: string, details?: { path: string; code: string }[]): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ status: 400, code: "bad_request", message, ...(details ? { details } : {}) }) }],
  };
}

const groupsTool = {
  name: "groups" as const,
  description: [
    "Create and manage WhatsApp groups via the connected engine.",
    "Available actions:",
    "  - get: retrieve a group by group_id (e.g. 972...-1597620113@g.us)",
    "  - create: create a new group with a name and a list of participant phone numbers (`participants` is required: an array of numbers, or one number as a string)",
    "  - update: rename a group, change its description (settings.description), or its admin/messaging settings",
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
    "  - get: 'fetch group 972...-1597620113@g.us'",
    "  - create: 'create a group called Crew with +972544325389 and +1234567890'",
    "  - update: 'rename group g@g.us to Sales Team'",
    "  - leave: 'leave group g@g.us'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  // Per-action argument schemas (clients that expose one tool per action).
  actionSchemas: actions,
  annotations: {
    get: { readOnlyHint: true },
    create: {},
    update: {},
    leave: { destructiveHint: true },
    get_picture: { readOnlyHint: true },
    set_picture: {},
    remove_picture: { destructiveHint: true },
  },
  parse(input: unknown): GroupsInput {
    const { action, ...args } = z.object({ action: z.string() }).passthrough().parse(input);
    switch (action) {
      case "get": return { action, ...actions.get.parse(args) };
      case "create": return { action, ...actions.create.parse({ ...args, participants: normalizeParticipants(args.participants) }) };
      case "update": return { action, ...actions.update.parse(args) };
      case "leave": return { action, ...actions.leave.parse(args) };
      case "get_picture": return { action, ...actions.get_picture.parse(args) };
      case "set_picture": return { action, ...actions.set_picture.parse(args) };
      case "remove_picture": return { action, ...actions.remove_picture.parse(args) };
      default: throw new Error("Unsupported tool action");
    }
  },
  async dispatch(rawInput: GroupsDispatchInput, client: GroupsToolClient): Promise<ToolResult> {
    try {
      // The shared OAuth-MCP path parses with the FLAT input schema, where `group_id` is
      // optional (it is shared across get/create/update/leave) and dispatch is not re-run
      // through tool.parse(). So an absent/blank group_id used to reach client.groups.*()
      // where the engine layer throws a raw "An id must be provided" → internal_error/500
      // (#1167 RCA-2b). Re-validate it here for the id-bearing actions, returning a clean
      // bad_request without touching the engine — mirroring the create-args guard below.
      if (!hasValidGroupId(rawInput)) {
        return badRequestResult(`groups.${rawInput.action} needs a group_id (the group's @g.us id).`);
      }
      const input = rawInput;
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
          // The shared flat-schema path skips parse(), so re-validate after normalising
          // (non-empty list, each entry >= 3 chars) before touching the engine.
          const createArgs = actions.create.safeParse({
            name: input.name,
            participants: normalizeParticipants(input.participants),
          });
          if (!createArgs.success) {
            // A user-input error, not an internal one: a raw ZodError would surface as internal_error/500.
            return badRequestResult(
              "groups.create needs a name and `participants`: a non-empty list of phone numbers (each at least 3 characters).",
              createArgs.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
            );
          }
          data = await client.groups.create(createArgs.data);
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
          // The flat-schema path skips parse(): re-check there is exactly one source.
          const src = SetPictureArgs.safeParse({
            group_id: input.group_id,
            picture_url: input.picture_url,
            picture_base64: input.picture_base64,
            picture_mime_type: input.picture_mime_type,
          });
          if (!src.success) {
            return {
              isError: true,
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: 400,
                  code: "bad_request",
                  message: "groups.set_picture needs exactly one of `picture_url` (https) or `picture_base64`.",
                }),
              }],
            };
          }
          const { picture_url, picture_base64, picture_mime_type } = src.data;
          if (picture_url) {
            data = await client.groups.setPicture(input.group_id, { url: picture_url });
          } else {
            const b64 = picture_base64 as string;
            const isDataUrl = b64.startsWith("data:");
            const mime = picture_mime_type ?? (isDataUrl ? undefined : "image/jpeg");
            data = await client.groups.setPicture(
              input.group_id,
              compact({ fileDataUrl: isDataUrl ? b64 : `data:${mime};base64,${b64}`, fileMimeType: picture_mime_type }),
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

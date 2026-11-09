import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const ListArgs = z
  .object({
    query: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  })
  .strict();

const GetProfilePicArgs = z.object({ chat_id: z.string().min(3) }).strict();

const actions = { list: ListArgs, get_profile_picture: GetProfilePicArgs };

type ContactsInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "get_profile_picture" } & z.infer<typeof GetProfilePicArgs>);

/** Strip keys whose value is undefined so SDK param objects stay clean. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

const contactsTool = {
  name: "contacts" as const,
  description: [
    "Read WhatsApp contacts known to the connected engine.",
    "Available actions:",
    "  - list: list contacts, optionally filtered by query (cursor pagination)",
    "  - get_profile_picture: fetch a contact's profile picture URL",
    "",
    "Examples:",
    "  - list: 'find contacts named Douglas'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  // Per-action argument schemas (clients that expose one tool per action).
  actionSchemas: actions,
  annotations: { list: { readOnlyHint: true }, get_profile_picture: { readOnlyHint: true } },
  parse(input: unknown): ContactsInput {
    const { action, ...args } = z.object({ action: z.string() }).passthrough().parse(input);
    switch (action) {
      case "list": return { action, ...actions.list.parse(args) };
      case "get_profile_picture": return { action, ...actions.get_profile_picture.parse(args) };
      default: throw new Error("Unsupported tool action");
    }
  },
  async dispatch(input: ContactsInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "list": {
          const { action: _action, ...query } = input;
          data = await client.contacts.list(compact(query));
          break;
        }
        case "get_profile_picture":
          data = await client.contacts.getProfilePicture(input.chat_id);
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default contactsTool;

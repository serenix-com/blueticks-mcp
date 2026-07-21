import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const ListArgs = z
  .object({
    query: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).optional(),
  })
  .strict();

const CommonGroupsArgs = z.object({ chat_id: z.string().min(3) }).strict();

const actions = { list: ListArgs, common_groups: CommonGroupsArgs };

type ContactsInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "common_groups" } & z.infer<typeof CommonGroupsArgs>);

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
    "  - list: list contacts, optionally filtered by query (offset pagination via limit/skip)",
    "  - common_groups: list the groups the connected account shares with a contact",
    "      (WhatsApp's \"groups in common\"). chat_id is the contact JID (e.g. 12345@c.us).",
    "",
    "Examples:",
    "  - list: 'find contacts named Douglas'",
    "  - common_groups: 'what groups do I share with 972544325389@c.us?'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: { list: { readOnlyHint: true }, common_groups: { readOnlyHint: true } },
  async dispatch(input: ContactsInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "list": {
          // MCP exposes `query`; the 2.0 SDK names the substring filter
          // `searchToken`. Translate at the boundary.
          const { query, limit, skip } = input;
          data = await client.contacts.list(compact({ searchToken: query, limit, skip }));
          break;
        }
        case "common_groups":
          data = await client.contacts.listCommonGroups(input.chat_id);
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default contactsTool;

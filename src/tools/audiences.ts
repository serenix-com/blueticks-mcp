import { z } from "zod";
import type { Blueticks } from "blueticks";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const AudienceId = z.string().min(1);
const ContactId = z.string().min(1);
const ContactInput = z
  .object({ to: z.string().min(3), variables: z.record(z.string()).optional() })
  .strict();

const ListArgs = z
  .object({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().optional() })
  .strict();
const CreateArgs = z.object({ name: z.string().min(1) }).strict();
const GetArgs = z.object({ audience_id: AudienceId }).strict();
const UpdateArgs = z
  .object({ audience_id: AudienceId, name: z.string().min(1).optional() })
  .strict();
const DeleteArgs = z.object({ audience_id: AudienceId }).strict();
const AppendArgs = z
  .object({ audience_id: AudienceId, contacts: z.array(ContactInput).min(1) })
  .strict();
const UpdateContactArgs = z
  .object({
    audience_id: AudienceId,
    contact_id: ContactId,
    to: z.string().min(3).optional(),
    variables: z.record(z.string()).optional(),
  })
  .strict();
const RemoveContactArgs = z.object({ audience_id: AudienceId, contact_id: ContactId }).strict();

const actions = {
  list: ListArgs,
  create: CreateArgs,
  get: GetArgs,
  update: UpdateArgs,
  delete: DeleteArgs,
  append_contacts: AppendArgs,
  update_contact: UpdateContactArgs,
  remove_contact: RemoveContactArgs,
};

type AudiencesInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "create" } & z.infer<typeof CreateArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "update" } & z.infer<typeof UpdateArgs>)
  | ({ action: "delete" } & z.infer<typeof DeleteArgs>)
  | ({ action: "append_contacts" } & z.infer<typeof AppendArgs>)
  | ({ action: "update_contact" } & z.infer<typeof UpdateContactArgs>)
  | ({ action: "remove_contact" } & z.infer<typeof RemoveContactArgs>);

/** Strip keys whose value is undefined so SDK param objects stay clean. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

const audiencesTool = {
  name: "whatsapp_audiences" as const,
  description: [
    "Reusable contact lists used as targets for messages and campaigns.",
    "Available actions:",
    "  - list: list audiences",
    "  - create: create a new audience by name",
    "  - get / update / delete: standard CRUD on an audience",
    "  - append_contacts: add contacts (to + optional variables) to an audience",
    "  - update_contact / remove_contact: edit or remove a single contact within an audience",
    "",
    "Phone format: `to` must be +E164 (e.g. +14155551234). JID form (12345@c.us) is rejected here.",
    "Variables: each key on `variables` becomes a `{key}` token usable in campaign templates (case-insensitive).",
    "Custom tokens override built-ins: setting variables.firstName='Doug' makes `{firstName}` resolve to Doug instead of the WA profile name.",
    "Built-ins always available even without variables: whatsappname, displayname, phone, mobile.",
    "",
    "Examples:",
    "  - create: 'create an audience called Leads'",
    "  - append_contacts: 'add +972544325389 to aud_1 with firstName=Doug, product=Premium'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    list: { readOnlyHint: true },
    get: { readOnlyHint: true },
    create: {},
    update: {},
    delete: { destructiveHint: true },
    append_contacts: {},
    update_contact: {},
    remove_contact: { destructiveHint: true },
  },
  async dispatch(input: AudiencesInput, client: Blueticks): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "list": {
          const { action: _action, ...q } = input;
          data = await client.audiences.list(compact(q));
          break;
        }
        case "create":
          data = await client.audiences.create({ name: input.name });
          break;
        case "get":
          data = await client.audiences.get(input.audience_id);
          break;
        case "update": {
          const { audience_id, action: _action, ...body } = input;
          data = await client.audiences.update(audience_id, compact(body) as { name: string });
          break;
        }
        case "delete":
          data = await client.audiences.delete(input.audience_id);
          break;
        case "append_contacts":
          // SDK takes (id, contacts[]) — array passed directly, not wrapped
          data = await client.audiences.appendContacts(input.audience_id, input.contacts);
          break;
        case "update_contact": {
          const { audience_id, contact_id, action: _action, ...body } = input;
          data = await client.audiences.updateContact(audience_id, contact_id, compact(body));
          break;
        }
        case "remove_contact":
          // SDK method is deleteContact
          data = await client.audiences.deleteContact(input.audience_id, input.contact_id);
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default audiencesTool;

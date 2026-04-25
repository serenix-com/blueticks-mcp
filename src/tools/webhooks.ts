import { z } from "zod";
import type { Blueticks } from "blueticks";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const WebhookId = z.string().min(1);
const Event = z
  .enum([
    "message.queued",
    "message.sending",
    "message.sent",
    "message.delivered",
    "message.read",
    "message.failed",
    "session.connected",
    "session.disconnected",
    "campaign.started",
    "campaign.paused",
    "campaign.resumed",
    "campaign.completed",
    "campaign.aborted",
  ])
  .or(z.string().min(1));

const ListArgs = z
  .object({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().optional() })
  .strict();
const CreateArgs = z
  .object({ url: z.string().url(), events: z.array(Event).min(1) })
  .strict();
const GetArgs = z.object({ webhook_id: WebhookId }).strict();
const UpdateArgs = z
  .object({
    webhook_id: WebhookId,
    url: z.string().url().optional(),
    events: z.array(Event).optional(),
    status: z.enum(["enabled", "disabled"]).optional(),
  })
  .strict();
const DeleteArgs = z.object({ webhook_id: WebhookId }).strict();
const RotateArgs = z.object({ webhook_id: WebhookId }).strict();

const actions = {
  list: ListArgs,
  create: CreateArgs,
  get: GetArgs,
  update: UpdateArgs,
  delete: DeleteArgs,
  rotate_secret: RotateArgs,
};

type WebhooksInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "create" } & z.infer<typeof CreateArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "update" } & z.infer<typeof UpdateArgs>)
  | ({ action: "delete" } & z.infer<typeof DeleteArgs>)
  | ({ action: "rotate_secret" } & z.infer<typeof RotateArgs>);

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

const webhooksTool = {
  name: "whatsapp_webhooks" as const,
  description: [
    "Register URLs to receive signed HTTPS POSTs on Blueticks events.",
    "Available actions:",
    "  - list: list webhooks",
    "  - create: register a new webhook (URL + events). Returns the signing secret exactly once.",
    "  - get / update / delete: standard CRUD",
    "  - rotate_secret: roll the signing secret (returns the new secret once)",
    "",
    "Examples:",
    "  - create: 'register https://my.app/hook for message.delivered events'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    list: { readOnlyHint: true },
    get: { readOnlyHint: true },
    create: {},
    update: {},
    delete: { destructiveHint: true },
    rotate_secret: { destructiveHint: true },
  },
  async dispatch(input: WebhooksInput, client: Blueticks): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "list": {
          const { action: _action, ...q } = input;
          data = await client.webhooks.list(compact(q));
          break;
        }
        case "create": {
          const { action: _action, ...body } = input;
          data = await client.webhooks.create(body);
          break;
        }
        case "get":
          data = await client.webhooks.get(input.webhook_id);
          break;
        case "update": {
          const { action: _action, webhook_id, ...body } = input;
          data = await client.webhooks.update(webhook_id, compact(body));
          break;
        }
        case "delete":
          data = await client.webhooks.delete(input.webhook_id);
          break;
        case "rotate_secret":
          data = await client.webhooks.rotateSecret(input.webhook_id);
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default webhooksTool;

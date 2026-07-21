import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const WebhookId = z.string().min(1);
// Mirror backend KNOWN_EVENT_TYPES (whatsapp-scheduler-backend/src/services/webhooks/constants.ts).
// `message.sent` does NOT exist as a public event — the backend collapses
// internal `sent` into `message.sending`. Don't advertise it here.
const Event = z
  .enum([
    "message.queued",
    "message.sending",
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
  .object({ limit: z.number().int().min(1).max(200).optional(), skip: z.number().int().min(0).optional() })
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

const actions = {
  list: ListArgs,
  create: CreateArgs,
  get: GetArgs,
  update: UpdateArgs,
  delete: DeleteArgs,
};

type WebhooksInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "create" } & z.infer<typeof CreateArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "update" } & z.infer<typeof UpdateArgs>)
  | ({ action: "delete" } & z.infer<typeof DeleteArgs>);

function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

const webhooksTool = {
  name: "webhooks" as const,
  description: [
    "Register URLs to receive HTTPS POSTs on Blueticks events.",
    "Available actions:",
    "  - list: list webhooks",
    "  - create: register a new webhook (URL + events)",
    "  - get / update / delete: standard CRUD",
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
  },
  async dispatch(input: WebhooksInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "list":
          data = await client.webhooks.list(
            compact({ limit: input.limit, skip: input.skip }),
          );
          break;
        case "create":
          data = await client.webhooks.create({
            url: input.url,
            events: input.events,
          });
          break;
        case "get":
          data = await client.webhooks.get(input.webhook_id);
          break;
        case "update":
          data = await client.webhooks.update(
            input.webhook_id,
            compact({ url: input.url, events: input.events, status: input.status }),
          );
          break;
        case "delete":
          data = await client.webhooks.delete(input.webhook_id);
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default webhooksTool;

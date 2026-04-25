import { z } from "zod";
import type { Blueticks } from "blueticks";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const CampaignId = z.string().min(1);

const ListArgs = z
  .object({ limit: z.number().int().min(1).max(200).optional(), cursor: z.string().optional() })
  .strict();

const CreateArgs = z
  .object({
    name: z.string().min(1),
    audience_id: z.string().min(1),
    text: z.string().min(1).optional(),
    media_url: z.string().url().optional(),
    media_caption: z.string().optional(),
    from: z.string().optional(),
    on_missing_variable: z.enum(["fail", "skip"]).optional(),
  })
  .strict();

const ByIdArgs = z.object({ campaign_id: CampaignId }).strict();

const actions = {
  list: ListArgs,
  create: CreateArgs,
  get: ByIdArgs,
  pause: ByIdArgs,
  resume: ByIdArgs,
  cancel: ByIdArgs,
};

type CampaignsInput =
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "create" } & z.infer<typeof CreateArgs>)
  | ({ action: "get" | "pause" | "resume" | "cancel" } & z.infer<typeof ByIdArgs>);

/** Strip keys whose value is undefined so SDK param objects stay clean. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

const campaignsTool = {
  name: "whatsapp_campaigns" as const,
  description: [
    "Schedule audiences for paced bulk delivery, with pause/resume/cancel controls.",
    "Available actions:",
    "  - list: list campaigns",
    "  - create: schedule a campaign against an audience (name + audience_id + optional text/media_url/from/on_missing_variable)",
    "  - get: retrieve a campaign by id",
    "  - pause / resume / cancel: control a running campaign",
    "",
    "Examples:",
    "  - create: 'campaign called Summer Promo targeting aud_leads with text Hi {{name}}'",
    "  - pause: 'pause campaign camp_1'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    list: { readOnlyHint: true },
    get: { readOnlyHint: true },
    create: {},
    pause: {},
    resume: {},
    cancel: { destructiveHint: true },
  },
  async dispatch(input: CampaignsInput, client: Blueticks): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "list": {
          const { action: _action, ...q } = input;
          data = await client.campaigns.list(compact(q));
          break;
        }
        case "create": {
          const { action: _action, ...body } = input;
          data = await client.campaigns.create(compact(body) as Parameters<typeof client.campaigns.create>[0]);
          break;
        }
        case "get":
          data = await client.campaigns.get(input.campaign_id);
          break;
        case "pause":
          data = await client.campaigns.pause(input.campaign_id);
          break;
        case "resume":
          data = await client.campaigns.resume(input.campaign_id);
          break;
        case "cancel":
          data = await client.campaigns.cancel(input.campaign_id);
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default campaignsTool;

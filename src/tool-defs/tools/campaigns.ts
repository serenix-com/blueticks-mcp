import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const CampaignId = z.string().min(1);

const ListArgs = z
  .object({ limit: z.number().int().min(1).max(200).optional(), skip: z.number().int().min(0).optional() })
  .strict();

const CreateArgs = z
  .object({
    name: z.string().min(1),
    audience_id: z.string().min(1),
    text: z.string().min(1).optional(),
    media_url: z.string().url().optional(),
    media_caption: z.string().optional(),
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
  name: "campaigns" as const,
  description: [
    "Schedule audiences for paced bulk delivery, with pause/resume/cancel controls.",
    "Available actions:",
    "  - list: list campaigns",
    "  - create: schedule a campaign against an audience (name + audience_id + optional text/media_url/media_caption/on_missing_variable)",
    "  - get: retrieve a campaign by id",
    "  - pause / resume / cancel: control a running campaign",
    "",
    "Templates: `text` supports per-contact substitution using SINGLE-brace tokens — `Hi {firstName}, your {product} is renewing`.",
    "Resolution is case-insensitive. Built-ins always available: {whatsappname}, {displayname}, {phone}, {mobile}.",
    "Custom tokens come from audiences.append_contacts variables (the property name becomes the token).",
    "on_missing_variable=fail (default) rejects at create time if any contact lacks a referenced token; skip accepts and leaves `{token}` literal in unresolved sends.",
    "",
    "Examples:",
    "  - create: 'campaign called Summer Promo targeting the Leads audience with text \"Hi {firstName}, your {product} is renewing\"'",
    "  - pause: 'pause campaign 6a37b9a44919fa7098017a65'",
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
  async dispatch(input: CampaignsInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "list":
          data = await client.campaigns.list(
            compact({ limit: input.limit, skip: input.skip }),
          );
          break;
        case "create":
          // Required fields go directly; optional ones are spread only when
          // present so the SDK doesn't see explicit `undefined` slots.
          // Wire names are camelCase in the 2.0 API.
          data = await client.campaigns.create({
            name: input.name,
            audienceId: input.audience_id,
            ...(input.text !== undefined && { text: input.text }),
            ...(input.media_url !== undefined && { mediaUrl: input.media_url }),
            ...(input.media_caption !== undefined && { mediaCaption: input.media_caption }),
            ...(input.on_missing_variable !== undefined && {
              onMissingVariable: input.on_missing_variable,
            }),
          });
          break;
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
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default campaignsTool;

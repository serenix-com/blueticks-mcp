import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { compact } from "../surface-mapping";
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
    on_missing_variable: z.enum(["fail", "skip"]).optional(),
    send_at: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe("ISO 8601 with UTC offset. Start the campaign at this time instead of now; >=10s and <=365 days ahead."),
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

const campaignsTool = {
  name: "campaigns" as const,
  description: [
    "Schedule audiences for paced bulk delivery, with pause/resume/cancel controls.",
    "Available actions:",
    "  - list: list campaigns",
    "  - create: schedule a campaign against an audience (name + audience_id + optional text/media_url/on_missing_variable/send_at to schedule for later)",
    "  - get: retrieve a campaign by id",
    "  - pause / resume / cancel: control a running campaign",
    "",
    "`create` LAUNCHES a paced BULK send to the whole audience — an impactful action. Confirm with the user before creating one. An audience may contain individuals (phone / @c.us), groups (@g.us), and newsletters (@newsletter) — all are valid campaign contacts; a raw name is not (resolve it to a JID first).",
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
  // Per-action argument schemas (clients that expose one tool per action).
  actionSchemas: actions,
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
            compact({ limit: input.limit, cursor: input.cursor }),
          );
          break;
        case "create":
          // Required fields go directly; optional ones are spread only when
          // present so the SDK doesn't see explicit `undefined` slots.
          data = await client.campaigns.create({
            name: input.name,
            audience_id: input.audience_id,
            ...(input.text !== undefined && { text: input.text }),
            ...(input.media_url !== undefined && { media_url: input.media_url }),
            ...(input.media_caption !== undefined && { media_caption: input.media_caption }),
            ...(input.on_missing_variable !== undefined && {
              on_missing_variable: input.on_missing_variable,
            }),
            ...(input.send_at !== undefined && { send_at: input.send_at }),
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

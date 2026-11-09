// Surface → /v1 argument mappers that live in the backend's in-process adapter
// (src/mcp/services/*) rather than in the shared tool defs. Ported here so the
// HTTP surface reshapes arguments exactly as the hosted server does. Sources:
//   scheduled-messages-list-query.ts, scheduled-messages-patch.ts,
//   omit-signing-secret.ts, and `messages.send` in in-process-blueticks.ts.
import type { BlueticksMessagesApi } from "../tool-defs";

export type ScheduledListArgs = Parameters<BlueticksMessagesApi["list"]>[0];
export type ScheduledPatchArgs = Parameters<BlueticksMessagesApi["update"]>[1];
export type ScheduledSendArgs = Parameters<BlueticksMessagesApi["send"]>[0];

export interface V1ScheduledListQuery {
  limit?: number;
  skip?: number;
  chatId?: string;
  status?: string;
  includeSent?: boolean;
  includePreview?: boolean;
}

/** BE#193: `chat_id`/`cursor` → `chatId`/`skip`; a malformed cursor reads page 0. */
export function buildScheduledMessagesListQuery(q: ScheduledListArgs | undefined): V1ScheduledListQuery {
  const out: V1ScheduledListQuery = {};
  if (!q) return out;
  if (q.limit !== undefined) out.limit = q.limit;
  if (q.status !== undefined) out.status = q.status;
  if (q.chat_id !== undefined) out.chatId = q.chat_id;
  if (q.include_sent !== undefined) out.includeSent = q.include_sent;
  if (q.include_preview !== undefined) out.includePreview = q.include_preview;
  if (q.cursor !== undefined) {
    const skip = Number(q.cursor);
    if (Number.isInteger(skip) && skip >= 0) out.skip = skip;
  }
  return out;
}

export interface V1ScheduledPatch {
  text?: string;
  mediaUrl?: string;
  sendAt?: string;
}

/** BE#599: snake_case edit → strict camelCase PATCH; `media_caption` folds into `text`. */
export function buildScheduledMessagePatch(body: ScheduledPatchArgs): V1ScheduledPatch {
  const out: V1ScheduledPatch = {};
  const text = body.text ?? body.media_caption;
  if (text !== undefined) out.text = text;
  if (body.media_url !== undefined) out.mediaUrl = body.media_url;
  if (body.send_at !== undefined) out.sendAt = body.send_at;
  return out;
}

type Weekday = NonNullable<NonNullable<ScheduledSendArgs["recurrence"]>["by_weekday"]>[number];

interface V1Recurrence {
  frequency: NonNullable<ScheduledSendArgs["recurrence"]>["frequency"];
  interval?: number;
  byWeekday?: Weekday[];
  endsAfter?: number;
  endsOn?: string;
  timezone?: string;
}

interface V1SendCommon {
  sendAt?: string;
  recurrence?: V1Recurrence;
  from?: string;
  recipientName?: string;
  mentions?: string[];
}

export type V1SendBody =
  | (V1SendCommon & { type: "poll"; pollQuestion: string; pollOptions: string[]; pollAllowMultiple?: boolean })
  | (V1SendCommon & {
      type: "media";
      mediaUrl?: string;
      mediaBase64?: string;
      mediaKind?: string;
      mediaMimeType?: string;
      mediaFilename?: string;
      text?: string;
    })
  | (V1SendCommon & { type: "text"; text?: string });

/**
 * The flat snake_case send → v1's strict camelCase `SendMessageRequest`. The
 * recipient is a path segment (`POST /v1/scheduled-messages/{chatId}`), so `to`
 * is not part of the body.
 */
export function buildScheduledSendBody(body: ScheduledSendArgs): V1SendBody {
  const common: V1SendCommon = {};
  if (body.send_at !== undefined) common.sendAt = body.send_at;
  if (body.recurrence !== undefined) {
    const r = body.recurrence;
    common.recurrence = {
      frequency: r.frequency,
      ...(r.interval !== undefined && { interval: r.interval }),
      ...(r.by_weekday !== undefined && { byWeekday: r.by_weekday }),
      ...(r.ends_after !== undefined && { endsAfter: r.ends_after }),
      ...(r.ends_on !== undefined && { endsOn: r.ends_on }),
      ...(r.timezone !== undefined && { timezone: r.timezone }),
    };
  }
  if (body.from !== undefined) common.from = body.from;
  if (body.recipient_name !== undefined) common.recipientName = body.recipient_name;
  if (body.mentions !== undefined) common.mentions = body.mentions;

  if (body.poll) {
    return {
      type: "poll",
      pollQuestion: body.poll.question,
      pollOptions: body.poll.options,
      ...(body.poll.allow_multiple !== undefined ? { pollAllowMultiple: body.poll.allow_multiple } : {}),
      ...common,
    };
  }
  if (body.media_url || body.media_base64) {
    return {
      type: "media",
      // mediaUrl wins over mediaBase64, as in v1: send only the winning source.
      ...(body.media_url ? { mediaUrl: body.media_url } : { mediaBase64: body.media_base64 }),
      ...(body.media_kind ? { mediaKind: body.media_kind } : {}),
      ...(body.media_mime_type ? { mediaMimeType: body.media_mime_type } : {}),
      ...(body.media_filename ? { mediaFilename: body.media_filename } : {}),
      ...(body.media_caption ? { text: body.media_caption } : {}),
      ...common,
    };
  }
  return { type: "text", text: body.text, ...common };
}

function stripSecret(w: unknown): unknown {
  if (typeof w !== "object" || w === null || Array.isArray(w)) return w;
  return Object.fromEntries(Object.entries(w).filter(([k]) => k !== "signingSecret"));
}

/**
 * #179: the webhook signing secret is shown on create only. A list/get/update
 * read would otherwise copy it into the model's context on every call.
 */
export function omitSigningSecret(result: unknown): unknown {
  if (Array.isArray(result)) return result.map(stripSecret);
  if (typeof result === "object" && result !== null && "data" in result && Array.isArray(result.data)) {
    return { ...result, data: result.data.map(stripSecret) };
  }
  return stripSecret(result);
}

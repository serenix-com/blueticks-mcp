import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const actions = {
  validate_phone: z.object({ phone_or_chat_id: z.string().min(3) }).strict(),
  link_preview: z.object({ url: z.string().url() }).strict(),
  current_date_time: z.object({}).strict(),
};

/**
 * Default timezone for the user-local clock. The MCP host runs in the gateway
 * pod (UTC), so a bare `new Date()` mislabels the user's day/weekend — the
 * model computed "last weekend" as Sat–Sun UTC instead of the Israeli Fri–Sat.
 * Until a per-user locale/timezone source is wired in here, default to the
 * product's primary market.
 * TODO: source the user's timezone (workspace locale / profile) when available.
 */
export const DEFAULT_USER_TIMEZONE = 'Asia/Jerusalem';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Build the current-date-time payload in the USER's timezone (weekday +
 * offset-bearing local ISO), while keeping the UTC `iso`/`unix_ms` for any
 * absolute-time math. Pure over an injected `now` + `tz` so it's unit-testable.
 */
export function buildCurrentDateTime(now: Date, tz: string = DEFAULT_USER_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'long',
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const y = Number(parts.year);
  const mo = Number(parts.month);
  const d = Number(parts.day);
  const h = Number(parts.hour);
  const mi = Number(parts.minute);
  const s = Number(parts.second);
  // Offset = (wall-clock interpreted as UTC) − (actual instant). Positive east
  // of UTC (Israel is +02:00 / +03:00 DST).
  const offsetMinutes = Math.round((Date.UTC(y, mo - 1, d, h, mi, s) - now.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const offsetStr = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;

  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  // LLM date arithmetic is unreliable (a live run computed "last weekend" as
  // 4-5 July when today was Friday 10 July — off by one AND Sat-Sun instead of
  // the Israeli Fri-Sat). Derive the windows in code so the model copies them
  // verbatim instead of counting days.
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dow = WEEKDAYS.indexOf(parts.weekday ?? '');
  const addDays = (dateStr: string, delta: number): string => {
    const [Y = 1970, M = 1, D = 1] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(Y, M - 1, D));
    dt.setUTCDate(dt.getUTCDate() + delta);
    return dt.toISOString().slice(0, 10);
  };
  // Israeli weekend = Friday+Saturday. "Last weekend" = the most recent
  // COMPLETED Fri-Sat pair: the latest Saturday strictly before today, and the
  // Friday preceding it. (On a Saturday, the in-progress weekend is "this
  // weekend", so last weekend is the previous pair.)
  const daysSinceSaturday = (((dow - 6) + 7) % 7) || 7;
  const lastWeekendSaturday = addDays(localDate, -daysSinceSaturday);
  const lastWeekendFriday = addDays(lastWeekendSaturday, -1);

  return {
    // UTC — the absolute instant (unchanged contract).
    iso: now.toISOString(),
    unix_ms: now.getTime(),
    // User-local — the fields the model should reason about for "today",
    // "this weekend", weekday names, etc.
    local_iso: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offsetStr}`,
    local_date: localDate,
    weekday: parts.weekday,
    timezone: tz,
    offset_minutes: offsetMinutes,
    // Pre-derived relative windows — copy these verbatim, do NOT re-derive.
    derived: {
      last_weekend: {
        friday: lastWeekendFriday,
        saturday: lastWeekendSaturday,
        window_start_local: `${lastWeekendFriday}T00:00:00${offsetStr}`,
        window_end_local: `${addDays(lastWeekendSaturday, 1)}T00:00:00${offsetStr}`,
      },
    },
  };
}

type UtilsInput =
  | { action: "validate_phone"; phone_or_chat_id: string }
  | { action: "link_preview"; url: string }
  | { action: "current_date_time" };

const utilsTool = {
  name: "utils" as const,
  description: [
    "WhatsApp utility helpers that don't fit a primary resource.",
    "Available actions:",
    "  - validate_phone: check whether a phone or chat id is valid and registered on WhatsApp",
    "  - link_preview: generate the preview metadata WhatsApp would show for a URL",
    "  - current_date_time: current date/time. `local_iso`/`local_date` and",
    "      `weekday` are in the USER's timezone (`timezone`, default Asia/Jerusalem)",
    "      — use these for \"today\"/\"this weekend\"/weekday reasoning. `iso` and",
    "      `unix_ms` are UTC for absolute math. Always call this before any tool",
    "      that takes a future timestamp. For \"last weekend\" (Israeli Fri-Sat) use",
    "      `derived.last_weekend` VERBATIM (window_start_local/window_end_local as",
    "      since/until) — never count days yourself.",
    "",
    "Examples:",
    "  - validate_phone: 'is +972544325389 on WhatsApp?'",
    "  - link_preview: 'preview https://blueticks.co for me'",
    "  - current_date_time: 'what time is it for me right now?'",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  // Per-action argument schemas (clients that expose one tool per action).
  actionSchemas: actions,
  annotations: {
    validate_phone: { readOnlyHint: true },
    link_preview: { readOnlyHint: true },
    current_date_time: { readOnlyHint: true },
  },
  async dispatch(input: UtilsInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      let data: unknown;
      switch (input.action) {
        case "validate_phone":
          data = await client.utils.validatePhone({ phone_or_chat_id: input.phone_or_chat_id });
          break;
        case "link_preview":
          data = await client.utils.linkPreview({ url: input.url });
          break;
        case "current_date_time": {
          // Local-only helper — there's no backend endpoint for this and the
          // SDK doesn't expose it. The MCP host runs in the gateway pod (UTC),
          // so we render the clock in the USER's timezone (default
          // Asia/Jerusalem) with a weekday, so the model reasons about the
          // user's day/weekend — not the pod's UTC day.
          data = buildCurrentDateTime(new Date());
          break;
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default utilsTool;

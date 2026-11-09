import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const rfc3339 = z.string().datetime({ offset: true });

const actions = {
  freebusy: z.object({ from: rfc3339, to: rfc3339 }).strict(),
  book: z.object({
    start: rfc3339,
    end: rfc3339,
    summary: z.string().min(1),
    description: z.string().optional(),
    attendeeEmail: z.string().email().optional(),
  }).strict(),
};

type CalendarInput =
  | { action: "freebusy"; from: string; to: string }
  | { action: "book"; start: string; end: string; summary: string; description?: string; attendeeEmail?: string };

const calendarTool = {
  name: "calendar" as const,
  description: [
    "Your own Google Calendar (the one your owner connected to you). Two actions:",
    "  - freebusy: {from, to} → { busy: [{start, end}], timeZone }. The busy intervals",
    "      between two RFC3339 times (with offset, e.g. 2026-10-05T00:00:00+03:00).",
    "      Everything not busy is free; decide what is bookable from your own instructions",
    "      (working hours, appointment length).",
    "  - book: {start, end, summary, description?, attendeeEmail?} → { eventId, htmlLink }.",
    "      start/end are RFC3339 with offset, in the calendar's timeZone.",
    "",
    "To book: ALWAYS call freebusy for the day first, offer the person free times, and",
    "book only a time they agreed to. book re-checks the slot and fails with",
    "slot_taken when it is no longer free — then run freebusy again and offer another time.",
    "attendeeEmail is recorded in the event description (no invitation is sent).",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    freebusy: { readOnlyHint: true },
    book: {},
  },
  async dispatch(input: CalendarInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      if (!client.calendar) {
        return toolErrorResult(
          Object.assign(new Error("The calendar tool is not available in this context."), { code: 502, name: "BadGateway" }),
        );
      }
      let data: unknown;
      switch (input.action) {
        case "freebusy": {
          const q = actions.freebusy.parse({ from: input.from, to: input.to });
          data = await client.calendar.freebusy(q);
          break;
        }
        case "book": {
          const { start, end, summary, description, attendeeEmail } = input;
          data = await client.calendar.book(actions.book.parse({ start, end, summary, description, attendeeEmail }));
          break;
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      if (err instanceof z.ZodError) {
        return toolErrorResult(
          Object.assign(new Error(err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")), {
            code: 400,
            name: "BadRequest",
          }),
        );
      }
      return toolErrorResult(err);
    }
  },
};

export default calendarTool;

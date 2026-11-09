import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const BoardId = z.string().min(1);
const ItemId = z.string().min(1);

// Custom cell values keyed by column TITLE (e.g. "Source", "Company", "Value").
// Status/priority/due_date are NOT cells — they have their own fields.
const Cells = z.record(z.union([z.string(), z.number()]));

// Provenance for an AI-extracted item — where in WhatsApp it came from.
const Source = z
  .object({
    chat_id: z.string().optional(),
    chat_name: z.string().max(200).optional(),
    message_key: z.string().optional(),
    excerpt: z.string().max(2000).optional(),
    extracted_at: z.number().int().optional(),
  })
  .strict();

// One item body — shared by create_item and (as an array element) bulk_upsert.
const ItemBody = z
  .object({
    text: z.string().min(1).max(2000),
    status: z.string().max(120).optional(),
    priority: z.string().max(120).optional(),
    due_date: z.string().max(64).optional(),
    cells: Cells.optional(),
    source: Source.optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

const ListBoardsArgs = z
  .object({
    domain: z.string().min(1).optional(),
    agent_managed: z.boolean().optional(),
  })
  .strict();

const CreateBoardArgs = z
  .object({
    // Built-in domain OR a custom entity_kind — at least one is required (the
    // server rejects a create with neither).
    domain: z
      .string()
      .min(1)
      .optional()
      .describe("Built-in board domain: 'tasks', 'leads' or 'invoices'. Use this for those; use entity_kind to open a board for ANY OTHER entity type."),
    entity_kind: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe("Open a board for X: the kind of thing this board tracks (e.g. 'reminders', 'orders', 'follow-ups', 'suppliers'). Creates a NEW, separate board dedicated to this entity type. ALWAYS pair it with `description`."),
    name: z.string().min(1).max(120).optional().describe('Optional board name; defaults from the domain / entity_kind.'),
    description: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe("The board's PURPOSE in one line, e.g. \"Board goal: manage the user's reminders — use it whenever the user asks about reminders.\" REQUIRED when you pass entity_kind. Shown as the board subtitle and read back to you in the board directory, so write it clearly."),
    memory_retention_days: z.number().int().min(0).max(3650).optional(),
  })
  .strict();

const GetBoardArgs = z.object({ board_id: BoardId }).strict();

const ListItemsArgs = z
  .object({
    board_id: BoardId,
    active_only: z.boolean().optional(),
    status: z.string().optional(),
    updated_since: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

const CreateItemArgs = ItemBody.extend({ board_id: BoardId }).strict();

const UpdateItemArgs = z
  .object({
    board_id: BoardId,
    item_id: ItemId,
    text: z.string().min(1).max(2000).optional(),
    status: z.string().max(120).optional(),
    priority: z.string().max(120).optional(),
    due_date: z.string().max(64).optional(),
    cells: Cells.optional(),
    source: Source.optional(),
    confidence: z.number().min(0).max(1).optional(),
    deleted: z.boolean().optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

const BulkUpsertArgs = z
  .object({
    board_id: BoardId,
    items: z.array(ItemBody).min(1).max(500),
  })
  .strict();

const FindSimilarArgs = z
  .object({
    board_id: BoardId,
    candidates: z.array(z.object({ text: z.string().min(1).max(2000) }).strict()).min(1).max(500),
  })
  .strict();

const actions = {
  list_boards: ListBoardsArgs,
  create_board: CreateBoardArgs,
  get_board: GetBoardArgs,
  list_items: ListItemsArgs,
  create_item: CreateItemArgs,
  update_item: UpdateItemArgs,
  bulk_upsert: BulkUpsertArgs,
  find_similar: FindSimilarArgs,
};

type BoardsInput =
  | ({ action: "list_boards" } & z.infer<typeof ListBoardsArgs>)
  | ({ action: "create_board" } & z.infer<typeof CreateBoardArgs>)
  | ({ action: "get_board" } & z.infer<typeof GetBoardArgs>)
  | ({ action: "list_items" } & z.infer<typeof ListItemsArgs>)
  | ({ action: "create_item" } & z.infer<typeof CreateItemArgs>)
  | ({ action: "update_item" } & z.infer<typeof UpdateItemArgs>)
  | ({ action: "bulk_upsert" } & z.infer<typeof BulkUpsertArgs>)
  | ({ action: "find_similar" } & z.infer<typeof FindSimilarArgs>);

/** Strip keys whose value is undefined so SDK param objects stay clean. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

const boardsTool = {
  name: "boards" as const,
  description: [
    "Your durable, cross-conversation LONG-TERM MEMORY. A board is a saved list of things you are tracking for this user — Tasks, Leads (sales prospects), and similar. Unlike the chat, a board PERSISTS: what you write here is still here in the next conversation, tomorrow, next week. The user can also see and edit these boards in the Blueticks web app, so this is the ONE shared source of truth between you and the user.",
    "",
    "GOLDEN RULE — READ BEFORE YOU ANSWER: whenever the user asks about their tasks, to-dos, leads, prospects, or anything you might already be tracking, FIRST call `list_items` with `active_only: true` on the right board and answer FROM those items. Do NOT re-scan WhatsApp and do NOT answer from memory of this chat — the board is the truth. Re-scanning chats to answer 'what are my tasks?' produces duplicates and resurrects finished items.",
    "",
    "ONE BOARD PER ENTITY TYPE: each kind of thing lives on its OWN board — tasks on the tasks board, reminders on a reminders board, orders on an orders board, and so on. NEVER put an entity on a board of a different type. Before writing, call `list_boards` and READ each board's description to pick the right one; if none fits the entity type, open a new board for it with `create_board {entity_kind, description}`. When the user explicitly says \"open a board for X / פתח בורד ל-X\", ALWAYS create a NEW separate board (never reuse another type's board).",
    "",
    "Typical flow:",
    "  1. `create_board {domain}` for a built-in type ('tasks', 'leads', 'invoices'), OR `create_board {entity_kind, description}` to open a board for any OTHER entity type. Find-or-create; call this FIRST — it returns the board_id AND the exact status/priority option labels you must use.",
    "  2. `list_items {board_id, active_only:true}` — read current memory before answering or before writing.",
    "  3. After scanning chats and extracting many items, write them in ONE `bulk_upsert` call — it deduplicates server-side (fingerprint + fuzzy title match), so re-running a scan will NOT create duplicates. Prefer this over calling `create_item` in a loop.",
    "  4. `update_item` to change a single item (e.g. set status to a Done label when you learn it's finished).",
    "",
    "Actions:",
    "  - list_boards: list the memory boards that exist, each with its `description`. READ the descriptions — they tell you what each board is for, so you route every entity to the right board (and know when you need a new one).",
    "  - create_board: FIND-OR-CREATE a memory board. Pass `domain` for a built-in type ('tasks'/'leads'/'invoices'); pass `entity_kind` (plus a one-line `description` of the board's PURPOSE) to open a NEW board for any other entity type — it gets a generic Status/Priority/Date/Source template. If a matching board already exists it is returned unchanged; else it is created AND provisioned. ALWAYS returns the board with its columns + valid option labels — read those before writing items.",
    "  - get_board: fetch one board with its columns and the valid Status/Priority option labels.",
    "  - list_items: read items. Use `active_only:true` for the live view (recent, non-done, not deleted) — this is what you answer questions from. Filter by `status`, `updated_since`, page with `limit`/`offset`.",
    "  - create_item: add ONE item. Prefer bulk_upsert when adding several. When the item is extracted from WhatsApp, ALWAYS pass `source` (see PROVENANCE below).",
    "  - update_item: edit ONE item by item_id (change text/status/priority/due_date/cells, soft-delete via `deleted:true`, restore via `deleted:false`). Pass `note` to record why. A user turn of the form `[poll vote] \"<task text>\" → <status label>` is a status answer from a WhatsApp poll: match the quoted task with find_similar, then update_item to set that status.",
    "  - bulk_upsert: create/update MANY items in one call; deduplicates against existing items server-side. Use this after a chat scan. When items are extracted from WhatsApp, ALWAYS pass `source` on each (see PROVENANCE below).",
    "  - find_similar: given candidate texts, ask the server which already exist on the board (dedupe check) before deciding what to add.",
    "",
    "STATUS & PRIORITY ARE LABELS, NOT FREE TEXT: valid status/priority values are the option LABELS returned by create_board / get_board (e.g. status 'Todo' / 'Done', priority 'High'). Pass the label string exactly (case-insensitive). Never invent a label or pass an id — an unknown label is rejected with the list of valid ones.",
    "",
    "PROVENANCE — SAY WHERE IT CAME FROM: when an item is extracted from WhatsApp messages, ALWAYS pass `source` { chat_id, chat_name (the human chat/contact name), message_key, excerpt (a VERBATIM fragment of the message) }. The server surfaces this on the board's Source cell so the user can see WHY each item exists, and when the user asks why a task is there, quote its source.",
    "",
    "NOT RELEVANT vs DELETE: when the user says a task is irrelevant / not needed / no longer applies, DO NOT delete it — set its status to 'Not relevant' (a terminal status; it drops out of the active list but stays on the board and reversible). Only soft-delete when the user explicitly asks to remove it.",
    "",
    "NEVER HARD-DELETE: to remove an item, call `update_item {deleted:true}` (a reversible soft-delete the user can restore). There is no hard-delete here — that is the user's decision in the web app.",
    "",
    "Domains: built-in 'tasks' (to-dos), 'leads' (sales prospects), 'invoices' (bills/receipts) — plus a NEW board for any other entity type via `create_board {entity_kind, description}`. Each conversation's memory is isolated to you automatically — you never need to pass an agent id.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  // Every board action is treated as an active memory operation (not read-only)
  // and none hard-deletes (soft-delete only) — hence non-destructive.
  annotations: {
    list_boards: { readOnlyHint: false, destructiveHint: false },
    create_board: { readOnlyHint: false, destructiveHint: false },
    get_board: { readOnlyHint: false, destructiveHint: false },
    list_items: { readOnlyHint: false, destructiveHint: false },
    create_item: { readOnlyHint: false, destructiveHint: false },
    update_item: { readOnlyHint: false, destructiveHint: false },
    bulk_upsert: { readOnlyHint: false, destructiveHint: false },
    find_similar: { readOnlyHint: false, destructiveHint: false },
  },
  async dispatch(input: BoardsInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      if (!client.boards) {
        return toolErrorResult(
          new Error("Long-term memory boards are not available on this connection."),
        );
      }
      const boards = client.boards;
      let data: unknown;
      switch (input.action) {
        case "list_boards":
          data = await boards.list(
            compact({ domain: input.domain, agent_managed: input.agent_managed }),
          );
          break;
        case "create_board":
          data = await boards.create(
            compact({
              domain: input.domain,
              entity_kind: input.entity_kind,
              name: input.name,
              description: input.description,
              memory_retention_days: input.memory_retention_days,
            }) as { domain?: string; entity_kind?: string; name?: string; description?: string; memory_retention_days?: number },
          );
          break;
        case "get_board":
          data = await boards.get(input.board_id);
          break;
        case "list_items":
          data = await boards.listItems(
            input.board_id,
            compact({
              active_only: input.active_only,
              status: input.status,
              updated_since: input.updated_since,
              limit: input.limit,
              offset: input.offset,
            }),
          );
          break;
        case "create_item":
          data = await boards.createItem(
            input.board_id,
            compact({
              text: input.text,
              status: input.status,
              priority: input.priority,
              due_date: input.due_date,
              cells: input.cells,
              source: input.source,
              confidence: input.confidence,
            }) as { text: string },
          );
          break;
        case "update_item":
          data = await boards.updateItem(
            input.board_id,
            input.item_id,
            compact({
              text: input.text,
              status: input.status,
              priority: input.priority,
              due_date: input.due_date,
              cells: input.cells,
              source: input.source,
              confidence: input.confidence,
              deleted: input.deleted,
              note: input.note,
            }),
          );
          break;
        case "bulk_upsert":
          data = await boards.bulkUpsert(
            input.board_id,
            input.items.map((it) => ({ ...it })),
          );
          break;
        case "find_similar":
          data = await boards.findSimilar(
            input.board_id,
            input.candidates.map((c) => ({ text: c.text })),
          );
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default boardsTool;

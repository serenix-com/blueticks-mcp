import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

// #1457: tasks on the user's OWN UI boards (the boards of the Blueticks web app). The AI memory
// boards (the `boards` tool) and audience boards are out of reach: the in-process adapter scopes
// every call to UI boards, so a memory board id 404s here.
const BoardId = z.string().min(1).max(100);
const TaskId = z.string().min(1).max(100);
const Label = z.string().min(1).max(120);
const Cells = z.record(z.union([z.string().max(2000), z.number()]));
const Limit = z.number().int().min(1).max(100);
const Offset = z.number().int().min(0);

const Source = z.object({
  chat_id: z.string().max(200).optional(),
  chat_name: z.string().max(200).optional(),
  message_key: z.string().max(300).optional(),
  excerpt: z.string().max(2000).optional(),
}).strict();

const actions = {
  list_boards: z.object({
    limit: Limit.optional(),
    offset: Offset.optional(),
  }).strict(),
  get_board: z.object({
    board_id: BoardId,
  }).strict(),
  list_tasks: z.object({
    board_id: BoardId,
    status: Label.optional(),
    updated_since: z.string().max(40).optional(),
    limit: Limit.optional(),
    offset: Offset.optional(),
  }).strict(),
  create_task: z.object({
    board_id: BoardId,
    text: z.string().min(1).max(2000),
    status: Label.optional(),
    priority: Label.optional(),
    due_date: z.string().max(64).optional(),
    cells: Cells.optional(),
    source: Source.optional(),
    allow_duplicate: z.boolean().optional(),
  }).strict(),
  update_task: z.object({
    board_id: BoardId,
    task_id: TaskId,
    text: z.string().min(1).max(2000).optional(),
    status: Label.optional(),
    priority: Label.optional(),
    due_date: z.string().max(64).optional(),
    cells: Cells.optional(),
    deleted: z.boolean().optional(),
    note: z.string().max(500).optional(),
  }).strict(),
};

type TasksInput =
  | ({ action: "list_boards" } & z.infer<typeof actions.list_boards>)
  | ({ action: "get_board" } & z.infer<typeof actions.get_board>)
  | ({ action: "list_tasks" } & z.infer<typeof actions.list_tasks>)
  | ({ action: "create_task" } & z.infer<typeof actions.create_task>)
  | ({ action: "update_task" } & z.infer<typeof actions.update_task>);

/** What the MCP layer hands over: the flat object (every per-action field optional). */
type TasksFlatInput = { action: string; [field: string]: unknown };

function parseInput(input: TasksFlatInput): TasksInput {
  const { action, ...args } = input;
  switch (action) {
    case "list_boards": return { action, ...actions.list_boards.parse(args) };
    case "get_board": return { action, ...actions.get_board.parse(args) };
    case "list_tasks": return { action, ...actions.list_tasks.parse(args) };
    case "create_task": return { action, ...actions.create_task.parse(args) };
    case "update_task": return { action, ...actions.update_task.parse(args) };
    default: throw Object.assign(new Error("Unsupported tasks action."), { code: 400, name: "BadRequest" });
  }
}

const tasksTool = {
  name: "tasks" as const,
  description: [
    "Tasks on the user's own Blueticks boards (the boards of the Blueticks web app).",
    "",
    "Actions:",
    "  - list_boards: {limit?, offset?} lists the boards, newest first, with their task counts.",
    "  - get_board: {board_id} returns one board with its columns and the labels its status and priority columns accept.",
    "  - list_tasks: {board_id, status?, updated_since?, limit?, offset?} lists the tasks of a board.",
    "  - create_task: {board_id, text, status?, priority?, due_date?, cells?, source?, allow_duplicate?} adds a task.",
    "    status and priority are option LABELS of the board (an unknown label is rejected); cells are other columns by title.",
    "    A task whose text matches an existing task on the board is merged into it (merged: true) unless allow_duplicate is true.",
    "  - update_task: {board_id, task_id, text?, status?, priority?, due_date?, cells?, deleted?, note?} changes one task.",
    "    deleted: true removes it from the board (restorable with deleted: false).",
    "",
    "AI memory boards and audience boards are not reachable here.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  actionSchemas: actions,
  annotations: {
    list_boards: { readOnlyHint: true, destructiveHint: false },
    get_board: { readOnlyHint: true, destructiveHint: false },
    list_tasks: { readOnlyHint: true, destructiveHint: false },
    create_task: { readOnlyHint: false, destructiveHint: false },
    update_task: { readOnlyHint: false, destructiveHint: false },
  },
  async dispatch(input: TasksFlatInput, client: Pick<BlueticksSurface, "tasks">): Promise<ToolResult> {
    try {
      if (!client.tasks) {
        throw Object.assign(new Error("tasks is not available on this connection."), { code: 400, name: "BadRequest" });
      }
      const parsed = parseInput(input);
      let data: unknown;
      switch (parsed.action) {
        case "list_boards": {
          const { action, ...q } = parsed;
          void action;
          data = await client.tasks.listBoards(q);
          break;
        }
        case "get_board":
          data = await client.tasks.getBoard(parsed.board_id);
          break;
        case "list_tasks": {
          const { action, board_id, ...q } = parsed;
          void action;
          data = await client.tasks.listTasks(board_id, q);
          break;
        }
        case "create_task": {
          const { action, board_id, ...body } = parsed;
          void action;
          data = await client.tasks.createTask(board_id, body);
          break;
        }
        case "update_task": {
          const { action, board_id, task_id, ...body } = parsed;
          void action;
          data = await client.tasks.updateTask(board_id, task_id, body);
          break;
        }
      }
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default tasksTool;

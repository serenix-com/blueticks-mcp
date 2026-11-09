import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";
import { TRANSCRIBE_LANG_VALUES } from "../backend-shims";

const CreateArgs = z
  .object({
    client_id: z.string().optional().describe("Leave out — the server uses the user's own WhatsApp connection."),
    label: z.string().min(1).describe("A short human name for the agent."),
    identity_prompt: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The agent's system prompt — HOW it behaves and what its task is. Required unless identity_prompt_upload_id is given. NEVER paste an attached file's content here — use identity_prompt_upload_id.",
      ),
    identity_prompt_upload_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The upload_id of an ATTACHED file that IS the agent's instructions/system prompt. The server reads its text and uses it as the identity prompt — do NOT copy the file's content into identity_prompt. (upload_id = the `<uploadId>` prefix of `attachments/<uploadId>-<name>`, up to the first `-`.)",
      ),
    knowledge_upload_ids: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "upload_ids of ATTACHED documents (pdf/docx/xlsx/csv/txt/md) that are reference material. The server files each into the agent's knowledge base — do NOT copy their content into knowledge_text.",
      ),
    trigger_chat_ids: z
      .array(z.string())
      .optional()
      .describe("Chats whose INCOMING messages activate the agent. Omit/empty = the agent is activated ONLY by its schedule (it will NOT reply to any chat's traffic)."),
    read_message_chat_ids: z
      .array(z.string())
      .optional()
      .describe("Chats the agent may READ MESSAGES from (turns on the read-only Blueticks MCP, scoped to exactly these chats). For a 'summarize chat X' task, set this to [X]. Enforced server-side."),
    read_all_messages: z
      .boolean()
      .optional()
      .describe("Let each run read the messages of ITS OWN chat (the conversation it is answering / the schedule's source chat). An agent never reads other chats unless they are listed in read_message_chat_ids. Enforced server-side."),
    read_chats_list: z
      .boolean()
      .optional()
      .describe("No effect for agent runs: they never get the account-wide chat list (session isolation). Resolve chat ids yourself and pass them in read_message_chat_ids."),
    include_new_chats: z.boolean().optional().describe("Also respond to brand-new incoming chats. Default false."),
    songs: z
      .boolean()
      .optional()
      .describe("Media-reply switch: lets the agent answer with audio (songs/music) in the chat it is answering. Turn on only when the agent's job needs audio replies; default off."),
    images: z
      .boolean()
      .optional()
      .describe("Media-reply switch: lets the agent answer with images in the chat it is answering. Turn on only when the agent's job needs picture replies; default off."),
    voice_replies: z
      .boolean()
      .optional()
      .describe("May answer with a WhatsApp VOICE NOTE (its `voice` tool), like a person: when the customer sends a voice note or asks it to talk. Turn on when the user wants the agent to answer by voice / with recordings. Default false."),
    voice_when: z
      .string()
      .max(1000)
      .optional()
      .describe("WHEN it answers with a voice note instead of text, in the user's words (e.g. 'always', 'only when the customer sent a voice message'). Goes into the agent's instructions. Omit for the default (when the customer sends a voice note or asks to talk). Only meaningful with voice_replies."),
    voice_name: z
      .string()
      .max(64)
      .optional()
      .describe("The VOICE it speaks with, for voice notes and calls — a voice id from the agent form's voice list (Google: e.g. 'Aoede' female, 'Puck' male). Omit for the default voice."),
    answer_calls: z
      .boolean()
      .optional()
      .describe("ANSWERS WhatsApp VOICE CALLS from the chats it serves and talks with the caller (its own persona and knowledge), live. Turn on when the user wants callers to be able to phone the agent. Works on numbers connected as a Gateway (24/7). Default false."),
    send_chat_ids: z
      .array(z.string())
      .optional()
      .describe(
        "Chats the agent's REPLIES go to, INSTEAD of the chat that triggered it. Omit/empty = it replies in the triggering chat (the normal case). For 'every message from X goes to Y' set trigger_chat_ids:[X] and send_chat_ids:[Y]. Enforced by the Bridge — it cannot send anywhere else.",
      ),
    knowledge_text: z.string().optional().describe("Reference/business facts the agent should know (stored in its knowledge base, not the prompt)."),
    // ── DEPRECATED — accept-and-strip for ONE release ────────────────────────
    // customer_level / timeout_minutes were removed from the schema (v2 never
    // read them). `inputSchema` here is sent VERBATIM as the Anthropic tool's
    // `input_schema` (src/services/btgpt/loop.ts) and as the standalone
    // @blueticks/mcp package's published schema — there is no separate
    // "parsing" schema this file controls, so a plain removal makes a strict
    // (additionalProperties:false) validator reject a stale client replaying
    // these fields (cached tools/list, or a resumed builder transcript that
    // used them earlier in the conversation). Keep them declared-but-ignored
    // for one release so those callers don't get a validation error; dispatch
    // strips them before the body reaches the agents service. REMOVE both
    // fields (and the dispatch strip) in the next release after this one.
    customer_level: z.unknown().optional().describe("Deprecated, ignored. Do not set — removed in the next release."),
    timeout_minutes: z.unknown().optional().describe("Deprecated, ignored. Do not set — removed in the next release."),
    // ── THE SETTINGS THE BUILDER USED TO HAVE NO WAY TO SET ──────────────────
    // Every one of these is already honoured by the create/patch service; they
    // were simply absent from this schema, so an agent that needed them was
    // born unconfigured (see src/mcp/services/agent-tool-fields.ts).
    web_access: z
      .object({
        mode: z.enum(["off", "allowlist", "all"]).describe('"allowlist" = only `hosts`; "all" = any site; "off" = no web at all.'),
        hosts: z.array(z.string()).optional().describe('Hosts for "allowlist" mode, e.g. ["example.com","www.example.com"].'),
      })
      .optional()
      .describe(
        'REQUIRED whenever the agent must read a website or send images/info FROM one. Default is OFF: with no web access the agent cannot fetch a page or a product photo, so an agent told to "take details and pictures from our site" is useless without this. If the user names a site, use mode "allowlist" with that host (and its www. form).',
      ),
    chat_scope: z
      .enum(["list", "all_except"])
      .optional()
      .describe('"list" (default) = only `trigger_chat_ids`. "all_except" = EVERY chat except `chat_block_list` — use it for "answer everyone / all my chats".'),
    chat_block_list: z.array(z.string()).optional().describe('For chat_scope "all_except": the chats it must NOT answer.'),
    chat_types: z
      .enum(["all", "private"])
      .optional()
      .describe('"all" (default) = private chats AND groups. "private" = private chats only, never WhatsApp groups — use it for "answer customers but not groups".'),
    model: z
      .string()
      .nullable()
      .optional()
      .describe('Model for its runs: "opus" (hardest reasoning), "sonnet" (balanced), "haiku" (fastest/cheapest), or an exact id. null/omit = the default.'),
    effort: z
      .enum(["low", "medium", "high", "xhigh", "max"])
      .nullable()
      .optional()
      .describe("How hard it thinks per reply. Omit unless the user asks for faster/cheaper (low) or more thorough (high+)."),
    knowledge_only: z.boolean().optional().describe("Answer ONLY from its knowledge base; never improvise beyond it."),
    stay_on_topic: z.boolean().optional().describe("Refuse anything off its subject."),
    transcribe_lang: z
      .enum(TRANSCRIBE_LANG_VALUES)
      .nullable()
      .optional()
      .describe('Voice-note transcription language: "he" = Hebrew, "auto" = detect among Hebrew, English, Arabic and Russian ONLY, or pin the language the customers speak with a code such as "es-ES", "pt-BR", "fr-FR", "en-NG" (use this for any other language: auto reads it as the nearest of those four and returns gibberish). null/omit = the default (auto).'),
    hide_bot_prefix: z.boolean().optional().describe("Send replies without the bot-name prefix, so it reads as a person."),
    require_quote: z
      .boolean()
      .optional()
      .describe("Operator chat only: ignore any message there that does not reply to (quote) one of this agent's posts. Use when staff chat in the operator group. stop/start/continue/help still work unquoted."),
    human_silence_hours: z
      .number()
      .min(0.5)
      .max(72)
      .nullable()
      .optional()
      .describe("After the owner or a team member writes in a chat, the agent stays silent in that chat for this many hours (0.5-72). null/omit = the default window."),
    auto_resume_after_minutes: z
      .number()
      .int()
      .min(0)
      .max(1440)
      .nullable()
      .optional()
      .describe(
        "When the owner writes in a chat from their own phone, the agent pauses there. By default it resumes by itself after 120 minutes with no further message from the owner. Set this to change that window (1-1440 minutes), 0 = never resume by itself (stays paused until someone resumes it), null = back to the default. Omit unless the user asks for it."
      ),
    takeover: z
      .object({
        enabled: z.boolean().optional().describe("A human may take a conversation over from the agent at all (default true)."),
        by_incoming_message: z
          .boolean()
          .optional()
          .describe("The owner writing in the chat takes it over automatically (default true). false = only an explicit takeover."),
      })
      .optional()
      .describe("Takeover defaults for new conversations. Pass only what the user asked to change."),
    operator_chat_id: z
      .string()
      .nullable()
      .optional()
      .describe(
        "The operator group/chat where the agent posts notices and questions and takes start/stop/continue commands (a real chat id you resolved). NEVER put it in trigger_chat_ids, send_chat_ids or read_message_chat_ids — it is not a customer chat. null clears it.",
      ),
    enabled: z
      .boolean()
      .optional()
      .describe(
        "true ONLY when the user explicitly asked for the agent to be ON / live now. Omit otherwise — new agents start paused. Switched through the same checked on/off toggle as the agents page (it can still be refused).",
      ),
    time_triggers: z
      .array(
        z.object({
          recurrence: z
            .object({
              freq: z
                .enum(["hourly", "daily", "weekly", "monthly"])
                .describe("How often it repeats. 'every hour' is freq=hourly — ONE trigger, never 24 daily ones."),
              hour: z
                .number()
                .int()
                .min(0)
                .max(23)
                .describe("Hour 0-23 in `timezone`. For freq=hourly this is the ANCHOR the interval counts from."),
              minute: z.number().int().min(0).max(59).describe("Minute 0-59. For freq=hourly, the minute past each hour."),
              interval: z
                .number()
                .int()
                .min(1)
                .max(24)
                .optional()
                .describe("For freq=hourly: fire every N hours (default 1). 'every two hours' = interval 2."),
              weekdays: z.array(z.number().int().min(0).max(6)).optional().describe("For freq=weekly: 0=Sun..6=Sat."),
              monthday: z.number().int().min(1).max(31).optional().describe("For freq=monthly: day of month 1-31."),
              timezone: z.string().optional().describe("IANA tz. Omit it: the user's own timezone (their workspace's) is applied. Set it ONLY when the user names a different place/zone."),
            })
            .describe("When the agent wakes."),
          prompt: z.string().min(1).describe("What the agent does on each run (e.g. summarize the chat and highlight anything important)."),
          source_chat_id: z.string().min(1).describe("The chat to READ on each run (a real chat id you resolved)."),
          dest_chat_id: z.string().optional().describe("Where the Bridge SENDS the result (a real chat id). Omit = reply in the source chat."),
          label: z.string().optional().describe('Short label, e.g. "Morning summary".'),
        }),
      )
      .optional()
      .describe(
        "The agent's WAKE-UP SCHEDULE(S), created ATOMICALLY with the agent. For 'every morning and evening' pass TWO entries (e.g. 08:00 and 20:00); 'every noon' = 13:00. ALWAYS include this for any timed/recurring task — do NOT create the agent without its time_triggers.",
      ),
    mcp_servers: z
      .array(z.string().min(1))
      .max(10)
      .optional()
      .describe(
        "OUTSIDE APPS the agent needs, e.g. [\"notion\"] or [\"linear\", \"https://mcp.example.com/mcp\"]: each entry is a library integration id (the builder's integrations list) or an https MCP URL the user gave. Each is ADDED to the agent unconnected; the user then connects it with one click (no key ever goes through this chat) and chooses its tools. Adds only — servers already on the agent are kept.",
      ),
  })
  .strict();

const UpdateArgs = CreateArgs.omit({ client_id: true, label: true, identity_prompt: true })
  .extend({
    agent_id: z.string().min(1).describe("The agent to change (it must be the caller's own)."),
    label: z.string().min(1).optional().describe("New name."),
    identity_prompt: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The FULL new system prompt (replaces the old one: carry over what should stay). To use an attached file as the prompt, pass identity_prompt_upload_id instead of copying it.",
      ),
  })
  .strict()
  .describe(
    "Change an EXISTING agent. Only the fields you pass change. trigger_chat_ids / send_chat_ids / read_* replace the current values; " +
      "time_triggers REPLACES the agent's whole schedule (pass every trigger it should have, [] removes them all).",
  );

const ListArgs = z.object({}).strict().describe("List the user's own agents.");

const GetArgs = z
  .object({ agent_id: z.string().min(1).describe("The agent to read (it must be the caller's own).") })
  .strict()
  .describe("Read ONE of the user's agents by id.");

const AddKnowledgeFileArgs = z
  .object({
    agent_id: z.string().min(1).describe("The agent to file it into (it must be the caller's own)."),
    upload_id: z
      .string()
      .min(1)
      .describe(
        "The id of a file the user attached to THIS chat — the `<uploadId>` prefix of its `attachments/<uploadId>-<name>` pod path, up to (not including) the first `-`.",
      ),
    // Not `name`: all actions share one flat schema, where it read as the agent's name.
    file_name: z.string().min(1).optional().describe("Name to store the knowledge file under. Omit to keep the original file name."),
  })
  .strict()
  .describe(
    "File a document the user attached (pdf/docx/xlsx/csv/txt/md) into an agent's knowledge base. " +
      "Images cannot be filed this way — describe their content in knowledge_text instead.",
  );

const UploadArgs = z
  .object({
    file_name: z.string().min(1).describe("Name of the file, with its extension (e.g. `faq.txt`) — the extension decides the type when mime_type is omitted."),
    file_text: z.string().min(1).optional().describe("The file's content as plain text (txt/md/csv). Use file_base64 for pdf/docx/xlsx. Pass exactly one of file_text / file_base64."),
    file_base64: z.string().min(1).optional().describe("The file's bytes, base64-encoded (any supported type). Pass exactly one of file_text / file_base64."),
    mime_type: z.string().min(1).optional().describe("Optional MIME type; omit to infer it from the file_name extension."),
  })
  .strict()
  .describe(
    "Store a file you supply inline and get back an upload_id (pdf/docx/xlsx/csv/txt/md, up to 25MB). " +
      "Pass that upload_id to add_knowledge_file, or to knowledge_upload_ids / identity_prompt_upload_id on create/update.",
  );

const actions = { create: CreateArgs, update: UpdateArgs, list: ListArgs, get: GetArgs, add_knowledge_file: AddKnowledgeFileArgs, upload: UploadArgs };

type AgentsInput =
  | ({ action: "create" } & z.infer<typeof CreateArgs>)
  | ({ action: "update" } & z.infer<typeof UpdateArgs>)
  | ({ action: "list" } & z.infer<typeof ListArgs>)
  | ({ action: "get" } & z.infer<typeof GetArgs>)
  | ({ action: "add_knowledge_file" } & z.infer<typeof AddKnowledgeFileArgs>)
  | ({ action: "upload" } & z.infer<typeof UploadArgs>);

const agentsTool = {
  name: "agents" as const,
  description: [
    "Create a WhatsApp agent on the user's Bridge in ONE call that carries EVERYTHING",
    "(instructions, incoming-trigger chats, time_triggers, read permissions) — applied atomically.",
    "SENDING is done by the Bridge, NOT by the agent — the agent returns a reply and the",
    "Bridge/schedule delivers it. The MCP is READ-ONLY. WHERE a reply goes is set here:",
    "  send_chat_ids = chats its replies go to INSTEAD of the triggering chat (omit = reply where triggered).",
    "Permissions are enforced SERVER-SIDE and default to NONE:",
    "  trigger_chat_ids = chats whose incoming messages activate it (empty = only its schedule does);",
    "  read_message_chat_ids = chats it may READ messages from (turns the read MCP on, scoped to them);",
    "  time_triggers = its wake-up schedule(s) — REQUIRED for any timed task, created with the agent.",
    "  songs / images = media-reply switches (audio / image replies into its own chat) — on ONLY when its job needs them;",
    "    the agent sees a tool only when it is on. Turn them on or off with create/update like any other field.",
    "Example — 'every morning and evening summarize GROUP X and send it to Y' →",
    "  read_message_chat_ids:[<X id>], trigger_chat_ids:[] (schedule-only),",
    "  time_triggers:[{recurrence:{freq:'daily',hour:8,minute:0},source_chat_id:<X>,dest_chat_id:<Y>,prompt:'…'},",
    "                 {recurrence:{freq:'daily',hour:20,minute:0},source_chat_id:<X>,dest_chat_id:<Y>,prompt:'…'}].",
    "Example — 'once an hour summarize GROUP X into Y' → ONE trigger:",
    "  time_triggers:[{recurrence:{freq:'hourly',hour:0,minute:0},source_chat_id:<X>,dest_chat_id:<Y>,prompt:'…'}].",
    "  'every two hours' = the same with interval:2. NEVER write one daily trigger per hour — that is 24 rows for one job.",
    "Example — 'every message that arrives from X, send it to Y' →",
    "  trigger_chat_ids:[<X id>], send_chat_ids:[<Y id>] (triggered by X, answers into Y).",
    "Resolve chat ids yourself with the `chats` tool (action search) — NEVER invent a number or ask for one you can find.",
    "Do NOT make a second call to add schedules — include them here in time_triggers.",
    "action update = change an EXISTING agent (agent_id): only the fields you pass change; time_triggers replaces its whole schedule.",
    "ATTACHED FILES go BY REFERENCE, never by copying their text: identity_prompt_upload_id = the file that is the agent's",
    "  instructions (the server reads it); knowledge_upload_ids = reference documents (filed into its knowledge base).",
    "A create that answers no chat and has no time_triggers is saved as a DISABLED draft (the result says draft:true).",
    "action add_knowledge_file = file an attached document (pdf/docx/xlsx/csv/txt/md) into an agent's knowledge base, AFTER the agent exists.",
    "action upload = store a file you supply inline (file_text, or file_base64 for binary) and get an upload_id for add_knowledge_file / knowledge_upload_ids.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    create: { readOnlyHint: false },
    update: { readOnlyHint: false },
    list: { readOnlyHint: true },
    get: { readOnlyHint: true },
    add_knowledge_file: { readOnlyHint: false },
    upload: { readOnlyHint: false },
  },
  async dispatch(input: AgentsInput, client: BlueticksSurface): Promise<ToolResult> {
    if (!client.agents) {
      return toolErrorResult(new Error("Agent creation is not available on this connection."));
    }
    // #813 — update/get/add_knowledge_file name an agent. Validation upstream is loose, so a missing
    // agent_id used to reach the service as undefined: get 404'd, update patched nothing and said ok.
    if ((input.action === "update" || input.action === "get" || input.action === "add_knowledge_file") && !input.agent_id) {
      return toolErrorResult(
        new Error(`agent_id is required for action ${input.action}: pass the "id" of the agent from action list.`),
      );
    }
    try {
      let data: unknown;
      switch (input.action) {
        case "create": {
          // customer_level/timeout_minutes: accepted-and-ignored (see the
          // DEPRECATED comment on CreateArgs) — strip before the body reaches
          // the agents service, which never read them.
          const { action: _action, customer_level: _customerLevel, timeout_minutes: _timeoutMinutes, ...body } = input;
          data = await client.agents.create(body);
          break;
        }
        case "update": {
          const { action: _action, customer_level: _customerLevel, timeout_minutes: _timeoutMinutes, ...body } = input;
          data = await client.agents.update(body);
          break;
        }
        case "list":
          data = await client.agents.list();
          break;
        case "get":
          data = await client.agents.get(input.agent_id);
          break;
        case "add_knowledge_file": {
          if (!client.agents.addKnowledgeFile) {
            return toolErrorResult(new Error("Knowledge filing is not available on this connection."));
          }
          const { action: _action, ...body } = input;
          data = await client.agents.addKnowledgeFile(body);
          break;
        }
        case "upload": {
          if (!client.agents.upload) {
            return toolErrorResult(new Error("File upload is not available on this connection."));
          }
          const { action: _action, ...body } = input;
          data = await client.agents.upload(body);
          break;
        }
        default:
          return toolErrorResult(new Error(`Unknown action: ${String((input as { action?: string }).action)}`));
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default agentsTool;

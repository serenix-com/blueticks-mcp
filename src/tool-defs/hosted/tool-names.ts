/**
 * MCP-facing tool names. Single source of truth for what Claude/ChatGPT see.
 *
 * MCP requires names match `^[a-zA-Z0-9_-]{1,64}$` — clients (Claude.ai,
 * ChatGPT) reject anything else. Every entry here corresponds 1:1 with a
 * tool def in `src/mcp-tool-defs/tools/*` and is registered
 * under the OAuth MCP server via `registerSharedToolHandlers` →
 * `dispatchSharedTool` → in-process `BlueticksSurface` adapter → v1
 * Feathers service.
 *
 * The hand-rolled hand-routed tools that pre-dated the v1-canonical
 * migration (current_date_time, send_message, scheduled-messages CRUD,
 * wa_list_chats, wa_query_messages, wa_get_chat_participants,
 * wa_load_messages_from_phone, get_message_media_by_key,
 * get_message_ack_data_by_keys, get_profile_pic) have all been deleted —
 * each is now an action under one of the `whatsapp_*` tools. The
 * legacy `WA_MCP_TOOL_ROUTING` map is kept for back-compat with any
 * external imports but is now empty.
 */
export const MCP_TOOL_NAMES = {
  agents: 'agents',
  agentSchedules: 'agent_schedules',
  audiences: 'audiences',
  boards: 'boards',
  browsePage: 'browse_page',
  calendar: 'calendar',
  campaigns: 'campaigns',
  chats: 'chats',
  contacts: 'contacts',
  engine: 'engine',
  groups: 'groups',
  images: 'images',
  reportCapabilityGap: 'report_capability_gap',
  voice: 'voice',
  qualifyLead: 'qualify_lead',
  followups: 'followups',
  tasks: 'tasks',
  scheduledMessages: 'scheduled_messages',
  suno: 'suno',
  utils: 'utils',
  webhooks: 'webhooks',
} as const;

/** Empty after the v1-canonical migration; retained for legacy imports. */
export const WA_MCP_TOOL_ROUTING: Readonly<Record<string, string>> = {};

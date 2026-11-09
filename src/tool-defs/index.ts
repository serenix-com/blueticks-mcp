// MCP tool definitions — the canonical registry.
//
// Each entry is the wire-shape of one MCP tool: name, description,
// flat input zod (for LLM-visible JSON Schema), and a `dispatch` that
// takes parsed input + a `BlueticksSurface` impl and returns a
// `ToolResult`. The Surface is the structural interface that both
// runtime consumers satisfy:
//
//   - The standalone @blueticks/mcp package (api-key path) hands tools
//     the published `blueticks` Node SDK instance — which structurally
//     matches BlueticksSurface — and HTTP round-trips every call.
//   - The OAuth MCP server in this backend hands tools an in-process
//     adapter that calls the v1 Feathers services directly (see
//     src/mcp/services/in-process-blueticks.ts), bypassing HTTP for
//     the same user identity.
//
// Tool defs intentionally only depend on `zod` + a structural type —
// no Feathers / no SDK runtime imports — so both consumers can compile
// against the same source. The standalone package submodules this
// backend repo and compiles the defs into its `dist/` at publish time.
//
// Adding a new tool: drop a new file in ./tools/, follow the existing
// shape (define a `tool` const with name/description/inputSchema/dispatch),
// then add it to TOOL_DEFS below.

import agentsTool from './tools/agents';
import agentSchedulesTool from './tools/agent-schedules';
import aiConversationTool from './tools/ai-conversation';
import audiencesTool from './tools/audiences';
import boardsTool from './tools/boards';
import calendarTool from './tools/calendar';
import campaignsTool from './tools/campaigns';
import chatsTool from './tools/chats';
import contactsTool from './tools/contacts';
import engineTool from './tools/engine';
import filesTool from './tools/files';
import groupsTool from './tools/groups';
import scheduledMessagesTool from './tools/scheduled-messages';
import sunoTool from './tools/suno';
import utilsTool from './tools/utils';
import webhooksTool from './tools/webhooks';
import imagesTool from './tools/images';
import voiceTool from './tools/voice';

import browsePageTool from './tools/browse-page';
import reportCapabilityGapTool from './tools/report-capability-gap';
import qualifyLeadTool from './tools/qualify-lead';

// `calendarTool` / `imagesTool` / `browsePageTool` / `reportCapabilityGapTool` / `voiceTool` / `qualifyLeadTool` are deliberately NOT in TOOL_DEFS (the btgpt/harness
import followupsTool from './tools/followups';
import tasksTool from './tools/tasks';

// `calendarTool` / `imagesTool` / `voiceTool` / `browsePageTool` / `reportCapabilityGapTool` / `followupsTool` / `tasksTool` (#1457, MCP-only) are deliberately NOT in TOOL_DEFS (the btgpt/harness
// tool list): they act for the calling AGENT (token caps), so they are only
// registered on the MCP server (shared-tool-handlers) where agent tokens arrive.
export const TOOL_DEFS = [
  agentsTool,
  agentSchedulesTool,
  aiConversationTool,
  audiencesTool,
  boardsTool,
  campaignsTool,
  chatsTool,
  contactsTool,
  engineTool,
  filesTool,
  groupsTool,
  scheduledMessagesTool,
  sunoTool,
  utilsTool,
  webhooksTool,
] as const;

export {
  agentsTool,
  agentSchedulesTool,
  aiConversationTool,
  audiencesTool,
  boardsTool,
  browsePageTool,
  reportCapabilityGapTool,
  qualifyLeadTool,
  followupsTool,
  tasksTool,
  calendarTool,
  campaignsTool,
  chatsTool,
  contactsTool,
  engineTool,
  filesTool,
  groupsTool,
  imagesTool,
  voiceTool,
  scheduledMessagesTool,
  sunoTool,
  utilsTool,
  webhooksTool,
};

export type { BlueticksSurface, BlueticksAudiencesApi, BlueticksBoardsApi, BlueticksCalendarApi, BlueticksCampaignsApi, BlueticksChatsApi, BlueticksContactsApi, BlueticksEnginesApi, BlueticksFilesApi, BlueticksGroupsApi, BlueticksMessagesApi, BlueticksSunoApi, BlueticksTasksApi, BlueticksUtilsApi, BlueticksWebhooksApi } from './surface';
export type { ToolResult, ToolContentBlock, ToolImageMime } from './errors';
export { toolText } from './errors';

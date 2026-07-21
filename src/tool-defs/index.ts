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

import audiencesTool from './tools/audiences';
import campaignsTool from './tools/campaigns';
import chatsTool from './tools/chats';
import contactsTool from './tools/contacts';
import engineTool from './tools/engine';
import groupsTool from './tools/groups';
import scheduledMessagesTool from './tools/scheduled-messages';
import sunoTool from './tools/suno';
import utilsTool from './tools/utils';
import webhooksTool from './tools/webhooks';

export const TOOL_DEFS = [
  audiencesTool,
  campaignsTool,
  chatsTool,
  contactsTool,
  engineTool,
  groupsTool,
  scheduledMessagesTool,
  sunoTool,
  utilsTool,
  webhooksTool,
] as const;

export {
  audiencesTool,
  campaignsTool,
  chatsTool,
  contactsTool,
  engineTool,
  groupsTool,
  scheduledMessagesTool,
  sunoTool,
  utilsTool,
  webhooksTool,
};

export type { BlueticksSurface, BlueticksAudiencesApi, BlueticksCampaignsApi, BlueticksChatsApi, BlueticksContactsApi, BlueticksEnginesApi, BlueticksGroupsApi, BlueticksMessagesApi, BlueticksScheduledMessagesApi, BlueticksSunoApi, BlueticksWebhooksApi } from './surface';
export type { ToolResult } from './errors';

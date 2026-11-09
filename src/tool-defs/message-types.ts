// The `message_types` name list shared by the REST /v1 schema, the MCP chats tool and the MCP
// surface type. Self-contained on purpose (literals + zod only): the standalone @blueticks/mcp package
// compiles this directory without the backend, so it must not import the backend or bt-common.
// The backend's services/api/v1/lib/message-types.ts re-exports it and a test pins the WA Web names
// to the bt-common type table (WA_MESSAGE_TYPE_MAP).

import { z } from 'zod';

/** The legacy v1 `message_types` names (what the API accepted before WA Web names). Never remove one. */
export const LEGACY_MESSAGE_TYPE_VALUES = [
  'chat',
  'image',
  'video',
  'document',
  'audio',
  'ptt',
  'sticker',
  'gif',
  'ptv',
  'poll_creation',
  'location',
  'vcard',
  'revoked',
] as const;

/**
 * WA Web message types (`waType`) that are NOT also a legacy name: the canonical taxonomy
 * (bt-common docs/wa-message-type-mapping.md). Static literals so the type stays a union; a test
 * pins this list to the bt-common table (WA_MESSAGE_TYPE_MAP) so it cannot drift.
 */
export const WA_WEB_ONLY_MESSAGE_TYPE_VALUES = [
  'multi_vcard',
  'protocol',
  'status_notification',
  'payment',
  'groups_v4_invite',
  'template_button_reply',
  'product',
  'order',
  'interactive',
  'interactive_response',
  'reaction',
  'reaction_enc',
  'comment',
  'pin_message',
  'poll_update',
  'keep_in_chat',
  'request_phone_number',
  'call_log',
  'newsletter_admin_invite',
  'newsletter_follower_invite',
  'event_creation',
  'sharable_event_invite',
  'event_response',
  'album',
  'music',
  'sticker-pack',
  'poll_result_snapshot',
  'rich_response',
  'group-history',
  'message_history_notice',
  'native_flow',
  'buttons_response',
  'list',
  'list_response',
  'event_edit_encrypted',
  'message_edit_encrypted',
  'poll_edit_encrypted',
  'poll_add_option_encrypted',
] as const;

/** Every name `message_types` accepts: legacy v1 names AND WA Web names (blueticks-api#6, #7). */
export const MESSAGE_TYPE_VALUES = [...LEGACY_MESSAGE_TYPE_VALUES, ...WA_WEB_ONLY_MESSAGE_TYPE_VALUES] as const;

export type MessageType = (typeof MESSAGE_TYPE_VALUES)[number];

export const MessageTypeEnum = z.enum(MESSAGE_TYPE_VALUES);

// Stand-ins for the backend-only modules the vendored tool defs import.
// scripts/sync-tool-defs.mjs rewrites those imports to this file. Each block
// names its backend source; copy the definition across when the backend's changes.

// --- services/actions/actions/voice-note-transcription.ts -------------------
export const PINNED_STT_LANGUAGES = [
  "en-US", "en-GB", "en-NG", "en-IN", "en-ZA", "es-ES", "es-MX", "pt-BR", "pt-PT", "fr-FR",
  "de-DE", "it-IT", "nl-NL", "tr-TR", "id-ID", "hi-IN", "ar-EG", "ar-SA", "ru-RU", "pl-PL",
] as const;
export type PinnedSttLanguage = (typeof PINNED_STT_LANGUAGES)[number];
export type TranscribeLang = "he" | "auto" | PinnedSttLanguage;
export const TRANSCRIBE_LANG_VALUES = ["he", "auto", ...PINNED_STT_LANGUAGES] as const;

// --- services/agent-leads/leads.types.ts ------------------------------------
export const LEAD_STAGES = ["new", "engaged", "qualified", "handed_off", "closed"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const MAX_LEAD_FIELDS = 5;
export const MAX_FIELD_NAME_CHARS = 40;
export const MAX_FIELD_VALUE_CHARS = 200;

// --- services/agent-leads/leads.ts ------------------------------------------
export type QualifyLeadOutcome =
  | { saved: true; lead_id: string; stage: LeadStage; score: "pending" | "unscored" }
  | { saved: false; error: string };

// --- mcp/services/agent-tool-fields.ts --------------------------------------
export interface ToolWebAccess {
  mode: "off" | "allowlist" | "all";
  hosts?: string[];
}

export interface AgentToolArgs {
  web_access?: ToolWebAccess;
  chat_scope?: "list" | "all_except";
  chat_block_list?: string[];
  chat_types?: "all" | "private";
  model?: string | null;
  effort?: string | null;
  knowledge_only?: boolean;
  stay_on_topic?: boolean;
  transcribe_lang?: TranscribeLang | null;
  hide_bot_prefix?: boolean;
  require_quote?: boolean;
  human_silence_hours?: number | null;
  auto_resume_after_minutes?: number | null;
  takeover?: { enabled?: boolean; by_incoming_message?: boolean };
  operator_chat_id?: string | null;
  enabled?: boolean;
}

// --- services/agent-attention/attention.types.ts ----------------------------
export const ATTENTION_KINDS = ["failed_order"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];
export const MAX_SUMMARY_CHARS = 500;

// --- services/agent-attention/attention.ts ----------------------------------
export type FlagAttentionOutcome =
  | { flagged: true; item_id: string; new: boolean }
  | { flagged: false; error: string };

// --- bt-common/engine/deny-codes.ts -----------------------------------------
export const POLICY_DENY_CODES = [
  "window_closed_needs_template", "template_required", "template_not_approved", "template_params_invalid",
  "recipient_kind_unsupported", "content_kind_unsupported", "media_too_large", "media_type_unsupported",
  "opt_in_missing", "tier_limit_reached", "throughput_limited", "context_unavailable",
  "not_my_sender", "sender_ambiguous",
] as const;

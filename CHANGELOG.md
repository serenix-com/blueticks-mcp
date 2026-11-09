# Changelog

## Unreleased

- `chats_read list_messages` now answers `no_engine_connected` ("connect WhatsApp") instead of an empty page when no WhatsApp engine is online and nothing could be read, matching the hosted connector (#1599, #21).

## 1.4.0

- The server now calls the `/v1` HTTP API through its own adapter (`src/http/`) instead of the `blueticks` SDK, so its actions match the hosted connector (#1542). `BLUETICKS_BASE_URL` overrides the API host.
- New actions: `chats_read get_latest` / `get_poll_results`, `chats_write react` / `send_button_reply`, `engine logout` / `reload`, `utils validate_phone` / `link_preview`, `contacts get_profile_picture`, and the `tasks` tool (the boards shown in the web app).
- Tool descriptions and server instructions now come from the hosted connector.
- Removed to match hosted: `groups list` (use `chats_read list` with `kinds: ["group"]`) and `contacts common_groups`.
- `agents` and `agent_schedules` are not available yet: the public API has no routes for them.
- `scheduled_messages_write` `send` / `update` now accept `send_at` with a UTC offset (e.g. `2026-12-01T09:00:00+02:00`), not only `Z` times, matching the API (#1597).

## 1.3.0

- Renamed the mixed tools to the hosted connector's names: `chats` -> `chats_read` / `chats_write`, `scheduled_messages` -> `scheduled_messages_read` / `scheduled_messages_write`. Read halves are read-only; write halves are marked destructive.
- Some hosted actions (`get_latest`, `get_poll_results`, `react`, and others) are not available here yet. They arrive in a later release (#1542).

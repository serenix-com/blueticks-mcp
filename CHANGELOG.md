# Changelog

## 1.4.0

- The server now calls the `/v1` HTTP API through its own adapter (`src/http/`) instead of the `blueticks` SDK, so its actions match the hosted connector (#1542). `BLUETICKS_BASE_URL` overrides the API host.
- New actions: `chats_read get_latest` / `get_poll_results`, `chats_write react` / `send_button_reply`, `engine logout` / `reload`, `utils validate_phone` / `link_preview`, `contacts get_profile_picture`, and the `tasks` tool (the boards shown in the web app).
- Tool descriptions and server instructions now come from the hosted connector.
- Removed to match hosted: `groups list` (use `chats_read list` with `kinds: ["group"]`) and `contacts common_groups`.
- `agents` and `agent_schedules` are not available yet: the public API has no routes for them.

## 1.3.0

- Renamed the mixed tools to the hosted connector's names: `chats` -> `chats_read` / `chats_write`, `scheduled_messages` -> `scheduled_messages_read` / `scheduled_messages_write`. Read halves are read-only; write halves are marked destructive.
- Some hosted actions (`get_latest`, `get_poll_results`, `react`, and others) are not available here yet. They arrive in a later release (#1542).

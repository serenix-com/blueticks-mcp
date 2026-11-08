# Changelog

## 1.3.0

- Renamed the mixed tools to the hosted connector's names: `chats` -> `chats_read` / `chats_write`, `scheduled_messages` -> `scheduled_messages_read` / `scheduled_messages_write`. Read halves are read-only; write halves are marked destructive.
- Some hosted actions (`get_latest`, `get_poll_results`, `react`, and others) are not available here yet. They arrive in a later release (#1542).

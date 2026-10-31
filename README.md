# @blueticks/mcp

Local (stdio) MCP server for [Blueticks](https://blueticks.co). It lets an MCP client such as Claude Code or Cursor read WhatsApp chats, send messages and schedule them from your own WhatsApp number, using a Blueticks API key.

If you use Claude or ChatGPT on the web or desktop, you do not need this package. Add the hosted connector instead: `https://api.blueticks.co/mcp` (OAuth sign-in, nothing to install). Details: https://blueticks.co/mcp

## Requirements

- Node.js 20 or newer
- A Blueticks account with a connected WhatsApp number
- A Blueticks API key. API access depends on your plan; see https://blueticks.co/pricing

## Configuration

The server reads the key from the `BLUETICKS_API_KEY` environment variable, or from `--api-key <key>`.

### Claude Code

```bash
claude mcp add blueticks --env BLUETICKS_API_KEY=your_key -- npx -y @blueticks/mcp
```

### Cursor

Add to `~/.cursor/mcp.json` (or the project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "blueticks": {
      "command": "npx",
      "args": ["-y", "@blueticks/mcp"],
      "env": { "BLUETICKS_API_KEY": "your_key" }
    }
  }
}
```

### Claude Desktop, Cline and other stdio clients

Use the same `command` / `args` / `env` block in the client's MCP config file.

## Tools

Nine tools. Each takes an `action` argument. Action names below are read from this package's tool definitions (`src/tool-defs/tools/`).

| Tool | Actions |
|---|---|
| `chats` | `list`, `search`, `get`, `list_messages`, `mark_read`, `archive`, `unarchive`, `get_media`, `get_participants`, `load_more_history`, `send_message_text`, `send_message_media`, `send_message_poll` |
| `contacts` | `list`, `common_groups` |
| `groups` | `list`, `get`, `create`, `update`, `leave` |
| `scheduled_messages` | `send`, `get`, `list`, `update`, `cancel`, `ack` |
| `audiences` | `list`, `create`, `get`, `update`, `delete`, `append_contacts`, `update_contact`, `remove_contact` |
| `campaigns` | `list`, `create`, `get`, `pause`, `resume`, `cancel` |
| `webhooks` | `list`, `create`, `get`, `update`, `delete` |
| `engine` | `status` |
| `utils` | `current_date_time` |

The hosted connector at `https://api.blueticks.co/mcp` has its own tool manifest, which can differ from this package. See https://blueticks.co/mcp for that list.

## Pricing and limits

The connector and API access are tied to your Blueticks plan. Current plans and what each includes: https://blueticks.co/pricing. Requests are made through the Blueticks API with your key, so the limits of that API and plan apply.

## How it connects to WhatsApp

Blueticks drives WhatsApp through a linked device on your own number. It does not use the Meta WhatsApp Business Cloud API, and it is not affiliated with or endorsed by WhatsApp or Meta. You are responsible for having consent from the people you message and for honoring opt-outs.

## Development

```bash
npm ci
npm run typecheck
npm run build
npm test -- --run
```

`src/tool-defs/` is a vendored copy of the backend tool definitions; see `src/tool-defs/VENDORED.md`.

## License

MIT

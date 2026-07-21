# Vendored tool definitions

**Source of truth:** `whatsapp-scheduler-backend` → `src/mcp-tool-defs` (branch `prod`).

This directory is a **checked-in copy**, not a submodule. The backend repo is
private, so CI cannot clone it as a submodule with the default token, and the
published `@blueticks/mcp` package must build self-contained (tsup inlines these
into `dist/`). The tool-defs are self-contained: they import only each other
plus `zod` / `zod-to-json-schema`.

## Re-syncing after a backend change

When the backend's `src/mcp-tool-defs` changes (new tool, changed dispatch,
SDK-surface update), copy it back over this directory:

```sh
cp -R <backend>/src/mcp-tool-defs/. src/tool-defs/
# keep this VENDORED.md, then rebuild + revalidate:
npm run typecheck && npm run build
```

Last synced from backend `prod` commit `59108cef` (2.0 SDK surface: engines.list,
messages.{send,list,getMedia,loadOlder}, offset pagination).

Note: the standalone server (`src/index.ts`) registers 9 tools and does **not**
register `suno` — `suno.ts` is retained only so the vendored copy matches the
backend verbatim.

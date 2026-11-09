# Vendored tool definitions

**Source of truth:** `whatsapp-scheduler-backend` → `src/mcp-tool-defs` (branch `prod`).

This directory is a **checked-in copy**, not a submodule. The backend repo is
private, so CI cannot clone it as a submodule with the default token, and the
published `@blueticks/mcp` package must build self-contained (tsup inlines these
into `dist/`). The tool-defs are self-contained: they import only each other
plus `zod` / `zod-to-json-schema`.

## Re-syncing after a backend change

```sh
node scripts/sync-tool-defs.mjs <path-to-whatsapp-scheduler-backend>
npm run typecheck && npm test && npm run build
```

The script copies `src/mcp-tool-defs`, plus `src/mcp/tools/{default-descriptions,tool-names}.ts` into
`hosted/` (the hosted connector's descriptions and server instructions). It rewrites the few imports
that point outside the tool-defs onto `backend-shims.ts`, applies the strict-typing fixes, and fails
if any outside import is left.

Last synced from backend `prod` commit `14ff1cf`.

The tools call the `BlueticksSurface` interface (`surface.ts`). Here it is implemented by
`src/http/surface.ts` over the `/v1` routes, mirroring the backend's in-process adapter
(`src/mcp/services/in-process-blueticks.ts`). `src/manifest.ts` lists the hosted API-key defaults;
the other vendored tools (agents, suno, calendar, ...) are kept so the copy matches the backend but
are not registered.

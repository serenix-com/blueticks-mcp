#!/usr/bin/env node
// Re-vendor the backend's MCP tool definitions into src/tool-defs.
//
//   node scripts/sync-tool-defs.mjs <path-to-backend>/src/mcp-tool-defs
//
// Copies every non-test .ts file, then points the few imports that reach outside
// src/mcp-tool-defs (backend-only modules the published package cannot ship) at
// src/tool-defs/backend-shims.ts. Keep that file in step with the backend when a
// sync changes what those imports provide; the typecheck fails if it drifts.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const src = process.argv[2];
if (!src || !existsSync(join(src, "index.ts"))) {
  console.error("usage: node scripts/sync-tool-defs.mjs <backend>/src/mcp-tool-defs");
  process.exit(1);
}
const dest = resolve("src/tool-defs");
const KEEP = new Set(["VENDORED.md", "backend-shims.ts"]);
// Not imported by any tool; it only types a bt-common map the package never needs.
const SKIP = new Set(["policy-deny-codes.ts"]);
// Backend-only modules the tool defs import, all served by backend-shims.ts.
const EXTERNAL = [
  "bt-common/engine",
  "mcp/services/agent-tool-fields",
  "services/agent-leads/leads",
  "services/agent-leads/leads.types",
  "services/actions/actions/voice-note-transcription",
];

for (const name of readdirSync(dest)) {
  if (!KEEP.has(name)) rmSync(join(dest, name), { recursive: true, force: true });
}

const copied = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__") walk(full);
      continue;
    }
    if (!name.endsWith(".ts") || name.endsWith(".test.ts") || SKIP.has(name)) continue;
    const rel = relative(src, full);
    const out = join(dest, rel);
    cpSync(full, out);
    copied.push(out);
  }
};
walk(src);

// The hosted default manifest's listed descriptions and server instructions
// (src/mcp/tools, next to mcp-tool-defs). Both files import nothing else.
const hostedSrc = resolve(src, "..", "mcp", "tools");
for (const name of ["default-descriptions.ts", "tool-names.ts"]) {
  const out = join(dest, "hosted", name);
  cpSync(join(hostedSrc, name), out);
  copied.push(out);
}

const importRe = /(from\s+["'])((?:\.\.\/)+)([^"']+)(["'])/g;
for (const file of copied) {
  const depth = relative(dest, file).split(sep).length - 1;
  const text = readFileSync(file, "utf8");
  const next = text.replace(importRe, (all, open, ups, path, close) => {
    if (!EXTERNAL.includes(path)) return all;
    const shim = depth === 0 ? "./backend-shims" : `${"../".repeat(depth)}backend-shims`;
    return `${open}${shim}${close}`;
  });
  if (next !== text) writeFileSync(file, next);
}

// This package compiles with `noUncheckedIndexedAccess`; the backend does not.
// These rewrites make the few indexed reads it flags explicit. A `from` that is
// no longer present means the backend changed that line: re-check it, then
// update or drop the entry (and upstream the fix if it still applies).
const STRICT_FIXES = [
  {
    file: "errors.ts",
    from: 'const top = segments.length === 0 ? "(root)" : FIELD_NAME.test(segments[0]) ? segments[0] : "(field)";',
    to: 'const head = segments[0];\n  const top = head === undefined ? "(root)" : FIELD_NAME.test(head) ? head : "(field)";',
  },
  {
    file: "tools/utils.ts",
    from: "WEEKDAYS.indexOf(parts.weekday)",
    to: "WEEKDAYS.indexOf(parts.weekday ?? '')",
  },
  {
    file: "tools/utils.ts",
    from: "const [Y, M, D] = dateStr.split('-').map(Number);",
    to: "const [Y = 1970, M = 1, D = 1] = dateStr.split('-').map(Number);",
  },
];
for (const fix of STRICT_FIXES) {
  const file = join(dest, fix.file);
  const text = readFileSync(file, "utf8");
  if (!text.includes(fix.from)) {
    console.error(`strict fix no longer matches ${fix.file}: ${fix.from}`);
    process.exit(1);
  }
  writeFileSync(file, text.replace(fix.from, fix.to));
}

const leftovers =copied.filter((f) => /from\s+["'](?:\.\.\/){1,}(?:bt-common|mcp|services|claude-agents)\//.test(readFileSync(f, "utf8")));
if (leftovers.length > 0) {
  console.error("imports outside src/mcp-tool-defs that backend-shims.ts does not cover:");
  for (const f of leftovers) console.error("  " + relative(process.cwd(), f));
  process.exit(1);
}
console.log(`synced ${copied.length} files into ${relative(process.cwd(), dest)}`);

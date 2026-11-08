import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// server.json is what the CI `registry` job publishes to the MCP Registry. It must
// track package.json on every release, or the registry lists a version npm lacks.

interface PackageJson {
  version: string;
}
interface ServerJson {
  name: string;
  description: string;
  version: string;
  packages?: unknown;
  remotes: Array<{ type: string; url: string }>;
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as T;
}

describe("server.json", () => {
  const pkg = readJson<PackageJson>("../package.json");
  const server = readJson<ServerJson>("../server.json");

  // The live registry entry is the remote-only co.blueticks/blueticks (DNS-auth
  // namespace). package.json mcpName only matters for an npm `packages` entry,
  // which server.json deliberately does not carry.
  it("uses the co.blueticks registry name", () => {
    expect(server.name).toBe("co.blueticks/blueticks");
  });

  it("tracks the package version", () => {
    expect(server.version).toBe(pkg.version);
  });

  it("is remote-only: no npm packages entry, one streamable-http remote", () => {
    expect(server.packages).toBeUndefined();
    expect(server.remotes).toEqual([
      { type: "streamable-http", url: "https://api.blueticks.co/mcp" },
    ]);
  });

  it("keeps the description within the registry's 100-char limit", () => {
    expect(server.description.length).toBeLessThanOrEqual(100);
  });
});

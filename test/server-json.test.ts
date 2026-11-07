import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// server.json is what the CI `registry` job publishes to the MCP Registry. It must
// track package.json on every release, or the registry lists a version npm lacks.

interface PackageJson {
  version: string;
  mcpName: string;
}
interface ServerJson {
  name: string;
  description: string;
  version: string;
  packages: Array<{ registryType: string; identifier: string; version: string }>;
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as T;
}

describe("server.json", () => {
  const pkg = readJson<PackageJson>("../package.json");
  const server = readJson<ServerJson>("../server.json");

  it("uses the package mcpName as the registry name", () => {
    expect(server.name).toBe(pkg.mcpName);
  });

  it("tracks the package version in both places", () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0]?.version).toBe(pkg.version);
  });

  it("points at the npm package", () => {
    expect(server.packages[0]).toMatchObject({ registryType: "npm", identifier: "@blueticks/mcp" });
  });

  it("keeps the description within the registry's 100-char limit", () => {
    expect(server.description.length).toBeLessThanOrEqual(100);
  });
});

import { Blueticks } from "blueticks";
import pkg from "../package.json";

/**
 * How this server identifies itself to the Blueticks API.
 *
 * WHY. This server authenticates with an API KEY against /v1, so it reaches neither
 * `mcp_oauth_approved` (emitted on the OAuth route) nor `mcp_tool_used` (emitted from
 * the JWT path). Local installs were therefore absent from every published MCP number,
 * and every adoption rate had a guessed denominator.
 *
 * The Blueticks SDK appends this as a User-Agent SUFFIX, producing
 * `blueticks-node/<v> blueticks-mcp/<v>`. The backend counts a DELIMITED
 * `blueticks-mcp/<semver>` token, so the leading space is what makes it match — a bare
 * substring check would also have matched unrelated vendors and was rejected there.
 *
 * Kept in lockstep with package.json by a test, so the reported version cannot drift
 * from the published one.
 */
export const MCP_CLIENT_UA = `blueticks-mcp/${pkg.version}`;

export function resolveApiKey(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): string {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--api-key" && i + 1 < argv.length) return argv[i + 1]!;
    if (a?.startsWith("--api-key=")) return a.slice("--api-key=".length);
  }
  const fromEnv = env.BLUETICKS_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  throw new Error(
    "BLUETICKS_API_KEY not set. Either export it or pass --api-key BLUETICKS_API_KEY See https://github.com/serenix-com/blueticks-mcp#configuration",
  );
}

let cached: Blueticks | undefined;

export function getClient(apiKey: string, baseUrl?: string): Blueticks {
  if (!cached) {
    cached = new Blueticks(
      baseUrl
        ? { apiKey, baseUrl, userAgent: MCP_CLIENT_UA }
        : { apiKey, userAgent: MCP_CLIENT_UA },
    );
  }
  return cached;
}

/** test-only — reset the singleton between cases. */
export function _resetClientForTests(): void {
  cached = undefined;
}

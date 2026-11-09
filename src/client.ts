import pkg from "../package.json";
import { createHttpSurface, type HttpSurface } from "./http/surface";
import { HttpTransport, type TransportOptions } from "./http/transport";

/**
 * How this server identifies itself to the Blueticks API.
 *
 * WHY. This server authenticates with an API KEY against /v1, so it reaches neither
 * `mcp_oauth_approved` (emitted on the OAuth route) nor `mcp_tool_used` (emitted from
 * the JWT path). Local installs were therefore absent from every published MCP number,
 * and every adoption rate had a guessed denominator. The backend counts a request
 * whose User-Agent carries a DELIMITED `blueticks-mcp/<semver>` token.
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

/** The surface the tools call, over the /v1 REST API. */
export function createClient(
  apiKey: string,
  opts: Pick<TransportOptions, "baseUrl" | "fetch" | "timeoutMs" | "maxRetries"> = {},
): HttpSurface {
  return createHttpSurface(
    new HttpTransport({
      apiKey,
      userAgent: MCP_CLIENT_UA,
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    }),
  );
}

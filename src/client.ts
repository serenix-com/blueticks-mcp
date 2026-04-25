import { Blueticks } from "blueticks";

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
    "BLUETICKS_API_KEY not set. Either export it or pass --api-key bt_live_... See https://github.com/serenix-com/blueticks-mcp#configuration",
  );
}

let cached: Blueticks | undefined;

export function getClient(apiKey: string): Blueticks {
  if (!cached) cached = new Blueticks({ apiKey });
  return cached;
}

/** test-only — reset the singleton between cases. */
export function _resetClientForTests(): void {
  cached = undefined;
}

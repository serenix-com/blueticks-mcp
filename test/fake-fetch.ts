// A recording fetch for the /v1 adapter tests. Each call is answered by the
// first route whose method and path match; unmatched calls are a 404 envelope.

export interface SeenRequest {
  method: string;
  path: string;
  query: Record<string, string[]>;
  body: unknown;
  headers: Headers;
}

export interface FakeRoute {
  method: string;
  path: string | RegExp;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function fakeFetch(routes: FakeRoute[] = []): { fetch: typeof fetch; seen: SeenRequest[] } {
  const seen: SeenRequest[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const query: Record<string, string[]> = {};
    for (const [k, v] of url.searchParams) (query[k] ??= []).push(v);
    const method = init?.method ?? "GET";
    const raw = typeof init?.body === "string" ? init.body : undefined;
    seen.push({
      method,
      path: url.pathname,
      query,
      body: raw === undefined ? undefined : (JSON.parse(raw) as unknown),
      headers: new Headers(init?.headers),
    });
    const route = routes.find(
      (r) => r.method === method && (typeof r.path === "string" ? r.path === url.pathname : r.path.test(url.pathname)),
    );
    if (!route) {
      return new Response(
        JSON.stringify({ success: false, error: { code: "not_found", message: "no route", request_id: "req_404" } }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    const status = route.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(route.body ?? {}), {
      status,
      headers: { "content-type": "application/json", ...route.headers },
    });
  };
  return { fetch: fetchFn, seen };
}

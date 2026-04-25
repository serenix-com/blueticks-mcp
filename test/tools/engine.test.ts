import { describe, it, expect, vi } from "vitest";
import engineTool from "../../src/tools/engine";

const makeMockClient = () => ({
  engines: {
    status: vi.fn().mockResolvedValue({ connected: true, state: "CONNECTED" }),
    logout: vi.fn().mockResolvedValue({ ok: true }),
    reload: vi.fn().mockResolvedValue({ ok: true }),
  },
});

describe("whatsapp_engine tool", () => {
  it("has the expected name and 3 actions", () => {
    expect(engineTool.name).toBe("whatsapp_engine");
    expect((engineTool.inputSchema.properties.action as { enum: string[] }).enum).toEqual([
      "status",
      "logout",
      "reload",
    ]);
  });

  it("dispatches status -> client.engines.status", async () => {
    const client = makeMockClient() as any;
    const result = await engineTool.dispatch({ action: "status" }, client);
    expect(client.engines.status).toHaveBeenCalledOnce();
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
      connected: true,
      state: "CONNECTED",
    });
  });

  it("dispatches logout -> client.engines.logout", async () => {
    const client = makeMockClient() as any;
    await engineTool.dispatch({ action: "logout" }, client);
    expect(client.engines.logout).toHaveBeenCalledOnce();
  });

  it("dispatches reload -> client.engines.reload", async () => {
    const client = makeMockClient() as any;
    await engineTool.dispatch({ action: "reload" }, client);
    expect(client.engines.reload).toHaveBeenCalledOnce();
  });

  it("maps APIError to isError result", async () => {
    const { APIError } = await import("blueticks");
    const client = {
      engines: {
        status: vi
          .fn()
          .mockRejectedValue(
            new APIError({ statusCode: 503, code: "internal_error", message: "no engine", requestId: "r1" } as any),
          ),
      },
    } as any;
    const result = await engineTool.dispatch({ action: "status" }, client);
    expect(result.isError).toBe(true);
  });
});

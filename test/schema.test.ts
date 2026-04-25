import { describe, it, expect } from "vitest";
import { z } from "zod";
import { actionSchemaToJsonSchema } from "../src/schema";

describe("actionSchemaToJsonSchema", () => {
  it("produces a flat schema with an action enum and merged properties", () => {
    const json = actionSchemaToJsonSchema({
      list: z.object({ limit: z.number().int().optional() }).strict(),
      get: z.object({ id: z.string() }).strict(),
    });

    expect(json.type).toBe("object");
    expect(json.required).toEqual(["action"]);
    expect(json.additionalProperties).toBe(false);

    const props = json.properties as Record<string, any>;
    expect(props.action).toEqual({ type: "string", enum: ["list", "get"] });
    expect(props.limit).toEqual({ type: "integer" });
    expect(props.id).toEqual({ type: "string" });
  });

  it("rejects empty action map", () => {
    expect(() => actionSchemaToJsonSchema({})).toThrow(/at least one action/);
  });

  it("does not emit top-level combinators forbidden by the Anthropic API", () => {
    const json = actionSchemaToJsonSchema({
      send: z.object({ to: z.string() }).strict(),
      get: z.object({ id: z.string() }).strict(),
    });
    expect(json).not.toHaveProperty("oneOf");
    expect(json).not.toHaveProperty("anyOf");
    expect(json).not.toHaveProperty("allOf");
  });
});

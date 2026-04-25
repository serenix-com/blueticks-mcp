import { describe, it, expect } from "vitest";
import { z } from "zod";
import { actionSchemaToJsonSchema } from "../src/schema";

describe("actionSchemaToJsonSchema", () => {
  it("produces a oneOf schema discriminated on action", () => {
    const json = actionSchemaToJsonSchema({
      list: z.object({ limit: z.number().int().optional() }).strict(),
      get: z.object({ id: z.string() }).strict(),
    });

    expect(json.type).toBe("object");
    expect(json.oneOf).toHaveLength(2);

    const branches = json.oneOf as Array<{ properties: any; required?: string[] }>;
    const list = branches[0]!;
    const get = branches[1]!;
    expect(list.properties.action).toEqual({ type: "string", const: "list" });
    expect(list.properties.limit).toEqual({ type: "integer" });
    expect(list.required).toEqual(["action"]);

    expect(get.properties.action).toEqual({ type: "string", const: "get" });
    expect(get.properties.id).toEqual({ type: "string" });
    expect(get.required).toEqual(expect.arrayContaining(["action", "id"]));
  });

  it("rejects empty action map", () => {
    expect(() => actionSchemaToJsonSchema({})).toThrow(/at least one action/);
  });
});

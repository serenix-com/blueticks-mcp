import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { buildToolList } from "../src/manifest";
import { actionSchemaToJsonSchema, normalizeExclusiveBounds } from "../src/tool-defs/schema";

/** Paths of every boolean `exclusiveMinimum` / `exclusiveMaximum` anywhere in a JSON value. */
function booleanExclusiveBounds(node: unknown, path = "$"): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => booleanExclusiveBounds(child, `${path}[${i}]`));
  }
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) => {
    const here = `${path}.${key}`;
    const own =
      (key === "exclusiveMinimum" || key === "exclusiveMaximum") && typeof value === "boolean" ? [here] : [];
    return [...own, ...booleanExclusiveBounds(value, here)];
  });
}

describe("tool input schemas never carry a boolean exclusiveMinimum/exclusiveMaximum", () => {
  it("holds for every advertised tool", () => {
    for (const tool of buildToolList()) {
      expect(booleanExclusiveBounds(tool.inputSchema), tool.name).toEqual([]);
    }
  });

  it("chats_read / chats_write advertise fanout_limit with a numeric minimum", () => {
    for (const name of ["chats_read", "chats_write"]) {
      const tool = buildToolList().find((t) => t.name === name);
      expect(tool?.inputSchema.properties, name).toMatchObject({
        fanout_limit: { type: "integer", minimum: 1 },
      });
    }
  });
});

describe("normalizeExclusiveBounds", () => {
  it("rewrites the openApi3 boolean form to the numeric form", () => {
    const raw = zodToJsonSchema(z.object({ n: z.number().int().positive(), m: z.number().lt(10) }), {
      target: "openApi3",
    });
    expect(booleanExclusiveBounds(raw)).not.toEqual([]); // proves the generator still emits it
    expect(normalizeExclusiveBounds(raw)).toMatchObject({
      properties: {
        n: { type: "integer", exclusiveMinimum: 0 },
        m: { type: "number", exclusiveMaximum: 10 },
      },
    });
  });

  it("drops a false flag and leaves numeric and unrelated keys alone", () => {
    expect(normalizeExclusiveBounds({ minimum: 3, exclusiveMinimum: false, type: "number" })).toEqual({
      minimum: 3,
      type: "number",
    });
    expect(normalizeExclusiveBounds({ exclusiveMinimum: 2, nested: [{ maximum: 5 }] })).toEqual({
      exclusiveMinimum: 2,
      nested: [{ maximum: 5 }],
    });
  });

  it("is applied by actionSchemaToJsonSchema", () => {
    const schema = actionSchemaToJsonSchema({ read: z.object({ n: z.number().positive() }) });
    expect(booleanExclusiveBounds(schema)).toEqual([]);
    expect(schema.properties.n).toEqual({ type: "number", exclusiveMinimum: 0 });
  });
});

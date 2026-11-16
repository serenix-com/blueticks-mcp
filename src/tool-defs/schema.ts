import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * zod-to-json-schema's `openApi3` target renders `.positive()` / `.gt()` / `.lt()` in the
 * OpenAPI 3.0 style: a BOOLEAN `exclusiveMinimum` / `exclusiveMaximum` beside `minimum` /
 * `maximum`. The Anthropic API (and any draft-07 validator) requires a NUMBER there and
 * rejects the whole tool ("exclusiveMinimum must be number"), which drops the tool from the
 * client. Rewrite the boolean form to the numeric one, recursively, so no tool can emit it:
 * `{minimum: 0, exclusiveMinimum: true}` -> `{exclusiveMinimum: 0}`; `false` -> key dropped.
 */
export function normalizeExclusiveBounds(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(normalizeExclusiveBounds);
  }
  if (!isRecord(node)) {
    return node;
  }
  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = normalizeExclusiveBounds(value);
  }
  for (const [exclusiveKey, boundKey] of [
    ["exclusiveMinimum", "minimum"],
    ["exclusiveMaximum", "maximum"],
  ] as const) {
    const flag = out[exclusiveKey];
    if (typeof flag !== "boolean") continue;
    const bound = out[boundKey];
    delete out[exclusiveKey];
    if (flag && typeof bound === "number") {
      delete out[boundKey];
      out[exclusiveKey] = bound;
    }
  }
  return out;
}

export interface ActionJsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

/**
 * Convert `{ <actionName>: zodSchemaForArgs }` into a flat JSON Schema.
 *
 * The Anthropic API rejects top-level `oneOf`/`anyOf`/`allOf` in tool
 * input schemas, so we advertise a single object schema:
 *   - `action` is a required string enum of all action names
 *   - every branch's properties are merged at the top level (all optional)
 * Per-action argument validation is enforced server-side by the Blueticks API.
 */
export function actionSchemaToJsonSchema(
  actions: Record<string, z.ZodTypeAny>,
): ActionJsonSchema {
  const entries = Object.entries(actions);
  if (entries.length === 0) {
    throw new Error("actionSchemaToJsonSchema requires at least one action");
  }

  const mergedProperties: Record<string, unknown> = {
    action: { type: "string", enum: entries.map(([name]) => name) },
  };

  for (const [, schema] of entries) {
    const json = normalizeExclusiveBounds(zodToJsonSchema(schema, { target: "openApi3" }));
    const properties = isRecord(json) && isRecord(json.properties) ? json.properties : {};
    for (const [propName, propSchema] of Object.entries(properties)) {
      if (!(propName in mergedProperties)) {
        mergedProperties[propName] = propSchema;
      }
    }
  }

  return {
    type: "object",
    properties: mergedProperties,
    required: ["action"],
    additionalProperties: false,
  };
}

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

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
    const jsonAny = zodToJsonSchema(schema, { target: "openApi3" }) as {
      properties?: Record<string, unknown>;
    };
    for (const [propName, propSchema] of Object.entries(jsonAny.properties ?? {})) {
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

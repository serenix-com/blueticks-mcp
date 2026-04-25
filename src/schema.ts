import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface ActionJsonSchema {
  type: "object";
  oneOf: Array<{
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  }>;
}

/**
 * Convert `{ <actionName>: zodSchemaForArgs }` into a JSON Schema whose
 * `oneOf` branches are each tagged with `action: <const>`.
 */
export function actionSchemaToJsonSchema(
  actions: Record<string, z.ZodTypeAny>,
): ActionJsonSchema {
  const entries = Object.entries(actions);
  if (entries.length === 0) {
    throw new Error("actionSchemaToJsonSchema requires at least one action");
  }

  const branches = entries.map(([name, schema]) => {
    const jsonAny = zodToJsonSchema(schema, { target: "openApi3" }) as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    const properties = { action: { type: "string", const: name }, ...(jsonAny.properties ?? {}) };
    const required = ["action", ...(jsonAny.required ?? [])];
    return { type: "object" as const, properties, required, additionalProperties: false as const };
  });

  return { type: "object", oneOf: branches };
}

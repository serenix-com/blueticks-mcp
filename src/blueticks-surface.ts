import type { Blueticks } from "blueticks";

/**
 * The public Blueticks API surface that MCP tool builders depend on.
 *
 * Tool builders take a `BlueticksSurface` rather than the concrete
 * `Blueticks` SDK class so multiple transports can drive the same tools:
 *
 *   - The standalone MCP server hands them a real `Blueticks` instance,
 *     which goes over HTTPS to the Blueticks v1 API.
 *   - The OAuth-wrapped MCP server (in the backend) hands them an
 *     in-process adapter that calls Feathers services directly,
 *     bypassing the HTTP hop while preserving the same shape.
 *
 * The interface is derived structurally from `Blueticks` via `Pick`
 * over an explicit list of resource keys — adding a resource to the
 * SDK does NOT auto-add it here; that's a deliberate opt-in. Adding
 * a method to an *existing* resource flows automatically, and the
 * in-process adapter must add a matching implementation or `tsc`
 * fails the build (drift caught at compile time).
 */
export type BlueticksSurface = Pick<
  Blueticks,
  | "audiences"
  | "campaigns"
  | "chats"
  | "contacts"
  | "engines"
  | "groups"
  | "messages"
  | "utils"
  | "webhooks"
>;

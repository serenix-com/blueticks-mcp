import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";
import type { BrowseImageOutcome } from "../surface";

const actions = {
  read: z.object({
    url: z.string().min(1).max(2048),
  }).strict(),
  image: z.object({
    url: z.string().min(1).max(2048),
  }).strict(),
};

type BrowsePageInput =
  | ({ action: "read" } & z.infer<typeof actions.read>)
  | ({ action: "image" } & z.infer<typeof actions.image>);

const browsePageTool = {
  name: "browse_page" as const,
  description: [
    "Read a web page the way a browser shows it — JavaScript included — as markdown, or look at one picture (agent sessions with web access).",
    "",
    "Actions:",
    "  - read: {url} opens url in a real browser and returns {read: true, url, title, markdown, truncated, links}, or",
    "    {read: false, error, hint}. Only the websites this agent may read can be opened; links lists the page's links",
    "    to those sites, so you can open a product or category page next.",
    "  - image: {url} fetches one picture (JPEG, PNG, WebP or GIF, 1 MB at most, https only) from a site this agent may read and",
    "    returns it as an image you can see, with {image: true, url, mimeType, bytes}. A refusal is {image: false, error, hint}.",
    "",
    "When: a site that WebFetch shows empty or only as \"loading\" (shops and apps built with JavaScript), or when you",
    "need what the visitor actually sees (prices, products, opening hours). At most 5 pages per reply and 8 image fetches in any two minutes.",
    "Use image to compare a picture (a customer's photo with a product photo on the shop); say what you see, not more.",
    "Quote only what the page says; if it does not have the answer, say so.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    read: { readOnlyHint: true },
    image: { readOnlyHint: true },
  },
  async dispatch(input: BrowsePageInput, client: Pick<BlueticksSurface, "browsePage">): Promise<ToolResult> {
    try {
      if (!client.browsePage) {
        throw Object.assign(new Error("browse_page is only available to agent sessions with web access."), { code: 400, name: "BadRequest" });
      }
      if (input.action === "image") {
        return imageResult(await client.browsePage.image({ url: input.url }));
      }
      const { action: _a, ...body } = input;
      const data = await client.browsePage.read(body);
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

/** A picture: a small text block (where it came from, its size) then the image block; a refusal is text only. */
function imageResult(outcome: BrowseImageOutcome): ToolResult {
  if (!outcome.image) return { content: [{ type: "text", text: JSON.stringify(outcome) }] };
  return {
    content: [
      { type: "text", text: JSON.stringify({ image: true, url: outcome.url, mimeType: outcome.mimeType, bytes: outcome.bytes }) },
      { type: "image", data: outcome.data, mimeType: outcome.mimeType },
    ],
  };
}

export default browsePageTool;

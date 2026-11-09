import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const actions = {
  combine: z.object({
    chat_id: z.string().min(1),
    message_keys: z.array(z.string().min(1)).max(6).optional(),
    image_urls: z.array(z.string().url()).max(6).optional(),
    instruction: z.string().min(1).max(4000),
  }).strict(),
};

type ImagesInput = { action: "combine" } & z.infer<typeof actions.combine>;

const imagesTool = {
  name: "images" as const,
  description: [
    "Create an image from the customer's photos and other images, and send it into the chat (agent sessions).",
    "",
    "Actions:",
    "  - combine: {chat_id, message_keys?, image_urls?, instruction} starts making ONE image and returns at once.",
    "      message_keys = keys of image messages in chat_id (the customer's photos); image_urls = public https",
    "      image urls (e.g. product photos from a store page). Images are numbered in that order: message_keys",
    "      first, then image_urls — refer to them as image 1, image 2, … in the instruction",
    "      (e.g. 'the person in image 1 wearing the shirt from image 2 and the trousers from image 3; keep",
    "      the face, body, pose and background of image 1'). At most 6 images.",
    "      The finished image arrives in chat_id in about 1-2 minutes; a failure arrives there as a text message.",
    "      While a job for chat_id runs, a second one returns {started: false}.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    combine: {},
  },
  async dispatch(input: ImagesInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      if (!client.images) {
        throw Object.assign(new Error("images is only available to agent sessions."), { code: 400, name: "BadRequest" });
      }
      const { action: _a, ...body } = input;
      const data = await client.images.combine(body);
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default imagesTool;

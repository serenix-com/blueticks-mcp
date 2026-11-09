import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const actions = {
  new_conversation: z
    .object({
      // Optional short topic/title for the new conversation (also seeds the
      // conversation title). The group itself is created server-side.
      topic: z.string().max(200).optional(),
    })
    .strict(),
};

type AiConversationInput = { action: "new_conversation"; topic?: string };

const aiConversationTool = {
  name: "ai_conversation" as const,
  description: [
    "Start a NEW, separate Blueticks AI conversation for the user. Use this ONLY",
    "when the user explicitly asks to open/start a NEW or SEPARATE AI conversation,",
    "chat, or group with you (e.g. \"open me a new conversation\", \"start a fresh",
    "AI chat\", \"make a new AI group\"). Do NOT use it to reply within the current",
    "conversation.",
    "",
    "It creates a dedicated WhatsApp group linked to a fresh AI conversation. In",
    "your reply, tell the user the new group's name so they know where to find it.",
    "",
    "Actions:",
    "  - new_conversation: create the new conversation + its WhatsApp group.",
    "      Optional `topic` seeds the conversation title. Returns",
    "      { conversationId, groupId, groupName }.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    new_conversation: {},
  },
  async dispatch(input: AiConversationInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      if (!client.aiConversations) {
        return toolErrorResult(
          Object.assign(new Error("AI-conversation tools are not available in this context."), {
            code: 502,
            name: "BadGateway",
          }),
        );
      }
      switch (input.action) {
        case "new_conversation": {
          const data = await client.aiConversations.create({ topic: input.topic });
          return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
        }
      }
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default aiConversationTool;

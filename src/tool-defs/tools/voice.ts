import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const actions = {
  say: z.object({
    chat_id: z.string().min(1),
    text: z.string().min(1).max(4000),
  }).strict(),
};

type VoiceInput = { action: "say" } & z.infer<typeof actions.say>;

const voiceTool = {
  name: "voice" as const,
  description: [
    "Answer with a WhatsApp VOICE NOTE instead of text, the way a person answers a voice message (agent sessions).",
    "",
    "Actions:",
    "  - say: {chat_id, text} speaks `text` in a natural voice (Hebrew, English, Arabic or Russian — by the text's own language) and sends it into chat_id as a voice note.",
    "",
    "When: as the agent's instructions say (their VOICE MESSAGES rule). Without such a rule: when the customer sent a voice",
    "note, or asked to talk / get a voice message; otherwise answer in text.",
    "The bridge registers this voice note as the agent's own send. It IS the answer: after {sent: true} return an EMPTY",
    "`reply` — no summary and no \"I sent a voice message\" note.",
    "Write `text` the way people speak — short sentences, no lists, symbols or markdown. Links, phone numbers and codes",
    "can't be clicked or copied from audio: only those go in the `reply`, on their own.",
    "On {sent: false} answer in text as usual.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    say: {},
  },
  async dispatch(input: VoiceInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      if (!client.voice) {
        throw Object.assign(new Error("voice is only available to agent sessions."), { code: 400, name: "BadRequest" });
      }
      const { action: _a, ...body } = input;
      const data = await client.voice.say(body);
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default voiceTool;

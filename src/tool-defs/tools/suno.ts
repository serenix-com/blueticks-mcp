import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

const actions = {
  generate_song: z.object({
    lyrics: z.string().min(1),
    style: z.string().min(1),
    negative_style: z.string().optional(),
    vocal_gender: z.enum(["m", "f"]).optional(),
    weirdness: z.number().min(0).max(1).optional(),
    style_influence: z.number().min(0).max(1).optional(),
    audio_influence: z.number().min(0).max(1).optional(),
    instrumental: z.boolean().optional(),
    model: z.string().optional(),
    title: z.string().optional(),
    upload_id: z.string().optional(),
    confirmed_with_user: z.boolean(),
  }).strict(),
  get_song: z.object({ clip_id: z.string().min(1) }).strict(),
  upload_audio: z.object({
    audio_url: z.string().url().optional(),
    audio_base64: z.string().optional(),
    file_name: z.string().optional(),
  }).strict(),
  get_account: z.object({}).strict(),
};

type SunoInput =
  | {
      action: "generate_song";
      lyrics: string;
      style: string;
      negative_style?: string;
      vocal_gender?: "m" | "f";
      weirdness?: number;
      style_influence?: number;
      audio_influence?: number;
      instrumental?: boolean;
      model?: string;
      title?: string;
      upload_id?: string;
      confirmed_with_user: boolean;
    }
  | { action: "get_song"; clip_id: string }
  | { action: "upload_audio"; audio_url?: string; audio_base64?: string; file_name?: string }
  | { action: "get_account" };

const sunoTool = {
  name: "suno" as const,
  description: [
    "Generate songs with Suno AI from lyrics + a style description. Two flows:",
    "",
    "  A) Lyrics → song (no audio needed):",
    "     confirm the plan with the user (see below) → generate_song → poll get_song",
    "     until status is 'complete' to get audio_url.",
    "",
    "  B) Cover the user's own recording (they sent an audio message):",
    "     1. chats get_media on the audio message to get its `url`,",
    "     2. suno upload_audio with that `audio_url` → returns upload_id,",
    "     3. confirm the plan with the user (see below),",
    "     4. suno generate_song with that upload_id (+ lyrics + style),",
    "     5. poll get_song until complete.",
    "",
    "CONFIRM BEFORE GENERATING — generation spends Suno credits, so generate_song is",
    "gated on confirmed_with_user. Before calling it you MUST, in your reply:",
    "  1. show the user the exact lyrics you will use (and, for a cover, say you will",
    "     use their recording), plus the style you propose;",
    "  2. ask their preferences for: vocal gender (male/female), weirdness",
    "     (safe ≈ 0.2 / balanced ≈ 0.5 / wild ≈ 0.8), style influence",
    "     (subtle ≈ 0.25 / moderate ≈ 0.5 / strong ≈ 0.8) and — covers only —",
    "     audio influence, i.e. how closely to follow their recording",
    "     (subtle ≈ 0.25 / moderate ≈ 0.5 / strong ≈ 0.8).",
    "Only after the user explicitly agrees, call generate_song with",
    "confirmed_with_user: true and the agreed values. If they leave a setting to you,",
    "pick a sensible value and say which you picked.",
    "",
    "Actions:",
    "  - generate_song: create a song. Args: lyrics, style (genre/mood text),",
    "      confirmed_with_user (required — true only after the user approved the plan),",
    "      and optional vocal_gender ('m'|'f'), weirdness (0-1), style_influence (0-1),",
    "      audio_influence (0-1, covers only), instrumental, model (e.g. 'v5.5'), title,",
    "      upload_id (for a cover). Returns a job with 2 clip ids.",
    "  - get_song: poll ONE clip by clip_id. When status='complete', audio_url is the MP3.",
    "  - upload_audio: upload reference audio (audio_url or base64 audio_base64) → upload_id.",
    "  - get_account: remaining Suno credits / plan.",
    "",
    "Notes:",
    "  - Suno returns 2 song variants per request — share both with the user.",
    "  - Generation takes ~1-3 minutes; poll get_song every few seconds.",
    "  - To send a finished song over WhatsApp, use the messages/chats send with the audio_url.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    generate_song: {},
    get_song: { readOnlyHint: true },
    upload_audio: {},
    get_account: { readOnlyHint: true },
  },
  async dispatch(input: SunoInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      if (!client.suno) {
        return toolErrorResult(
          Object.assign(new Error("Suno tools are not available in this context."), {
            code: 502,
            name: "BadGateway",
          }),
        );
      }
      let data: unknown;
      switch (input.action) {
        case "generate_song":
          if (input.confirmed_with_user !== true) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    generated: false,
                    error:
                      "Not generated: confirmed_with_user must be true. First show the user the " +
                      "exact lyrics and style (and, for a cover, that their recording will be " +
                      "used) and ask their preferred vocal gender, weirdness, style influence " +
                      "and — covers only — audio influence. Call again with " +
                      "confirmed_with_user: true once they approve.",
                  }),
                },
              ],
            };
          }
          data = await client.suno.generateSong({
            lyrics: input.lyrics,
            style: input.style,
            negativeStyle: input.negative_style,
            vocalGender: input.vocal_gender,
            weirdness: input.weirdness,
            styleInfluence: input.style_influence,
            audioInfluence: input.audio_influence,
            instrumental: input.instrumental,
            model: input.model,
            title: input.title,
            uploadId: input.upload_id,
          });
          break;
        case "get_song":
          data = await client.suno.getSong(input.clip_id);
          break;
        case "upload_audio":
          data = await client.suno.uploadAudio({
            audioUrl: input.audio_url,
            audioBase64: input.audio_base64,
            fileName: input.file_name,
          });
          break;
        case "get_account":
          data = await client.suno.account();
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default sunoTool;

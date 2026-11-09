import { z } from "zod";
import type { BlueticksSurface } from "../surface";
import { actionSchemaToJsonSchema } from "../schema";
import { toolErrorResult, type ToolResult } from "../errors";

// A file reference: EITHER a WhatsApp message_key (a document/image sent in a
// chat) OR a plain url. `[file received]` turn messages carry the exact
// message_key / url to pass here.
const IdentifyArgs = z
  .object({
    message_key: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    // I3 (final review) — a third source: the upload_id of a file the user
    // attached to THIS chat (btgpt/builder UI upload), resolved owner-scoped
    // server-side to a short-TTL signed read URL for the original object.
    upload_id: z.string().min(1).optional(),
    filename: z.string().min(1).max(300).optional(),
  })
  .strict();

const IngestInvoiceArgs = z
  .object({
    message_key: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    upload_id: z.string().min(1).optional(),
    board_id: z.string().min(1).optional(),
    filename: z.string().min(1).max(300).optional(),
  })
  .strict();

const actions = {
  identify: IdentifyArgs,
  ingest_invoice: IngestInvoiceArgs,
};

type FilesInput =
  | ({ action: "identify" } & z.infer<typeof IdentifyArgs>)
  | ({ action: "ingest_invoice" } & z.infer<typeof IngestInvoiceArgs>);

const filesTool = {
  name: "files" as const,
  description: [
    "Understand and file documents & images the user sends you — invoices, receipts, credit notes, contracts, and other files.",
    "",
    "WHEN A FILE ARRIVES: a `[file received] <filename> (<mimetype>) message_key=… ` (or `url=…`) line in the conversation means the user sent you a file. That message_key / url is the handle you pass to this tool. NEVER guess what a file is from its name alone — call `identify` FIRST to actually read it.",
    "",
    "A FILE ATTACHED IN THE CHAT UI (not a `[file received]` line): an \"Attached files (open them with Read):\" block lists lines like `attachments/AbC123xyZ09876-report.pdf — report.pdf (application/pdf)`. You can `Read` it directly, AND/OR pass it to `identify`/`ingest_invoice` via `upload_id` = the part of the pod path before the first `-` (here: `AbC123xyZ09876`) — use this when the file needs filing (e.g. it's an invoice), not just reading.",
    "",
    "Actions:",
    "  - identify {message_key | url | upload_id}: read the file and return what it is — doc_kind (invoice / tax_invoice_receipt / receipt / credit_note / statement / contract / other), a short summary, a confidence, and, for invoice-like files, extracted fields (vendor, doc_number, date, total, vat, currency). Read-only. Use this to answer 'what is this file?' and to decide whether it is an invoice worth filing.",
    "  - ingest_invoice {message_key | url | upload_id, board_id?}: the ONE-CALL invoice flow. It identifies the file, finds-or-creates the user's Invoices board, creates a row with the extracted fields (vendor, invoice #, date, total, VAT, currency, doc type, status 'New'), and attaches the file to that row so the user can open it. Returns the board (with web_url), the created row, and the file_intel result. Use this when a file IS an invoice/receipt and the user wants it saved/tracked.",
    "",
    "TYPICAL FLOW: on a `[file received]` → `identify` → if it is an invoice/receipt/credit note → `ingest_invoice`, then confirm in one line WITH the board link ('filed to your Invoices board 👉 <link>'); if it is NOT an invoice → tell the user what you see and ask what to do, naming the type — e.g. 'I see you sent your ID/passport — what would you like me to do with it?'. ALWAYS reply after a file; never go silent. Because the message_key stays in the conversation, a later 'that's an invoice, file it' can call `ingest_invoice` with the same message_key.",
    "",
    "REPLY CONTEXT: a user message may end with `[reply to message_key=…]` — they replied ON an earlier message (often a file, e.g. 'check this' / 'file this one'). Use that message_key with this tool to act on the referenced file.",
  ].join("\n"),
  inputSchema: actionSchemaToJsonSchema(actions),
  annotations: {
    // identify is read-only; ingest_invoice writes (creates a row + attaches a
    // file). The union is annotated as a side-effecting tool.
    identify: { readOnlyHint: true, destructiveHint: false },
    ingest_invoice: { readOnlyHint: false, destructiveHint: false },
  },
  async dispatch(input: FilesInput, client: BlueticksSurface): Promise<ToolResult> {
    try {
      if (!client.files) {
        return toolErrorResult(
          new Error("File intelligence is not available on this connection."),
        );
      }
      const files = client.files;
      let data: unknown;
      switch (input.action) {
        case "identify":
          data = await files.identify({
            message_key: input.message_key,
            url: input.url,
            upload_id: input.upload_id,
            filename: input.filename,
          });
          break;
        case "ingest_invoice":
          data = await files.ingestInvoice({
            message_key: input.message_key,
            url: input.url,
            upload_id: input.upload_id,
            board_id: input.board_id,
            filename: input.filename,
          });
          break;
      }
      return { content: [{ type: "text", text: JSON.stringify(data ?? {}) }] };
    } catch (err) {
      return toolErrorResult(err);
    }
  },
};

export default filesTool;

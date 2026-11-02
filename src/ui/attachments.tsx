// Chat attachments (JPG, PNG, PDF) for the support panels. The bridge checks
// the real type from the file's bytes and caps the size; the checks here only
// save the user a round trip and give a friendlier message.
import { color, radius, font } from "./theme";

/** One file on a chat message, as the bridge returns it. */
export interface SupportAttachment {
  id: number;
  /** "image" renders inline; anything else is a download link. */
  fileType: string;
  url: string;
  thumbUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
}

/** The bridge's `attachment` body field: the file as base64. */
export interface AttachmentUpload {
  fileName: string;
  data: string;
}

export const ATTACHMENT_ACCEPT = "image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf";
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];

/** Copy for a file the panel refuses before sending, or null if it is fine. */
export function attachmentProblem(file: File): string | null {
  const byExt = /\.(jpe?g|png|pdf)$/i.test(file.name);
  if (!ALLOWED_TYPES.includes(file.type) && !byExt) {
    return "Only JPG, PNG or PDF files can be attached.";
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return "That file is too large (max 8 MB).";
  }
  return null;
}

/** Copy for the bridge's attachment reason codes. */
export function attachmentFailureMessage(reason: string | undefined): string | null {
  switch (reason) {
    case "unsupported_attachment_type":
      return "Only JPG, PNG or PDF files can be attached.";
    case "attachment_too_large":
      return "That file is too large (max 8 MB).";
    case "invalid_attachment":
      return "That file couldn’t be read. Please try another.";
    case "attachment_rate_limited":
      return "Files can’t be sent right now. Please try again later, or describe it in a message.";
  }
  return null;
}

/** Read a picked file into the bridge's upload shape. */
export function readAttachment(file: File): Promise<AttachmentUpload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve({ fileName: file.name, data: result.slice(result.indexOf(",") + 1) });
    };
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

/** Inline images and download links for a message's files. */
export function AttachmentList({ attachments }: { attachments?: SupportAttachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
      {attachments.map((a) =>
        a.fileType === "image" ? (
          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer">
            <img
              src={a.thumbUrl || a.url}
              alt={a.fileName ?? "Attached image"}
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: 220,
                borderRadius: radius.md,
                border: `1px solid ${color.border}`,
              }}
            />
          </a>
        ) : (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: color.accent, fontSize: font.base, textDecoration: "underline" }}
          >
            📄 {a.fileName ?? "Attachment"}
          </a>
        ),
      )}
    </div>
  );
}

// File attachments on the per-order support chat, shared by UserSupportPanel
// and OpsSupportPanel. The bridge validates every file by its magic bytes
// (JPG, PNG or PDF, max 8 MB) and stores it on the Chatwoot message; the
// checks here only save a round trip on an obviously wrong file.

import { useRef } from "react";
import { color, font, weight } from "../ui/theme";

/** Attachment as the bridge returns it on a thread message. */
export interface SupportAttachment {
  id: number;
  /** "image" renders inline; anything else is a download link. */
  fileType: string;
  url: string;
  thumbUrl: string | null;
  fileName: string | null;
}

/** One file to send, base64 in the JSON body (the bridge's AttachmentInput). */
export interface OutgoingAttachment {
  fileName: string;
  data: string;
}

/** Mirrors the bridge's MAX_ATTACHMENT_BYTES. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf";
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "application/pdf"]);
const ACCEPTED_NAME = /\.(jpe?g|png|pdf)$/i;

/**
 * Some mobile pickers report an empty or odd type for a real photo, so a
 * matching extension is enough here. The bridge decides from the file's bytes.
 */
function looksAccepted(file: File): boolean {
  return ACCEPTED_TYPES.has(file.type) || ACCEPTED_NAME.test(file.name);
}

/**
 * The dispute routes need text with a file (older widgets render only text),
 * so a file sent without a message gets its name as the text.
 */
export function attachmentCaption(file: OutgoingAttachment): string {
  return `📎 ${file.fileName}`;
}

/** Read a picked file, or return the reason it can't be sent. */
export function readAttachment(
  file: File,
): Promise<{ ok: true; file: OutgoingAttachment } | { ok: false; message: string }> {
  if (!looksAccepted(file)) {
    return Promise.resolve({ ok: false, message: "Only JPG, PNG or PDF files can be sent." });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return Promise.resolve({ ok: false, message: "File is too large (max 8 MB)." });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ ok: true, file: { fileName: file.name, data: String(reader.result) } });
    reader.onerror = () => resolve({ ok: false, message: "Couldn’t read that file." });
    reader.readAsDataURL(file);
  });
}

/** Copy for the bridge's attachment rejections; undefined for any other reason. */
export function attachmentFailureMessage(reason: string | undefined): string | undefined {
  switch (reason) {
    case "attachment_too_large":
      return "File is too large (max 8 MB).";
    case "unsupported_attachment_type":
    case "invalid_attachment":
      return "Only JPG, PNG or PDF files can be sent.";
    case "attachment_rate_limited":
      return "Too many files sent. Please wait a while and try again.";
  }
  return undefined;
}

function isHttpUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/** A message's files: images inline (tap for full size), others as links. */
export function AttachmentList({ attachments }: { attachments?: SupportAttachment[] }) {
  const items = (attachments ?? []).filter((a) => isHttpUrl(a.url));
  if (items.length === 0) return null;
  return (
    <>
      {items.map((a) =>
        a.fileType === "image" ? (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "block", marginTop: 6 }}
          >
            <img
              src={isHttpUrl(a.thumbUrl) ? a.thumbUrl : a.url}
              alt={a.fileName ?? ""}
              style={{ display: "block", maxWidth: "100%", maxHeight: 224, borderRadius: 8 }}
            />
          </a>
        ) : (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              marginTop: 6,
              color: color.accent,
              textDecoration: "underline",
              wordBreak: "break-all",
            }}
          >
            📄 {a.fileName ?? "file"}
          </a>
        ),
      )}
    </>
  );
}

/** Paperclip button plus the picked file's name with a remove control. */
export function AttachPicker({
  file,
  disabled,
  onPick,
  onClear,
}: {
  file: OutgoingAttachment | null;
  disabled?: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) onPick(picked);
        }}
      />
      <button
        type="button"
        aria-label="Attach a file"
        title="Attach JPG, PNG or PDF (max 8 MB)"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        style={{
          background: "transparent",
          border: `1px solid ${color.border}`,
          borderRadius: 8,
          height: 38,
          width: 38,
          flexShrink: 0,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
          color: color.textMuted,
          fontSize: font.md,
        }}
      >
        📎
      </button>
      {file && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            fontSize: font.sm,
            color: color.textMuted,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file.fileName}
          </span>
          <button
            type="button"
            aria-label="Remove file"
            onClick={onClear}
            disabled={disabled}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: color.accent,
              fontSize: font.sm,
              fontWeight: weight.medium,
            }}
          >
            Remove
          </button>
        </span>
      )}
    </div>
  );
}

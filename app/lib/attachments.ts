// Files pasted or dropped into a chat's full view. Until the message is sent
// they stay in the browser, each held by a label in the draft, `[Image #1]`
// or `[File #1]`. Sending writes them under ATTACHMENT_ROOT and puts each
// file's path in place of its label, which is how both agents get them: the
// path is plain text, and the agent opens the file itself.

export const ATTACHMENT_ROOT = "/tmp/seamux";

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_BYTES = 50 * 1024 * 1024;

// What both agents can view as an image, by type, with the extension each
// is written under.
export const IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export type AttachmentKind = "Image" | "File";

export function kindOf(type: string): AttachmentKind {
  return type in IMAGE_TYPES ? "Image" : "File";
}

export function attachmentLabel(kind: AttachmentKind, n: number): string {
  return `[${kind} #${n}]`;
}

// A file held in the browser until its message is sent. `url` previews it.
export interface Attachment {
  label: string;
  n: number;
  kind: AttachmentKind;
  file: File;
  url: string;
}

export const LABEL = /^\[(Image|File) #(\d{1,3})\]$/;

// The file's name as the browser gave it, kept to characters that can't
// end the label or read as part of the message around it.
export function attachmentName(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} ._()+,&'-]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

// The label as sent, with the file's own name, since the path is a random
// one. Codex answered "I can't access the image from that path" to a bare
// path, and opened it once told to: knowledge/prompt-box.md.
export function sentAttachment(
  kind: AttachmentKind,
  n: number,
  name: string,
  path: string,
): string {
  const how =
    kind === "Image"
      ? "open it with your image viewing tool"
      : "open it from disk";
  const named = name ? ` "${name}"` : "";
  return `[${kind} #${n}${named}: ${path}, ${how}]`;
}

// A sent label, found again in the transcript or the queue. Labels sent
// before names were added have none.
const SENT = String.raw`\[(Image|File) #(\d+)(?: "([^"\]\n]{1,100})")?: (/tmp/seamux/[0-9a-f-]{36}/[0-9a-f-]{36}(?:\.[a-z0-9]{1,10})?), open it (?:with your image viewing tool|from disk)\]`;

export type MessagePart =
  | { text: string }
  | { kind: AttachmentKind; n: number; name?: string; path: string };

// A message split into its text and the attachments sent with it.
export function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let at = 0;
  for (const m of text.matchAll(new RegExp(SENT, "g"))) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({
      kind: m[1] as AttachmentKind,
      n: Number(m[2]),
      name: m[3],
      path: m[4],
    });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

// The message with each sent attachment back to its label, for a card's
// one-line preview.
export function shortenAttachments(text: string): string {
  return text.replace(new RegExp(SENT, "g"), (_, kind, n) =>
    attachmentLabel(kind, Number(n)),
  );
}

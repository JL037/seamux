// Writes a message's attachments to disk as it is sent or queued, and puts
// each file's path in place of its label. Files are named by the server,
// never the browser: a UUID, with the extension of its type or its name.
// Nothing here deletes them; macOS clears /tmp of files left unopened.

import { randomUUID } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import {
  ATTACHMENT_ROOT,
  IMAGE_TYPES,
  kindOf,
  LABEL,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_BYTES,
  sentAttachment,
} from "./attachments";

// /tmp is shared with every account on the Mac, so each directory must be
// this account's own, unreadable by anyone else, and not a link somewhere
// else that another account planted.
async function privateDir(path: string) {
  await mkdir(path, { mode: 0o700 }).catch((err) => {
    if (err.code !== "EEXIST") throw err;
  });
  const stats = await lstat(path);
  if (
    !stats.isDirectory() ||
    stats.uid !== process.getuid?.() ||
    (stats.mode & 0o077) !== 0
  ) {
    throw new Error(`${path} is not this account's private directory`);
  }
}

function extensionOf(file: File): string {
  const ext = IMAGE_TYPES[file.type] ?? extname(file.name).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

// The message's text, with its attachments written and their labels
// replaced. Each file arrives as `attachment`, its label at the same index
// in `attachmentLabel`.
export async function withAttachments(
  sessionId: string,
  text: string,
  form: FormData,
): Promise<string> {
  const files = form.getAll("attachment");
  const labels = form.getAll("attachmentLabel");
  if (files.length === 0) return text;
  if (files.length !== labels.length) throw new Error("Bad attachments");
  if (files.length > MAX_ATTACHMENTS) {
    throw new Error(`At most ${MAX_ATTACHMENTS} attachments`);
  }
  let total = 0;
  const checked = files.map((file, i) => {
    const label = labels[i];
    const m = typeof label === "string" ? LABEL.exec(label) : null;
    if (!(file instanceof File) || !m) throw new Error("Bad attachments");
    if (m[1] !== kindOf(file.type)) throw new Error("Bad attachments");
    if (!text.includes(label as string)) throw new Error("Bad attachments");
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${label} is over ${MAX_ATTACHMENT_BYTES >> 20} MB`);
    }
    total += file.size;
    return {
      file,
      label: label as string,
      n: Number(m[2]),
      kind: kindOf(file.type),
    };
  });
  if (new Set(labels).size !== labels.length)
    throw new Error("Bad attachments");
  if (total > MAX_ATTACHMENTS_BYTES) {
    throw new Error(`Attachments are over ${MAX_ATTACHMENTS_BYTES >> 20} MB`);
  }

  const dir = join(ATTACHMENT_ROOT, sessionId);
  await privateDir(ATTACHMENT_ROOT);
  await privateDir(dir);
  for (const { file, label, n, kind } of checked) {
    const path = join(dir, `${randomUUID()}${extensionOf(file)}`);
    await writeFile(path, new Uint8Array(await file.arrayBuffer()), {
      mode: 0o600,
      flag: "wx",
    });
    text = text.split(label).join(sentAttachment(kind, n, path));
  }
  return text;
}

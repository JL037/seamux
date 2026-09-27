import { FileText, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  attachmentLabel,
  messageParts,
  type Attachment,
} from "~/lib/attachments";
import { fileRawUrl, fileViewerUrl } from "~/lib/files";
import { cn } from "~/lib/utils";

// The files a draft holds, each removable, which also takes its label out
// of the text.
export function AttachmentChips({
  attachments,
  onDetach,
}: {
  attachments: Attachment[];
  onDetach: (label: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((a) => (
        <div
          key={a.label}
          className="flex max-w-60 items-center gap-2 rounded-lg border bg-muted/50 p-1 pr-1.5 text-xs"
          title={a.file.name}
        >
          {a.kind === "Image" ? (
            <img
              src={a.url}
              alt=""
              className="size-10 shrink-0 rounded object-cover"
            />
          ) : (
            <FileText className="size-10 shrink-0 p-2 text-muted-foreground" />
          )}
          <div className="flex min-w-0 flex-col">
            <span className="font-medium">{a.label}</span>
            <span className="truncate text-muted-foreground">
              {a.file.name}
            </span>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => onDetach(a.label)}
            title={`Remove ${a.label}`}
          >
            <X />
          </Button>
        </div>
      ))}
    </div>
  );
}

// A message as written, its attachments back to their labels in the text
// and shown under it, images as thumbnails. Each opens in the file viewer.
export function MessageText({ text }: { text: string }) {
  const parts = messageParts(text);
  const files = parts.filter((p) => "path" in p);
  if (files.length === 0) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        "path" in p ? (
          <span key={i} className="font-medium">
            {attachmentLabel(p.kind, p.n)}
          </span>
        ) : (
          p.text
        ),
      )}
      <span className="mt-2 flex flex-wrap gap-2">
        {files.map((p, i) => (
          <a
            key={i}
            href={fileViewerUrl(p.path)}
            target="_blank"
            rel="noopener noreferrer"
            title={attachmentLabel(p.kind, p.n)}
            className={cn(
              "block overflow-hidden rounded border border-current/20",
              p.kind === "File" &&
                "flex items-center gap-1 px-2 py-1 text-xs underline-offset-2 hover:underline",
            )}
          >
            {p.kind === "Image" ? (
              <img
                src={fileRawUrl(p.path)}
                alt={attachmentLabel(p.kind, p.n)}
                loading="lazy"
                className="max-h-40 max-w-60 object-contain"
              />
            ) : (
              <>
                <FileText className="size-3.5" />
                {attachmentLabel(p.kind, p.n)}
              </>
            )}
          </a>
        ))}
      </span>
    </>
  );
}

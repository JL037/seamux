import { Check, Copy } from "lucide-react";
import { memo, useRef, useState, type ComponentProps } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";

import {
  fileRawUrl,
  fileViewerUrl,
  linkedPath,
  remarkFilePaths,
} from "~/lib/files";
import { remarkFrontmatterAsCode } from "~/lib/highlight";
import { cn } from "~/lib/utils";

// Claude's replies, as the markdown they're written in. Links open in a new
// tab, so following one never navigates the board away. A link to a file on
// disk, relative to `base` or absolute, opens it in the /file viewer, and so
// does a path written bare.
// Memoized: parsing and highlighting is the costliest part of a render, and
// the board renders every card again on each poll.
export const Markdown = memo(function Markdown({
  children,
  base,
}: {
  children: string;
  base: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[
        remarkGfm,
        remarkFrontmatter,
        remarkFrontmatterAsCode,
        remarkFilePaths,
      ]}
      // Only fenced blocks that name their language: guessing is slow, and
      // often wrong on short snippets.
      rehypePlugins={[[rehypeHighlight, { detect: false }]]}
      // The default drops `style.css:12` as an unknown scheme.
      urlTransform={(url) =>
        linkedPath(url, base) ? url : defaultUrlTransform(url)
      }
      components={{
        a: ({ node: _node, href, ...props }) => {
          const path = href ? linkedPath(href, base) : null;
          return (
            <a
              {...props}
              href={path ? fileViewerUrl(path) : href}
              target="_blank"
              rel="noopener noreferrer"
            />
          );
        },
        pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
        img: ({ node: _node, src, ...props }) => {
          const path = typeof src === "string" ? linkedPath(src, base) : null;
          return (
            <img
              {...props}
              src={path?.startsWith("/") ? fileRawUrl(path) : src}
            />
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
});

// A fenced block, with a button in its top right that copies what it says.
// The click stops here, so copying from a card doesn't open its chat.
function CodeBlock({ className, ...props }: ComponentProps<"pre">) {
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/code relative">
      <pre ref={pre} className={className} {...props} />
      <button
        type="button"
        title="Copy"
        aria-label="Copy"
        className={cn(
          "absolute top-1 right-1 rounded-md border bg-background/80 p-1 text-muted-foreground backdrop-blur-sm hover:text-foreground",
          "opacity-0 transition-opacity group-hover/code:opacity-100 focus-visible:opacity-100 max-md:opacity-100",
          copied && "opacity-100",
        )}
        onClick={(e) => {
          e.stopPropagation();
          const text = pre.current?.textContent ?? "";
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}

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

// Claude's replies, as the markdown they're written in. Links open in a new
// tab, so following one never navigates the board away. A link to a file on
// disk, relative to `base` or absolute, opens it in the /file viewer, and so
// does a path written bare.
export function Markdown({
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
}

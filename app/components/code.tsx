import type { Root as HastRoot } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { useEffect, useRef } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

import {
  HIGHLIGHT_LIMIT,
  highlightFile,
  languageFor,
  splitLines,
} from "~/lib/highlight";
import { cn } from "~/lib/utils";

function toJsx(root: HastRoot) {
  return toJsxRuntime(root, { Fragment, jsx, jsxs });
}

// A whole file as text, highlighted by what its name says it is. With
// `lineNumbers`, each line is numbered; with `line`, that line is marked
// and scrolled into view.
export function Code({
  text,
  path,
  lineNumbers = false,
  line,
  className,
}: {
  text: string;
  path: string;
  lineNumbers?: boolean;
  line?: number;
  className?: string;
}) {
  const language = text.length <= HIGHLIGHT_LIMIT ? languageFor(path) : null;
  const target = useRef<HTMLSpanElement>(null);
  // Once per file and line, not on every reload while the file changes.
  useEffect(() => {
    target.current?.scrollIntoView({ block: "center" });
  }, [path, line]);
  const root: HastRoot = language
    ? highlightFile(language, text)
    : { type: "root", children: [{ type: "text", value: text }] };
  if (!lineNumbers && line === undefined) {
    return (
      <pre className={cn("hljs", className)}>
        <code>{language ? toJsx(root) : text}</code>
      </pre>
    );
  }
  // Each line is its own row, so one that wraps keeps its number beside
  // it. The number can't be selected, and the line keeps its newline, so
  // copying still gives the file's text.
  return (
    <pre className={cn("hljs", className)}>
      <code
        className={cn(
          "grid",
          lineNumbers
            ? "grid-cols-[auto_minmax(0,1fr)] gap-x-4"
            : "grid-cols-[minmax(0,1fr)]",
        )}
      >
        {splitLines(root).map((content, i) => (
          <span
            key={i}
            ref={i + 1 === line ? target : undefined}
            className={cn(
              "col-span-full grid grid-cols-subgrid",
              i + 1 === line && "rounded-sm bg-line-highlight",
            )}
          >
            {lineNumbers && (
              <span className="text-right text-muted-foreground/60 select-none">
                {i + 1}
              </span>
            )}
            <span>
              {toJsx({ type: "root", children: content })}
              {"\n"}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}

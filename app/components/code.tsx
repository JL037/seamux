import type { Root as HastRoot } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
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

// A whole file as text, highlighted by what its name says it is, and with
// each line numbered when `lineNumbers` is set.
export function Code({
  text,
  path,
  lineNumbers = false,
  className,
}: {
  text: string;
  path: string;
  lineNumbers?: boolean;
  className?: string;
}) {
  const language = text.length <= HIGHLIGHT_LIMIT ? languageFor(path) : null;
  const root: HastRoot = language
    ? highlightFile(language, text)
    : { type: "root", children: [{ type: "text", value: text }] };
  if (!lineNumbers) {
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
      <code className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4">
        {splitLines(root).map((line, i) => (
          <Fragment key={i}>
            <span className="text-right text-muted-foreground/60 select-none">
              {i + 1}
            </span>
            <span>
              {toJsx({ type: "root", children: line })}
              {"\n"}
            </span>
          </Fragment>
        ))}
      </code>
    </pre>
  );
}

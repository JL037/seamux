import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

import { HIGHLIGHT_LIMIT, highlightFile, languageFor } from "~/lib/highlight";
import { cn } from "~/lib/utils";

// A whole file as text, highlighted by what its name says it is.
export function Code({
  text,
  path,
  className,
}: {
  text: string;
  path: string;
  className?: string;
}) {
  const language = text.length <= HIGHLIGHT_LIMIT ? languageFor(path) : null;
  return (
    <pre className={cn("hljs", className)}>
      <code>
        {language
          ? toJsxRuntime(highlightFile(language, text), {
              Fragment,
              jsx,
              jsxs,
            })
          : text}
      </code>
    </pre>
  );
}

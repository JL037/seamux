import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Claude's replies, as the markdown they're written in. Links open in a new
// tab, so following one never navigates the board away.
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node: _node, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer" />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

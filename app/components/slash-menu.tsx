import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";

import type { SlashCommand } from "~/lib/board";
import { cn } from "~/lib/utils";

// A draft that is a slash and a command name so far, and nothing after it.
const TYPING_COMMAND = /^\/(\S*)$/;

// Claude Code's slash commands, suggested while a draft starts one. Arrows
// move, Tab or Enter completes, Esc dismisses. Enter on a name typed in
// full goes to the input instead, so it still sends.
//
// `portal` puts the menu on the page's body, for an input inside a box that
// clips it; otherwise it sits above the input, whose wrapper must be
// `relative`.
export function useSlashMenu({
  sessionId,
  enabled,
  draft,
  setDraft,
  anchor,
  portal = false,
}: {
  sessionId: string;
  enabled: boolean;
  draft: string;
  setDraft: (draft: string) => void;
  anchor: RefObject<HTMLElement | null>;
  portal?: boolean;
}) {
  const fetcher = useFetcher<{ commands: SlashCommand[] }>();
  const query = enabled ? (TYPING_COMMAND.exec(draft)?.[1] ?? null) : null;
  const typing = query !== null;
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Listed again each time a command is started, since /reload-skills can
  // change the list; the server keeps it, so this is cheap.
  useEffect(() => {
    if (!typing) {
      setDismissed(false);
      return;
    }
    fetcher.load(`/sessions/${sessionId}/commands`);
    // fetcher is a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing, sessionId]);

  const matches = query === null ? [] : rank(fetcher.data?.commands, query);
  useEffect(() => setHighlight(0), [query]);
  const open = typing && !dismissed && matches.length > 0;
  const current = matches[Math.min(highlight, matches.length - 1)];

  const complete = (c: SlashCommand) => {
    setDraft(`/${c.name} `);
    anchor.current?.focus();
  };

  // True when the key was the menu's, and the input should ignore it.
  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!open || e.nativeEvent.isComposing) return false;
    const move = (by: number) => {
      e.preventDefault();
      setHighlight((h) => (h + by + matches.length) % matches.length);
      return true;
    };
    if (e.key === "ArrowDown") return move(1);
    if (e.key === "ArrowUp") return move(-1);
    if (e.key === "Escape") {
      // Dismiss the menu, not the dialog holding the input.
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
      return true;
    }
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (
      plain &&
      (e.key === "Tab" || (e.key === "Enter" && current.name !== query))
    ) {
      e.preventDefault();
      complete(current);
      return true;
    }
    return false;
  };

  const menu = open ? (
    <MenuList
      matches={matches}
      current={current}
      onPick={complete}
      onHover={(i) => setHighlight(i)}
      anchor={anchor}
      portal={portal}
    />
  ) : null;
  return { onKeyDown, menu, open };
}

// Names that start with the query first, then any that contain it.
function rank(commands: SlashCommand[] | undefined, query: string) {
  if (!commands) return [];
  const q = query.toLowerCase();
  const starts: SlashCommand[] = [];
  const contains: SlashCommand[] = [];
  for (const c of commands) {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) starts.push(c);
    else if (name.includes(q)) contains.push(c);
  }
  return [...starts, ...contains];
}

function MenuList({
  matches,
  current,
  onPick,
  onHover,
  anchor,
  portal,
}: {
  matches: SlashCommand[];
  current: SlashCommand;
  onPick: (c: SlashCommand) => void;
  onHover: (i: number) => void;
  anchor: RefObject<HTMLElement | null>;
  portal: boolean;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // On the body, the menu follows the input as the board scrolls.
  useLayoutEffect(() => {
    if (!portal) return;
    const place = () => setRect(anchor.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [portal, anchor]);

  useEffect(() => {
    list.current
      ?.querySelector("[aria-selected=true]")
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const ul = (
    <ul
      ref={list}
      role="listbox"
      style={
        portal && rect
          ? {
              position: "fixed",
              left: rect.left,
              bottom: window.innerHeight - rect.top + 4,
              width: Math.max(rect.width, 320),
            }
          : undefined
      }
      className={cn(
        "z-50 max-h-64 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
        !portal && "absolute bottom-full left-0 right-0 mb-1",
      )}
      // Keep focus in the input.
      onMouseDown={(e) => e.preventDefault()}
    >
      {matches.map((c, i) => (
        <li
          key={c.name}
          role="option"
          aria-selected={c === current}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(c)}
          className={cn(
            "flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1 text-xs",
            c === current && "bg-accent text-accent-foreground",
          )}
        >
          <span className="shrink-0 font-mono">/{c.name}</span>
          {c.argumentHint && (
            <span className="shrink-0 font-mono text-muted-foreground">
              {c.argumentHint.length > 40
                ? `${c.argumentHint.slice(0, 40)}…`
                : c.argumentHint}
            </span>
          )}
          <span className="min-w-0 truncate text-muted-foreground">
            {c.description}
          </span>
        </li>
      ))}
    </ul>
  );
  if (!portal) return ul;
  return rect ? createPortal(ul, document.body) : null;
}

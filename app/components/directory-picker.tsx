import { useEffect, useRef, useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { ChevronDown, FolderOpen } from "lucide-react";
import { cn } from "cn";

// A directory field with every known path a keypress away. A native
// <datalist> filters by whatever is already in the field, so a remembered
// directory hides every other one; here, opening the list (↓, or the chevron)
// shows them all, and only typing narrows it. Tab completes a partly typed
// path as a shell does, from the known directories and the ones on disk: to
// the only one it can be, or as far as every one it could be agrees.
export function DirectoryPicker({
  value,
  onValueChange,
  options,
  onFocus,
  placeholder,
  className,
  inputClassName,
  "data-focus-key": focusKey,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  "data-focus-key"?: string;
}) {
  // What the user has typed since the list opened; null while browsing.
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // The directories on disk the typed path could go on to name, and the
  // text they were listed for.
  const [onDisk, setOnDisk] = useState<{ typed: string; dirs: string[] }>({
    typed: "",
    dirs: [],
  });
  // The item the user moved to with the arrow keys, which Tab takes as is.
  const arrowedTo = useRef<string | undefined>(undefined);
  // The text a Tab was pressed on before its directories on disk arrived.
  const tabbedOn = useRef<string | null>(null);

  const needle = query?.trim().toLowerCase() ?? "";
  const extra =
    query !== null && onDisk.typed === query
      ? onDisk.dirs.filter((d) => !options.includes(d))
      : [];
  const items = [...options, ...extra];
  const shown = needle
    ? items.filter((d) => d.toLowerCase().includes(needle))
    : options;

  useEffect(() => {
    if (!value.startsWith("/")) return;
    const typed = value;
    let stale = false;
    fetch(`/directories?complete=${encodeURIComponent(typed)}`)
      .then((r) => (r.ok ? r.json() : { directories: [] }))
      .catch(() => ({ directories: [] }))
      .then((body: { directories: string[] }) => {
        if (stale) return;
        setOnDisk({ typed, dirs: body.directories });
        if (tabbedOn.current === typed) {
          tabbedOn.current = null;
          complete(typed, body.directories);
        }
      });
    return () => {
      stale = true;
    };
  }, [value]);

  // Fills in as much of the path as every candidate shares. Returns whether
  // it did anything, so a Tab with nothing to complete moves focus on.
  const complete = (typed: string, disk: string[]) => {
    const lower = typed.toLowerCase();
    const candidates = [
      ...new Set([
        ...options.filter((d) => d.toLowerCase().startsWith(lower)),
        ...disk,
      ]),
    ];
    // A name from the middle of a path, as the list matches: only when it
    // picks out a single directory.
    if (candidates.length === 0) {
      const anywhere = options.filter((d) => d.toLowerCase().includes(lower));
      if (anywhere.length !== 1) return false;
      candidates.push(anywhere[0]);
    }
    let common = candidates[0];
    for (const c of candidates.slice(1)) {
      let i = 0;
      while (
        i < common.length &&
        i < c.length &&
        common[i].toLowerCase() === c[i].toLowerCase()
      )
        i++;
      common = common.slice(0, i);
    }
    if (common.length > typed.length) {
      onValueChange(common);
      setQuery(common);
      if (candidates.length > 1) setOpen(true);
      return true;
    }
    // Nothing more they all agree on: show them, once.
    if (candidates.length > 1 && !open) {
      setQuery(typed);
      setOpen(true);
      return true;
    }
    return false;
  };

  const onTab = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Tab" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey)
      return;
    if (open && arrowedTo.current !== undefined) {
      e.preventDefault();
      onValueChange(arrowedTo.current);
      setQuery(null);
      setOpen(false);
      return;
    }
    if (!value.trim()) return;
    if (value.startsWith("/") && onDisk.typed !== value) {
      // Its directories on disk are still on the way: finish once they land.
      e.preventDefault();
      tabbedOn.current = value;
      return;
    }
    const disk = onDisk.typed === value ? onDisk.dirs : [];
    if (complete(value, disk)) e.preventDefault();
  };

  return (
    <Autocomplete.Root
      items={items}
      filteredItems={shown}
      value={value}
      open={open}
      onValueChange={(next, details) => {
        onValueChange(next);
        setQuery(details.reason === "input-change" ? next : null);
      }}
      onOpenChange={(next, details) => {
        setOpen(next);
        if (next && details.reason !== "input-change") setQuery(null);
      }}
      onItemHighlighted={(item, details) => {
        arrowedTo.current = details.reason === "keyboard" ? item : undefined;
      }}
    >
      <Autocomplete.InputGroup
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-lg border bg-background px-2",
          className,
        )}
      >
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
        <Autocomplete.Input
          data-focus-key={focusKey}
          onFocus={onFocus}
          onKeyDown={onTab}
          placeholder={placeholder}
          className={cn(
            "min-w-0 flex-1 bg-transparent py-1.5 font-mono outline-none placeholder:text-muted-foreground",
            inputClassName,
          )}
        />
        <Autocomplete.Trigger
          aria-label="Show known directories"
          onFocus={onFocus}
          onPointerDown={onFocus}
          className="-mr-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronDown className="size-4" />
        </Autocomplete.Trigger>
      </Autocomplete.InputGroup>
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          className="isolate z-50 outline-hidden"
          sideOffset={4}
          align="start"
        >
          <Autocomplete.Popup className="w-(--anchor-width) max-w-(--available-width) min-w-72 rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <Autocomplete.Empty>
              <div className="px-2 py-3 text-sm text-muted-foreground">
                {options.length
                  ? "No directory matches."
                  : "No known directories yet."}
              </div>
            </Autocomplete.Empty>
            <Autocomplete.List className="max-h-[min(20rem,var(--available-height))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0">
              {(d: string) => (
                <Autocomplete.Item
                  key={d}
                  value={d}
                  className={cn(
                    "cursor-default truncate rounded-md px-2 py-1.5 font-mono text-xs outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground",
                    d === value && "font-semibold",
                  )}
                >
                  {d}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}

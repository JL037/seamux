import { useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { ChevronDown, FolderOpen } from "lucide-react";
import { cn } from "cn";

// A directory field with every known path a keypress away. A native
// <datalist> filters by whatever is already in the field, so a remembered
// directory hides every other one; here, opening the list (↓, or the chevron)
// shows them all, and only typing narrows it.
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
  const needle = query?.trim().toLowerCase() ?? "";
  const shown = needle
    ? options.filter((d) => d.toLowerCase().includes(needle))
    : options;

  return (
    <Autocomplete.Root
      items={options}
      filteredItems={shown}
      value={value}
      onValueChange={(next, details) => {
        onValueChange(next);
        setQuery(details.reason === "input-change" ? next : null);
      }}
      onOpenChange={(open, details) => {
        if (open && details.reason !== "input-change") setQuery(null);
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

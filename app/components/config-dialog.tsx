import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Plus, RotateCcw, Save, Settings, X } from "lucide-react";

import { DirectoryPicker } from "~/components/directory-picker";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import {
  DEFAULT_MACROS,
  ENGINE_LABELS,
  ENGINES,
  MACRO_NAMES,
  MACROS,
  type Config,
  type Engine,
  type MacroName,
} from "~/lib/config";
import { cn } from "~/lib/utils";
import type { ConfigResult } from "~/routes/config";

const TABS = [
  { key: "general", label: "General" },
  { key: "macros", label: "Macros" },
] as const;
type Tab = (typeof TABS)[number]["key"];

// Posts one config change. The board's loader re-runs after it, which is
// how the dialog sees the new config.
function useConfigAction() {
  const fetcher = useFetcher<ConfigResult>();
  return {
    submit: (intent: string, fields: Record<string, string> = {}) =>
      fetcher.submit(
        { intent, ...fields },
        { method: "post", action: "/config" },
      ),
    pending: fetcher.state !== "idle",
    ok: fetcher.state === "idle" && fetcher.data?.ok === true,
    error: fetcher.state === "idle" ? (fetcher.data?.error ?? null) : null,
  };
}

// The cog in the header, and the dialog it opens: seamux's own settings.
export function ConfigDialog({
  config,
  engines,
}: {
  config: Config;
  // Which agents this Mac can launch.
  engines: Record<Engine, boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("general");
  return (
    <>
      <Button
        size="icon-xs"
        variant="ghost"
        title="Configure seamux"
        aria-label="Configure seamux"
        onClick={() => setOpen(true)}
      >
        <Settings />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_auto_minmax(0,1fr)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configure seamux</DialogTitle>
            <DialogDescription>
              Kept in seamux's store, and applied as soon as you change it.
            </DialogDescription>
          </DialogHeader>
          <div role="tablist" className="flex gap-1 border-b">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px cursor-pointer border-b-2 px-3 py-1.5 text-sm",
                  tab === t.key
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="-mx-4 overflow-y-auto px-4 pb-1">
            {tab === "general" ? (
              <GeneralTab config={config} engines={engines} />
            ) : (
              <MacrosTab config={config} />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GeneralTab({
  config,
  engines,
}: {
  config: Config;
  engines: Record<Engine, boolean>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <EngineSetting current={config.defaultEngine} installed={engines} />
      <DirectoriesSetting directories={config.directories} />
      <WorktreeSetting on={config.worktreeByDefault} />
    </div>
  );
}

function DirectoriesSetting({ directories }: { directories: string[] }) {
  const adder = useConfigAction();
  const remover = useConfigAction();
  const discovered = useFetcher<{ directories: string[] }>();
  const [path, setPath] = useState("");
  const wasPending = useRef(false);

  // Clear the box once an add succeeds.
  useEffect(() => {
    if (wasPending.current && !adder.pending && adder.ok) setPath("");
    wasPending.current = adder.pending;
  }, [adder.pending, adder.ok]);

  const suggestions = (discovered.data?.directories ?? []).filter(
    (d) => !directories.includes(d),
  );
  const add = () => {
    if (path.trim()) adder.submit("add-directory", { path: path.trim() });
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Directories</h3>
      <p className="text-muted-foreground">
        What the dispatch bar's directory picker offers. With none listed, it
        offers every directory seamux can find: live sessions, past dispatches,
        and repos under your code folders.
      </p>
      {directories.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {directories.map((d) => (
            <li key={d} className="flex items-center gap-2 px-2 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {d}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                title="Remove from the picker"
                aria-label={`Remove ${d}`}
                disabled={remover.pending}
                onClick={() => remover.submit("remove-directory", { path: d })}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <DirectoryPicker
          value={path}
          onValueChange={setPath}
          options={suggestions}
          onFocus={() => {
            if (discovered.state === "idle" && !discovered.data)
              discovered.load("/directories?discovered");
          }}
          placeholder="/Users/you/code/project"
          className="flex-1"
          inputClassName="text-xs"
        />
        <Button
          type="submit"
          size="sm"
          disabled={adder.pending || !path.trim()}
        >
          <Plus />
          Add
        </Button>
      </form>
      {(adder.error ?? remover.error) && (
        <p className="text-destructive">{adder.error ?? remover.error}</p>
      )}
    </section>
  );
}

function EngineSetting({
  current,
  installed,
}: {
  current: Engine;
  installed: Record<Engine, boolean>;
}) {
  const action = useConfigAction();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Default agent</h3>
      <p className="text-muted-foreground">
        What the dispatch bar starts new sessions with, through cmux. You can
        still pick another for a single dispatch. Fan-out workers always run
        Claude Code.
      </p>
      <div role="radiogroup" className="flex flex-wrap gap-2">
        {ENGINES.map((e) => (
          <label
            key={e}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-1.5",
              installed[e]
                ? "cursor-pointer"
                : "cursor-not-allowed text-muted-foreground",
              current === e && "border-foreground",
            )}
            title={installed[e] ? undefined : "Not found on this Mac"}
          >
            <input
              type="radio"
              name="default-engine"
              checked={current === e}
              disabled={!installed[e] || action.pending}
              onChange={() => action.submit("default-engine", { engine: e })}
            />
            {ENGINE_LABELS[e]}
            {!installed[e] && <span className="text-xs">not installed</span>}
          </label>
        ))}
      </div>
      {action.error && <p className="text-destructive">{action.error}</p>}
    </section>
  );
}

function WorktreeSetting({ on }: { on: boolean }) {
  const action = useConfigAction();
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">Worktrees</h3>
      <label className="flex cursor-pointer items-start gap-2">
        <Switch
          className="mt-0.5"
          checked={on}
          disabled={action.pending}
          onCheckedChange={(checked) =>
            action.submit("worktree-default", { on: String(checked) })
          }
        />
        <span>
          Use worktrees by default
          <span className="block text-muted-foreground">
            The dispatch bar's "new worktree" switch starts on, so dispatched
            work gets its own worktree unless you turn it off.
          </span>
        </span>
      </label>
      {action.error && <p className="text-destructive">{action.error}</p>}
    </section>
  );
}

function MacrosTab({ config }: { config: Config }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground">
        System macros are prompts the dispatcher sends into a session for you.{" "}
        <code>{"{{name}}"}</code> is filled in when it is sent.
      </p>
      {MACRO_NAMES.map((name) => (
        // Keyed on the saved text, so a save or reset starts a fresh draft.
        <MacroEditor
          key={`${name}:${config.macros[name].text}`}
          name={name}
          saved={config.macros[name].text}
          custom={config.macros[name].custom}
        />
      ))}
    </div>
  );
}

function MacroEditor({
  name,
  saved,
  custom,
}: {
  name: MacroName;
  saved: string;
  custom: boolean;
}) {
  const info = MACROS[name];
  const action = useConfigAction();
  const [draft, setDraft] = useState(saved);
  const dirty = draft !== saved;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 font-medium">
        {info.label}
        <span className="text-xs font-normal text-muted-foreground">
          {custom ? "customised" : "default"}
        </span>
      </h3>
      <p className="text-muted-foreground">{info.when}</p>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
        className="font-mono text-xs"
      />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {info.variables.map((v) => (
          <li key={v.name}>
            <code className="text-foreground">{`{{${v.name}}}`}</code>{" "}
            {v.meaning}
            {info.required === v.name && " (required)"}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || action.pending}
          onClick={() => action.submit("save-macro", { name, text: draft })}
        >
          <Save />
          Save
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
            Discard changes
          </Button>
        )}
        {(custom || draft !== DEFAULT_MACROS[name]) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={action.pending}
            onClick={() => {
              setDraft(DEFAULT_MACROS[name]);
              if (custom) action.submit("reset-macro", { name });
            }}
          >
            <RotateCcw />
            Reset to default
          </Button>
        )}
        {action.error && (
          <span className="text-destructive">{action.error}</span>
        )}
      </div>
    </section>
  );
}

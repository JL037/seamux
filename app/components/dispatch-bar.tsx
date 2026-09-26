import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { SendHorizontal } from "lucide-react";

import { DirectoryPicker } from "~/components/directory-picker";

import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { ENGINE_LABELS, ENGINES, type Engine } from "~/lib/config";
import { releaseFocus } from "~/lib/use-focus-restore";
import { useSessionStorage } from "~/lib/use-session-storage";
import type { DispatchResult } from "~/routes/dispatch";

const LAST_DIR_KEY = "seamux:last-dir";
const PROMPT_KEY = "seamux:dispatch:prompt";
const CWD_KEY = "seamux:dispatch:cwd";
const WORKTREE_KEY = "seamux:dispatch:worktree";
const ENGINE_KEY = "seamux:dispatch:engine";

function readLastDir(): string {
  try {
    return localStorage.getItem(LAST_DIR_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeLastDir(dir: string) {
  try {
    localStorage.setItem(LAST_DIR_KEY, dir);
  } catch {}
}

// The primary action: start new work as its own session, in a chosen
// directory, instead of cramming another goal into an existing chat.
export function DispatchBar({
  directories,
  worktreeByDefault,
  defaultEngine,
  engines,
  onDispatched,
}: {
  // The configured directories; empty means offer every one seamux finds.
  directories: string[];
  worktreeByDefault: boolean;
  defaultEngine: Engine;
  // Which agents this Mac can launch.
  engines: Record<Engine, boolean>;
  // Called once a dispatch has started; a failure doesn't call it.
  onDispatched?: () => void;
}) {
  const dispatcher = useFetcher<DispatchResult>();
  const dirs = useFetcher<{ directories: string[] }>();
  const [prompt, setPrompt] = useSessionStorage(PROMPT_KEY, "");
  const [cwd, setCwd] = useSessionStorage(CWD_KEY, "");
  // Starts from the configured default; a tick changed here holds for the
  // tab, until the default itself changes.
  const [worktree, setWorktree] = useSessionStorage(
    WORKTREE_KEY,
    worktreeByDefault,
  );
  const lastDefault = useRef(worktreeByDefault);
  useEffect(() => {
    if (lastDefault.current === worktreeByDefault) return;
    lastDefault.current = worktreeByDefault;
    setWorktree(worktreeByDefault);
  }, [worktreeByDefault, setWorktree]);
  // The agent, the same way: the configured default until changed here.
  const [engine, setEngine] = useSessionStorage<Engine>(
    ENGINE_KEY,
    defaultEngine,
  );
  const lastEngine = useRef(defaultEngine);
  useEffect(() => {
    if (lastEngine.current === defaultEngine) return;
    lastEngine.current = defaultEngine;
    setEngine(defaultEngine);
  }, [defaultEngine, setEngine]);
  const available = ENGINES.filter((e) => engines[e]);
  // One remembered from before it was uninstalled falls back to one that is.
  const chosen = engines[engine] ? engine : (available[0] ?? "claude");
  const [started, setStarted] = useState<string | null>(null);
  const handled = useRef<DispatchResult | undefined>(undefined);
  // The prompt is cleared, from state and storage, as it is sent, so a
  // reload mid-dispatch can't bring it back; a failure puts it back.
  const sent = useRef("");

  // An unsent directory from before a reload wins over the last one used.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(CWD_KEY) !== null) return;
    } catch {}
    setCwd(readLastDir());
  }, [setCwd]);

  const pending = dispatcher.state !== "idle";
  const result = dispatcher.data;
  useEffect(() => {
    if (pending || !result || handled.current === result) return;
    handled.current = result;
    if (result.ok) {
      setStarted(sent.current.trim().split("\n")[0].slice(0, 80));
      releaseFocus("dispatch:prompt");
      writeLastDir(cwd);
      onDispatched?.();
    } else {
      setPrompt((p) => p || sent.current);
    }
  }, [pending, result, cwd, setPrompt, onDispatched]);

  const loadDirs = () => {
    if (directories.length === 0 && dirs.state === "idle" && !dirs.data)
      dirs.load("/directories");
  };
  const options =
    directories.length > 0 ? directories : (dirs.data?.directories ?? []);

  const canDispatch = !pending && prompt.trim() !== "" && cwd.trim() !== "";
  const submit = () => {
    if (!canDispatch) return;
    setStarted(null);
    sent.current = prompt;
    setPrompt("");
    dispatcher.submit(
      {
        prompt,
        cwd: cwd.trim(),
        engine: chosen,
        ...(worktree ? { worktree: "on" } : {}),
      },
      { method: "post", action: "/dispatch" },
    );
  };

  return (
    <section className="flex flex-col gap-2 rounded-xl border bg-card p-2 shadow-sm transition-shadow focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/15">
      <Textarea
        data-focus-key="dispatch:prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Dispatch new work: what should a new session do? (⌘↵)"
        rows={2}
        className="min-h-0 resize-y border-0 bg-transparent text-base max-md:min-h-48 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <DirectoryPicker
          data-focus-key="dispatch:cwd"
          value={cwd}
          onValueChange={setCwd}
          options={options}
          onFocus={loadDirs}
          placeholder="/dir pick"
          className="flex-1 basis-64"
          inputClassName="text-sm"
        />
        {available.length > 1 && (
          <select
            value={chosen}
            onChange={(e) => setEngine(e.target.value as Engine)}
            title="The agent the new session runs"
            className="rounded-lg border bg-background px-2 py-1.5 text-sm"
          >
            {available.map((e) => (
              <option key={e} value={e}>
                {ENGINE_LABELS[e]}
              </option>
            ))}
          </select>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={worktree}
            onCheckedChange={(on) => setWorktree(on)}
          />
          new worktree
        </label>
        <Button
          disabled={!canDispatch}
          onClick={submit}
          className="bg-brand-ramp text-white shadow-sm hover:opacity-90"
        >
          <SendHorizontal />
          {pending ? "Starting…" : "Dispatch"}
        </Button>
      </div>
      {result && !pending && !result.ok && (
        <p className="px-1 text-sm text-destructive">{result.error}</p>
      )}
      {started && (
        <p className="px-1 text-sm text-muted-foreground">
          Started “{started}”. It will appear on the board in a few seconds.
        </p>
      )}
    </section>
  );
}

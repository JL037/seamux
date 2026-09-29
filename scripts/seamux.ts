// seamux protocol CLI, for sessions to call through bin/seamux. USAGE below
// lists its commands.

import { readFileSync } from "node:fs";

import { dispatch } from "../app/lib/drive.server.ts";
import {
  dispatchStatus,
  listDispatches,
  newDispatchId,
  readManifest,
  validateWorkers,
  workerInstructions,
  writeManifest,
  writeMarker,
  type Manifest,
  type WorkerSpec,
} from "../app/lib/protocol.server.ts";

const [command, ...rest] = process.argv.slice(2);
const sessionId = process.env.CLAUDE_CODE_SESSION_ID ?? null;

function flag(name: string, fallback?: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
}

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const USAGE = `seamux                              run the board, setting seamux up first if it isn't
seamux setup                        install the subagent hooks and the dispatch skill
seamux uninstall                    remove them, and keep the board from starting until setup
seamux fanout <manifest.json | ->   declare a set of workers, then spawn each
                                    as its own top-level session
seamux wait <dispatch-id>           barrier: block until every worker has
                                    reported, then print all handbacks
seamux done <dispatch-id> <worker> --summary "…" [--result <path>] [--status ok|failed]
                                    a worker's completion marker
seamux status <dispatch-id>         where a dispatch stands, without waiting
seamux list                         every dispatch
`;

function usage(): never {
  process.stderr.write(USAGE);
  process.exit(64);
}

async function fanout() {
  const source = rest[0];
  if (!source) usage();
  const input = JSON.parse(
    readFileSync(source === "-" ? 0 : source, "utf8"),
  ) as { title: string; workers: WorkerSpec[] };
  if (!input.title?.trim()) throw new Error("The manifest needs a title");
  validateWorkers(input.workers);

  // Declare the whole set before spawning anything.
  const manifest: Manifest = {
    id: newDispatchId(),
    title: input.title.trim(),
    parentSessionId: sessionId,
    createdAt: Date.now(),
    workers: input.workers.map((w) => ({ ...w, sessionId: null })),
  };
  writeManifest(manifest);

  for (const worker of manifest.workers) {
    worker.sessionId = await dispatch({
      cwd: worker.cwd,
      prompt: worker.prompt + workerInstructions(manifest, worker.key),
      name: `${worker.key}: ${manifest.title}`.slice(0, 60),
      worktree: worker.worktree ? `${manifest.id}-${worker.key}` : null,
      dispatchId: manifest.id,
      worker: worker.key,
    });
    writeManifest(manifest);
  }

  print({
    dispatch: manifest.id,
    workers: Object.fromEntries(
      manifest.workers.map((w) => [w.key, w.sessionId]),
    ),
    next: `seamux wait ${manifest.id}   (run it in the background; it exits when every worker has reported)`,
  });
}

async function wait() {
  const id = rest[0];
  if (!id) usage();
  const timeout = Number(flag("timeout", "3600")) * 1000;
  const interval = Number(flag("interval", "5")) * 1000;
  const deadline = Date.now() + timeout;

  for (;;) {
    const status = dispatchStatus(id);
    if (status.complete || Date.now() >= deadline) {
      print({
        dispatch: id,
        title: status.manifest.title,
        complete: status.complete,
        pending: status.pending,
        failed: Object.values(status.markers)
          .filter((m) => m.status === "failed")
          .map((m) => m.worker),
        handbacks: status.markers,
      });
      process.exit(status.complete ? 0 : 2);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

function done() {
  const [id, worker] = rest;
  const summary = flag("summary");
  if (!id || !worker || !summary) usage();
  const status = flag("status", "ok");
  if (status !== "ok" && status !== "failed") {
    throw new Error("--status is ok or failed");
  }
  writeMarker({
    dispatchId: id,
    worker,
    status,
    summary,
    result: flag("result") ?? null,
    sessionId,
    at: Date.now(),
  });
  print({ dispatch: id, worker, status, recorded: true });
}

function status() {
  const id = rest[0];
  if (!id) usage();
  const s = dispatchStatus(id);
  print({
    dispatch: id,
    title: s.manifest.title,
    complete: s.complete,
    pending: s.pending,
    workers: s.manifest.workers.map((w) => ({
      key: w.key,
      sessionId: w.sessionId,
      status: s.markers[w.key]?.status ?? "pending",
    })),
  });
}

function list() {
  print(
    listDispatches().map((id) => {
      const m = readManifest(id);
      const s = dispatchStatus(id);
      return {
        dispatch: id,
        title: m.title,
        complete: s.complete,
        pending: s.pending,
      };
    }),
  );
}

try {
  if (command === "fanout") await fanout();
  else if (command === "wait") await wait();
  else if (command === "done") done();
  else if (command === "status") status();
  else if (command === "list") list();
  else usage();
} catch (err) {
  process.stderr.write(`seamux: ${(err as Error).message}\n`);
  process.exit(1);
}

// The coordination protocol for fan-out work.
//
// 1. A dispatch is a declared set: the manifest names every worker before
//    any of them is spawned.
// 2. Completion is a marker, not file existence: a worker finishes its
//    output, then atomically writes <worker>.done.json.
// 3. The parent waits on a barrier for the whole set, rather than reacting
//    to each handback as it lands.
// 4. Handbacks are structured and keyed by worker.
//
// Files live in data/dispatches/<dispatch-id>/. Imported by the board and by
// scripts/seamux.ts, which Node runs directly: relative imports with
// extensions, no TypeScript-only runtime syntax.

import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { DATA_DIR, SEAMUX_BIN } from "./paths.server.ts";

export const DISPATCH_DIR =
  process.env.SEAMUX_DISPATCH_DIR ?? join(DATA_DIR, "dispatches");

export interface WorkerSpec {
  key: string;
  cwd: string;
  prompt: string;
  worktree?: boolean;
}

export interface Manifest {
  id: string;
  title: string;
  parentSessionId: string | null;
  createdAt: number;
  // spawnedAt is when fanout started the worker's session; manifests from
  // before it was recorded have none.
  workers: (WorkerSpec & { sessionId: string | null; spawnedAt?: number })[];
}

export interface Marker {
  dispatchId: string;
  worker: string;
  status: "ok" | "failed";
  summary: string;
  result: string | null;
  sessionId: string | null;
  at: number;
}

const WORKER_KEY = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const DISPATCH_ID = /^d-[0-9a-f]{8}$/;

export function newDispatchId(): string {
  return `d-${randomBytes(4).toString("hex")}`;
}

function dir(id: string): string {
  if (!DISPATCH_ID.test(id)) throw new Error(`Not a dispatch id: ${id}`);
  return join(DISPATCH_DIR, id);
}

// Write to a temp file and rename, so readers never see a partial file.
function writeAtomic(path: string, value: unknown) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

// Checks every worker, and expands a cwd written as ~/… in place.
export function validateWorkers(workers: WorkerSpec[]) {
  if (workers.length === 0) throw new Error("A dispatch needs workers");
  const seen = new Set<string>();
  for (const w of workers) {
    if (!WORKER_KEY.test(w.key)) {
      throw new Error(
        `Worker keys are lowercase letters, digits, - _: ${w.key}`,
      );
    }
    if (seen.has(w.key)) throw new Error(`Duplicate worker key: ${w.key}`);
    seen.add(w.key);
    if (!w.prompt?.trim()) throw new Error(`Worker ${w.key} has no prompt`);
    if (w.cwd === "~" || w.cwd?.startsWith("~/")) {
      w.cwd = join(homedir(), w.cwd.slice(1));
    }
    if (!w.cwd?.startsWith("/"))
      throw new Error(`Worker ${w.key} needs an absolute cwd, or one under ~/`);
  }
}

export function writeManifest(m: Manifest) {
  mkdirSync(dir(m.id), { recursive: true });
  writeAtomic(join(dir(m.id), "manifest.json"), m);
}

export function readManifest(id: string): Manifest {
  return JSON.parse(readFileSync(join(dir(id), "manifest.json"), "utf8"));
}

export function writeMarker(marker: Marker) {
  const manifest = readManifest(marker.dispatchId);
  if (!manifest.workers.some((w) => w.key === marker.worker)) {
    throw new Error(
      `${marker.worker} is not a worker in ${marker.dispatchId}. Declared: ${manifest.workers.map((w) => w.key).join(", ")}`,
    );
  }
  writeAtomic(
    join(dir(marker.dispatchId), `${marker.worker}.done.json`),
    marker,
  );
}

export function readMarkers(id: string): Record<string, Marker> {
  const markers: Record<string, Marker> = {};
  for (const f of readdirSync(dir(id))) {
    if (!f.endsWith(".done.json")) continue;
    const m = JSON.parse(readFileSync(join(dir(id), f), "utf8")) as Marker;
    markers[m.worker] = m;
  }
  return markers;
}

export interface DispatchStatus {
  manifest: Manifest;
  markers: Record<string, Marker>;
  // Workers still expected to report.
  pending: string[];
  // Workers whose session ended without reporting.
  gone: string[];
  // Nothing left to wait for: every worker reported or is gone.
  complete: boolean;
}

// A just-spawned session can take a while to show in `claude agents` or
// cmux, so a worker is never declared gone this soon after fanout started
// it. A worker fanout never started is gone this long after its last spawn.
export const SPAWN_GRACE_MS = 5 * 60 * 1000;

// Whether a session is still running, or null when that can't be told, as
// when `claude agents` or cmux didn't answer: then no worker is gone.
export type Alive = ((sessionId: string) => boolean) | null;

export function dispatchStatus(
  id: string,
  alive: Alive = null,
  now = Date.now(),
): DispatchStatus {
  const manifest = readManifest(id);
  const markers = readMarkers(id);
  const lastSpawn = Math.max(
    manifest.createdAt,
    ...manifest.workers.map((w) => w.spawnedAt ?? 0),
  );
  const isGone = (w: Manifest["workers"][number]) => {
    if (!alive) return false;
    if (!w.sessionId) return now - lastSpawn > SPAWN_GRACE_MS;
    const spawned = w.spawnedAt ?? manifest.createdAt;
    return now - spawned > SPAWN_GRACE_MS && !alive(w.sessionId);
  };
  const unreported = manifest.workers.filter((w) => !markers[w.key]);
  const gone = unreported.filter(isGone).map((w) => w.key);
  const pending = unreported
    .map((w) => w.key)
    .filter((k) => !gone.includes(k));
  return { manifest, markers, pending, gone, complete: pending.length === 0 };
}

export function listDispatches(): string[] {
  try {
    return readdirSync(DISPATCH_DIR).filter((d) => DISPATCH_ID.test(d));
  } catch {
    return [];
  }
}

// Appended to each worker's prompt, so it knows how to report back.
export function workerInstructions(m: Manifest, key: string): string {
  return [
    "",
    "---",
    `seamux: you are worker \`${key}\` in dispatch \`${m.id}\` ("${m.title}").`,
    "Other workers are handling the other parts; stay within yours.",
    "When your work is completely finished and every output is written, report back exactly once:",
    "",
    `  ${SEAMUX_BIN} done ${m.id} ${key} --summary "<what you did and found, one paragraph>" [--result <path to your main output>]`,
    "",
    "If you cannot finish, run the same command with --status failed and explain in --summary.",
    "Do not report before your outputs are fully written: the parent treats the report as the signal that your results are safe to read.",
  ].join("\n");
}

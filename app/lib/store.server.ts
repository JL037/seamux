// The durable store: only what cannot be re-derived from the tools.
//
// Imported by the app and by the hook script, which Node runs directly with
// type stripping. So: relative imports with extensions, `import type`, and
// no TypeScript-only runtime syntax.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// Two levels up is the repo root both from app/lib/ and from the bundled
// build/server/index.js. Keep it that way if either moves.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const DB_PATH = process.env.SEAMUX_DB ?? join(REPO, "data/seamux.db");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS subagents (
    agent_id        TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    agent_type      TEXT,
    cwd             TEXT,
    transcript_path TEXT,    -- the parent session's transcript
    started_at      INTEGER, -- ms since epoch
    stopped_at      INTEGER, -- null while running
    last_message    TEXT     -- from SubagentStop
  );
  CREATE INDEX IF NOT EXISTS subagents_session ON subagents (session_id);

  -- Sessions seamux started, and why. Nothing else records a session's goal.
  CREATE TABLE IF NOT EXISTS dispatches (
    session_id     TEXT PRIMARY KEY,
    cwd            TEXT NOT NULL,
    prompt         TEXT NOT NULL,
    name           TEXT,
    worktree       TEXT,    -- worktree name, when started in a new one
    forked_from    TEXT,    -- parent session id, for a forked tangent
    dispatch_id    TEXT,    -- fan-out set this worker belongs to, if any
    worker         TEXT,    -- the worker's key within that set
    created_at     INTEGER NOT NULL
  );

  -- Sessions Jakob pinned, because they are meant to run for a long time,
  -- in the order he dragged them into; a new pin goes last. The Claude Code
  -- process a pinned chat last ran in, which \`/clear\` keeps under a new
  -- session id, and the chat a pin was carried from by one.
  CREATE TABLE IF NOT EXISTS pins (
    session_id   TEXT PRIMARY KEY,
    pinned_at    INTEGER NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0,
    pid          INTEGER,
    started_at   INTEGER,
    cleared_from TEXT
  );

  -- Messages Jakob wrote while a chat was working, held here instead of in
  -- Claude Code's queue so they can be edited. Sent in id order, one per
  -- turn, once the chat is idle; a row goes as it is sent.
  CREATE TABLE IF NOT EXISTS queued_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    text       TEXT NOT NULL,
    queued_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS queued_messages_session
    ON queued_messages (session_id);

  -- Jakob's settings, from the board's config dialog. A JSON value per key;
  -- a missing key means the default.
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

let db: DatabaseSync | null = null;

// Columns added after a table first shipped, which CREATE TABLE IF NOT
// EXISTS leaves out of an existing store.
function migrate(store: DatabaseSync): void {
  const pinColumns = store
    .prepare(`PRAGMA table_info(pins)`)
    .all() as unknown as { name: string }[];
  if (!pinColumns.some((c) => c.name === "position")) {
    store.exec(`
      ALTER TABLE pins ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
      UPDATE pins SET position =
        (SELECT COUNT(*) FROM pins p WHERE p.pinned_at < pins.pinned_at);
    `);
  }
  if (!pinColumns.some((c) => c.name === "pid")) {
    store.exec(`
      ALTER TABLE pins ADD COLUMN pid INTEGER;
      ALTER TABLE pins ADD COLUMN started_at INTEGER;
      ALTER TABLE pins ADD COLUMN cleared_from TEXT;
    `);
  }
}

export function openStore(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  // Many hooks write at once during a fan-out, so wait on locks from the
  // first statement, including the switch to WAL.
  db = new DatabaseSync(DB_PATH, { timeout: 5000 });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export interface SubagentRow {
  agent_id: string;
  session_id: string;
  agent_type: string | null;
  cwd: string | null;
  transcript_path: string | null;
  started_at: number | null;
  stopped_at: number | null;
  last_message: string | null;
}

export interface HookPayload {
  hook_event_name: string;
  session_id: string;
  agent_id?: string;
  agent_type?: string;
  cwd?: string;
  transcript_path?: string;
  last_assistant_message?: string;
}

export function recordHook(p: HookPayload, now = Date.now()): void {
  if (!p.agent_id || !p.session_id) return;
  // Claude Code's internal helper agents fire SubagentStop with an empty
  // type and never fire SubagentStart. They are not the user's subagents.
  if (!p.agent_type) return;
  const store = openStore();
  if (p.hook_event_name === "SubagentStart") {
    // A resumed subagent starts again: keep its first start, clear the stop.
    store
      .prepare(
        `INSERT INTO subagents
           (agent_id, session_id, agent_type, cwd, transcript_path, started_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (agent_id) DO UPDATE SET stopped_at = NULL`,
      )
      .run(
        p.agent_id,
        p.session_id,
        p.agent_type ?? null,
        p.cwd ?? null,
        p.transcript_path ?? null,
        now,
      );
  } else if (p.hook_event_name === "SubagentStop") {
    // Upsert, in case the start was missed (hooks installed mid-run).
    store
      .prepare(
        `INSERT INTO subagents
           (agent_id, session_id, agent_type, cwd, transcript_path, stopped_at, last_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (agent_id) DO UPDATE SET
           stopped_at = excluded.stopped_at,
           last_message = excluded.last_message`,
      )
      .run(
        p.agent_id,
        p.session_id,
        p.agent_type ?? null,
        p.cwd ?? null,
        p.transcript_path ?? null,
        now,
        p.last_assistant_message ?? null,
      );
  }
}

export function subagentsFor(
  sessionIds: string[],
  since: number,
): SubagentRow[] {
  if (sessionIds.length === 0) return [];
  const marks = sessionIds.map(() => "?").join(", ");
  return openStore()
    .prepare(
      `SELECT * FROM subagents
       WHERE session_id IN (${marks})
         AND agent_type != ''  -- rows from before the hook ignored helpers
         AND (stopped_at IS NULL OR stopped_at >= ?)
       ORDER BY started_at`,
    )
    .all(...sessionIds, since) as unknown as SubagentRow[];
}

export interface DispatchRow {
  session_id: string;
  cwd: string;
  prompt: string;
  name: string | null;
  worktree: string | null;
  forked_from: string | null;
  dispatch_id: string | null;
  worker: string | null;
  created_at: number;
}

export function recordDispatch(
  row: Omit<DispatchRow, "created_at">,
  now = Date.now(),
): void {
  openStore()
    .prepare(
      `INSERT INTO dispatches
         (session_id, cwd, prompt, name, worktree, forked_from, dispatch_id, worker, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.session_id,
      row.cwd,
      row.prompt,
      row.name,
      row.worktree,
      row.forked_from,
      row.dispatch_id,
      row.worker,
      now,
    );
}

export function dispatchesFor(sessionIds: string[]): DispatchRow[] {
  if (sessionIds.length === 0) return [];
  const marks = sessionIds.map(() => "?").join(", ");
  return openStore()
    .prepare(`SELECT * FROM dispatches WHERE session_id IN (${marks})`)
    .all(...sessionIds) as unknown as DispatchRow[];
}

export function recentDispatchCwds(limit = 50): string[] {
  return (
    openStore()
      .prepare(
        `SELECT cwd FROM dispatches GROUP BY cwd ORDER BY MAX(created_at) DESC LIMIT ?`,
      )
      .all(limit) as unknown as { cwd: string }[]
  ).map((r) => r.cwd);
}

export function pinnedSessions(): string[] {
  return (
    openStore()
      .prepare(`SELECT session_id FROM pins ORDER BY position, pinned_at`)
      .all() as unknown as { session_id: string }[]
  ).map((r) => r.session_id);
}

export interface PinRow {
  session_id: string;
  pid: number | null;
  started_at: number | null;
  cleared_from: string | null;
}

export function pins(): PinRow[] {
  return openStore()
    .prepare(
      `SELECT session_id, pid, started_at, cleared_from FROM pins
       ORDER BY position, pinned_at`,
    )
    .all() as unknown as PinRow[];
}

// Notes the process a pinned chat runs in, when it has changed.
export function notePinProcess(
  sessionId: string,
  pid: number,
  startedAt: number,
): void {
  openStore()
    .prepare(
      `UPDATE pins SET pid = ?, started_at = ?
       WHERE session_id = ? AND (pid IS NOT ? OR started_at IS NOT ?)`,
    )
    .run(pid, startedAt, sessionId, pid, startedAt);
}

// Moves a pin, in its place, to the session `/clear` carried its chat on
// under. If that session is pinned already, the old pin just goes.
export function carryPin(from: string, to: string): void {
  const store = openStore();
  const taken = store
    .prepare(`SELECT 1 FROM pins WHERE session_id = ?`)
    .get(to);
  if (taken) {
    store.prepare(`DELETE FROM pins WHERE session_id = ?`).run(from);
  } else {
    store
      .prepare(
        `UPDATE pins SET session_id = ?, cleared_from = ? WHERE session_id = ?`,
      )
      .run(to, from, from);
  }
}

export function setPinned(
  sessionId: string,
  pinned: boolean,
  now = Date.now(),
): void {
  const store = openStore();
  if (pinned) {
    store
      .prepare(
        `INSERT INTO pins (session_id, pinned_at, position)
         VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM pins))
         ON CONFLICT (session_id) DO NOTHING`,
      )
      .run(sessionId, now);
  } else {
    store.prepare(`DELETE FROM pins WHERE session_id = ?`).run(sessionId);
  }
}

// Moves a pinned session to just before `before`, or to the end when
// `before` is null or not pinned, and renumbers the rest.
export function movePin(sessionId: string, before: string | null): void {
  const store = openStore();
  store.exec("BEGIN IMMEDIATE");
  try {
    const order = pinnedSessions();
    if (!order.includes(sessionId)) throw new Error("Not pinned");
    const rest = order.filter((id) => id !== sessionId);
    const at = before === null ? -1 : rest.indexOf(before);
    rest.splice(at === -1 ? rest.length : at, 0, sessionId);
    const update = store.prepare(
      `UPDATE pins SET position = ? WHERE session_id = ?`,
    );
    rest.forEach((id, i) => update.run(i, id));
    store.exec("COMMIT");
  } catch (err) {
    store.exec("ROLLBACK");
    throw err;
  }
}

export interface QueuedRow {
  id: number;
  session_id: string;
  text: string;
  queued_at: number;
}

export function queueMessage(
  sessionId: string,
  text: string,
  now = Date.now(),
): void {
  openStore()
    .prepare(
      `INSERT INTO queued_messages (session_id, text, queued_at) VALUES (?, ?, ?)`,
    )
    .run(sessionId, text, now);
}

export function queuedFor(sessionIds: string[]): QueuedRow[] {
  if (sessionIds.length === 0) return [];
  const marks = sessionIds.map(() => "?").join(", ");
  return openStore()
    .prepare(
      `SELECT * FROM queued_messages WHERE session_id IN (${marks}) ORDER BY id`,
    )
    .all(...sessionIds) as unknown as QueuedRow[];
}

// Sessions with anything queued.
export function queuedSessions(): string[] {
  return (
    openStore()
      .prepare(`SELECT DISTINCT session_id FROM queued_messages`)
      .all() as unknown as { session_id: string }[]
  ).map((r) => r.session_id);
}

// Each of these names the session too, so a stale form can't reach another
// chat's queue. False when the message was already sent or removed.
export function editQueued(id: number, sessionId: string, text: string) {
  const { changes } = openStore()
    .prepare(
      `UPDATE queued_messages SET text = ? WHERE id = ? AND session_id = ?`,
    )
    .run(text, id, sessionId);
  return changes > 0;
}

export function takeQueued(id: number, sessionId: string): QueuedRow | null {
  return (
    (openStore()
      .prepare(
        `DELETE FROM queued_messages WHERE id = ? AND session_id = ? RETURNING *`,
      )
      .get(id, sessionId) as unknown as QueuedRow | undefined) ?? null
  );
}

// Put back a message whose send failed, in its old place.
export function restoreQueued(row: QueuedRow): void {
  openStore()
    .prepare(
      `INSERT OR IGNORE INTO queued_messages (id, session_id, text, queued_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(row.id, row.session_id, row.text, row.queued_at);
}

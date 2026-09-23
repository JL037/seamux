// The durable store: only what cannot be re-derived from the tools.
//
// Imported by the app and by the hook script, which Node runs directly with
// type stripping. So: relative imports with extensions, `import type`, and
// no TypeScript-only runtime syntax.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const DB_PATH = process.env.SEEMUX_DB ?? join(REPO, "data/seemux.db");

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
`;

let db: DatabaseSync | null = null;

export function openStore(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  // Many hooks write at once during a fan-out, so wait on locks from the
  // first statement, including the switch to WAL.
  db = new DatabaseSync(DB_PATH, { timeout: 5000 });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
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

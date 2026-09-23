// Derives the board from the running tools. Nothing here writes anywhere:
// session state comes from `claude agents --json`, waiting signals from cmux,
// card content from the transcripts on disk. If this ever disagrees with the
// tools, the tools win.

import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  DONE_VISIBLE_MS,
  SUBAGENT_STALE_MS,
  SUBAGENT_VISIBLE_MS,
  type BackgroundSession,
  type Board,
  type Card,
  type ChatMessage,
  type Column,
  type Subagent,
} from "./board";
import { subagentsFor, type SubagentRow } from "./store.server";

const run = promisify(execFile);
const CLAUDE_DIR = join(homedir(), ".claude");
const TAIL_BYTES = 2 * 1024 * 1024;
const EXCERPT_CHARS = 280;

interface AgentRow {
  sessionId: string;
  kind: "interactive" | "background";
  cwd: string;
  name: string;
  startedAt: number;
  id?: string;
  pid?: number;
  status?: "busy" | "idle";
  state?: "working" | "blocked" | "done" | "failed";
}

interface Transcript {
  path: string;
  mtimeMs: number;
}

interface TranscriptSummary {
  name: string | null;
  cwd: string | null;
  branch: string | null;
  lastPrompt: string | null;
  lastReply: string | null;
  // From the last message: is a turn in progress? null when unknown.
  turnActive: boolean | null;
}

async function readJson<T>(cmd: string, args: string[]): Promise<T> {
  const { stdout } = await run(cmd, args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 10_000,
  });
  return JSON.parse(stdout) as T;
}

async function listAgents(): Promise<AgentRow[]> {
  return readJson<AgentRow[]>("claude", ["agents", "--json", "--all"]);
}

// cwd -> { ref, needsInput } for every cmux workspace. cmux only sees sessions
// in surfaces it hosts, so this can add WAITING but never owns the columns.
async function cmuxWorkspaces(): Promise<
  Map<string, { ref: string; needsInput: boolean }>
> {
  const { workspaces } = await readJson<{
    workspaces: { id: string; ref: string; current_directory: string }[];
  }>("cmux", ["rpc", "workspace.list", "{}"]);

  const entries = await Promise.all(
    workspaces.map(async (w) => {
      const status = await readJson<{
        signals: { any_agent_needs_input: boolean };
      }>("cmux", [
        "rpc",
        "workspace.status.get",
        JSON.stringify({ workspace_id: w.id }),
      ]);
      return [
        w.current_directory,
        { ref: w.ref, needsInput: status.signals.any_agent_needs_input },
      ] as const;
    }),
  );
  return new Map(entries);
}

async function backgroundDetail(
  shortId: string,
): Promise<{ needs: string | null }> {
  try {
    const file = await open(join(CLAUDE_DIR, "jobs", shortId, "state.json"));
    try {
      const state = JSON.parse(await file.readFile("utf8"));
      return { needs: state.needs ?? null };
    } finally {
      await file.close();
    }
  } catch {
    return { needs: null };
  }
}

// sessionId -> transcript file, across every project.
async function indexTranscripts(): Promise<Map<string, Transcript>> {
  const root = join(CLAUDE_DIR, "projects");
  const index = new Map<string, Transcript>();
  for (const project of await readdir(root)) {
    let files: string[];
    try {
      files = await readdir(join(root, project));
    } catch {
      continue;
    }
    await Promise.all(
      files
        .filter((f) => f.endsWith(".jsonl"))
        .map(async (f) => {
          const path = join(root, project, f);
          const { mtimeMs } = await stat(path);
          index.set(f.slice(0, -".jsonl".length), { path, mtimeMs });
        }),
    );
  }
  return index;
}

async function readTail(path: string): Promise<string[]> {
  const file = await open(path);
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await file.read(buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    // The first line is partial unless we read from the start.
    return start > 0 ? lines.slice(1) : lines;
  } finally {
    await file.close();
  }
}

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  return parts.length ? parts.join("\n") : null;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS
    ? `${flat.slice(0, EXCERPT_CHARS - 1)}…`
    : flat;
}

// Harness-generated user turns (slash commands, caveats, reminders,
// compaction summaries).
const SYNTHETIC_PROMPT =
  /^(<(local-command|command-|system-reminder|bash-|task-notification)|This session is being continued from a previous conversation)/;

// Messages are written once complete, so the last one says whether the model
// still owes a response. This is the check on `status: busy`, which Claude
// Code also sets while internal helper agents run between turns.
function turnActive(o: any): boolean {
  if (o.type === "assistant") return o.message?.stop_reason === "tool_use";
  if (o.isMeta || o.isCompactSummary) return false;
  const content = o.message?.content;
  if (Array.isArray(content) && content.some((c) => c?.type === "tool_result"))
    return true;
  const text = (textOf(content) ?? "").trimStart();
  if (text.startsWith("[Request interrupted")) return false;
  // A task notification wakes the model; other harness turns do not.
  if (text.startsWith("<task-notification")) return true;
  return !SYNTHETIC_PROMPT.test(text);
}

async function summarize(path: string): Promise<TranscriptSummary> {
  const summary: TranscriptSummary = {
    name: null,
    cwd: null,
    branch: null,
    lastPrompt: null,
    lastReply: null,
    turnActive: null,
  };
  const lines = await readTail(path);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    let o: any;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (o.type === "custom-title" && !summary.name)
      summary.name = o.customTitle;
    if (o.type === "agent-name" && !summary.name) summary.name = o.agentName;
    if (o.cwd && !summary.cwd) summary.cwd = o.cwd;
    if (o.gitBranch && !summary.branch) summary.branch = o.gitBranch;
    if (
      summary.turnActive == null &&
      (o.type === "user" || o.type === "assistant") &&
      !o.isSidechain
    ) {
      summary.turnActive = turnActive(o);
    }
    if (o.isSidechain || o.isMeta || o.isCompactSummary) continue;

    const text = textOf(o.message?.content);
    if (!text) continue;
    if (o.type === "assistant" && !summary.lastReply) {
      summary.lastReply = excerpt(text);
    }
    if (
      o.type === "user" &&
      !summary.lastPrompt &&
      !SYNTHETIC_PROMPT.test(text.trimStart())
    ) {
      summary.lastPrompt = excerpt(text);
    }
    if (
      summary.lastPrompt &&
      summary.lastReply &&
      summary.turnActive != null &&
      summary.cwd &&
      summary.branch
    )
      break;
  }
  return summary;
}

const MESSAGE_CHARS = 20_000;

// The visible conversation, oldest first: what Jakob and the agent said to
// each other, without tool traffic, sidechains, or harness turns.
export async function loadMessages(
  sessionId: string,
  limit = 60,
): Promise<ChatMessage[] | null> {
  const transcript = (await indexTranscripts()).get(sessionId);
  if (!transcript) return null;

  const messages: ChatMessage[] = [];
  for (const line of await readTail(transcript.path)) {
    if (!line) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "user" && o.type !== "assistant") continue;
    if (o.isSidechain || o.isMeta || o.isCompactSummary) continue;
    const text = textOf(o.message?.content)?.trim();
    if (!text) continue;
    if (o.type === "user" && SYNTHETIC_PROMPT.test(text)) continue;
    messages.push({
      role: o.type,
      text:
        text.length > MESSAGE_CHARS ? `${text.slice(0, MESSAGE_CHARS)}…` : text,
      at: o.timestamp ?? null,
    });
  }
  return messages.slice(-limit);
}

// Claude Code keeps each subagent's transcript and metadata next to the
// parent's: <parent>/<session-id>/subagents/agent-<id>.{jsonl,meta.json}.
async function toSubagent(
  row: SubagentRow,
  parentTranscript: string | undefined,
  now: number,
): Promise<Subagent> {
  let description: string | null = null;
  let quietSince: number | null = null;
  if (parentTranscript) {
    const base = join(
      dirname(parentTranscript),
      row.session_id,
      "subagents",
      `agent-${row.agent_id}`,
    );
    try {
      const meta = JSON.parse(await readFile(`${base}.meta.json`, "utf8"));
      description = meta.description ?? null;
    } catch {}
    try {
      quietSince = (await stat(`${base}.jsonl`)).mtimeMs;
    } catch {}
  }
  const running = row.stopped_at == null;
  const lastWrite = quietSince ?? row.started_at ?? 0;
  return {
    agentId: row.agent_id,
    type: row.agent_type,
    description,
    running,
    stale: running && now - lastWrite > SUBAGENT_STALE_MS,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    lastMessage: row.last_message ? excerpt(row.last_message) : null,
  };
}

async function toBackground(row: AgentRow): Promise<BackgroundSession> {
  const shortId = row.id ?? row.sessionId.slice(0, 8);
  const { needs } = await backgroundDetail(shortId);
  return { id: shortId, name: row.name, state: row.state ?? "unknown", needs };
}

function liveColumn(
  row: AgentRow,
  turnActive: boolean | null,
  needsInput: boolean,
  background: BackgroundSession[],
  subagents: Subagent[],
): Column {
  // A failed or blocked child needs Jakob just as much as a blocked parent.
  const childNeedsHuman = background.some(
    (b) => b.state === "blocked" || b.state === "failed",
  );
  if (needsInput || childNeedsHuman) return "waiting";
  // A parent at rest while its subagents run is still working.
  // Busy only counts when the transcript agrees a turn is running.
  const busy = row.status === "busy" && turnActive !== false;
  if (busy || subagents.some((s) => s.running && !s.stale)) return "working";
  return "idle";
}

export async function loadBoard(now = Date.now()): Promise<Board> {
  const warnings: string[] = [];

  const [agents, workspaces, transcripts] = await Promise.all([
    listAgents(),
    cmuxWorkspaces().catch((err) => {
      warnings.push(
        `cmux unavailable, WAITING may be incomplete: ${err.message}`,
      );
      return new Map<string, { ref: string; needsInput: boolean }>();
    }),
    indexTranscripts(),
  ]);

  // A background session attached to a terminal has a live `status`; it is a
  // chat Jakob is in, so it gets a card like any interactive session.
  const isChat = (a: AgentRow) => a.kind === "interactive" || a.status != null;
  const interactive = agents.filter(isChat);
  const backgroundRows = agents.filter((a) => !isChat(a));
  const background = await Promise.all(backgroundRows.map(toBackground));

  // Background sessions carry no parent id, so attach them to the live chat
  // in the same directory. Ones with no live chat there are orphans.
  const liveCwds = new Set(interactive.map((a) => a.cwd));
  const childrenByCwd = new Map<string, BackgroundSession[]>();
  const orphans: Board["orphans"] = [];
  backgroundRows.forEach((row, i) => {
    if (liveCwds.has(row.cwd)) {
      const list = childrenByCwd.get(row.cwd) ?? [];
      list.push(background[i]);
      childrenByCwd.set(row.cwd, list);
    } else {
      orphans.push({ ...background[i], cwd: row.cwd });
    }
  });

  let subagentRows: SubagentRow[] = [];
  try {
    subagentRows = subagentsFor(
      interactive.map((a) => a.sessionId),
      now - SUBAGENT_VISIBLE_MS,
    );
  } catch (err) {
    warnings.push(`Subagent store unavailable: ${(err as Error).message}`);
  }

  const liveCards = await Promise.all(
    interactive.map(async (row): Promise<Card> => {
      const transcript = transcripts.get(row.sessionId);
      const summary = transcript ? await summarize(transcript.path) : null;
      const ws = workspaces.get(row.cwd);
      const children = childrenByCwd.get(row.cwd) ?? [];
      const subagents = await Promise.all(
        subagentRows
          .filter((s) => s.session_id === row.sessionId)
          .map((s) => toSubagent(s, transcript?.path, now)),
      );
      return {
        sessionId: row.sessionId,
        name: row.name,
        cwd: row.cwd,
        column: liveColumn(
          row,
          summary?.turnActive ?? null,
          ws?.needsInput ?? false,
          children,
          subagents,
        ),
        branch: summary?.branch ?? null,
        lastActivityAt: transcript?.mtimeMs ?? null,
        lastPrompt: summary?.lastPrompt ?? null,
        lastReply: summary?.lastReply ?? null,
        workspaceRef: ws?.ref ?? null,
        background: children,
        subagents,
      };
    }),
  );

  // DONE: a chat Jakob closed recently. It is no longer live, is not a
  // background job, and its transcript was written within the window.
  const known = new Set(agents.map((a) => a.sessionId));
  const recent = [...transcripts.entries()].filter(
    ([id, t]) => !known.has(id) && now - t.mtimeMs < DONE_VISIBLE_MS,
  );
  const doneCards = await Promise.all(
    recent.map(async ([sessionId, t]): Promise<Card> => {
      const s = await summarize(t.path);
      return {
        sessionId,
        name: s.name ?? sessionId.slice(0, 8),
        cwd: s.cwd ?? "",
        column: "done",
        branch: s.branch,
        lastActivityAt: t.mtimeMs,
        lastPrompt: s.lastPrompt,
        lastReply: s.lastReply,
        workspaceRef: null,
        background: [],
        subagents: [],
      };
    }),
  );

  const cards = [...liveCards, ...doneCards].sort(
    (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
  );
  return { generatedAt: now, cards, orphans, warnings };
}

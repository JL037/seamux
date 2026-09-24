// Derives the board from the running tools. Nothing here writes anywhere:
// session state comes from `claude agents --json`, and card content from
// the transcripts on disk. If this ever disagrees with the tools, the tools
// win.

import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  ASKED_IN_REPLY,
  DISPATCH_VISIBLE_MS,
  DONE_VISIBLE_MS,
  SUBAGENT_STALE_MS,
  SUBAGENT_VISIBLE_MS,
  type BackgroundSession,
  type Board,
  type Card,
  type ChatMessage,
  type Column,
  type ContextUsage,
  type DispatchSet,
  type Question,
  type Subagent,
  type Waiting,
} from "./board";
import { closingState, listSurfaces, type Surface } from "./drive.server";
import { dispatchStatus, listDispatches } from "./protocol.server";
import {
  dispatchesFor,
  pinnedSessions,
  queuedFor,
  recentDispatchCwds,
  subagentsFor,
  type SubagentRow,
} from "./store.server";

const run = promisify(execFile);
const CLAUDE_DIR = join(homedir(), ".claude");
const TAIL_BYTES = 2 * 1024 * 1024;
const EXCERPT_CHARS = 280;
// A card renders its last reply as markdown, clipped to a few lines.
const REPLY_EXCERPT_CHARS = 800;

interface AgentRow {
  sessionId: string;
  kind: "interactive" | "background";
  cwd: string;
  name: string;
  startedAt: number;
  id?: string;
  pid?: number;
  // "waiting" when a dialog is open, with `waitingFor` saying which kind.
  status?: "busy" | "idle" | "waiting";
  waitingFor?: string;
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
  // The tool call the last message is waiting on, if any.
  pendingTool: { id: string; name: string; input: any } | null;
  // The question the last message ended the turn on, if it did.
  question: string | null;
  // How full the context window is, from the last response's usage.
  context: ContextUsage | null;
  // Prompts Jakob typed while a turn ran, not yet taken up by the chat.
  queued: string[];
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

interface Workspace {
  id: string;
  ref: string;
  cwd: string;
}

// Every cmux workspace, for the card's workspace ref. Its needs-input
// signal is not read: it stays set after the dialog is answered, and
// `claude agents` reports waiting itself.
async function cmuxWorkspaces(): Promise<Workspace[]> {
  const { workspaces } = await readJson<{
    workspaces: { id: string; ref: string; current_directory: string }[];
  }>("cmux", ["rpc", "workspace.list", "{}"]);
  return workspaces.map((w) => ({
    id: w.id,
    ref: w.ref,
    cwd: w.current_directory,
  }));
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

// The end of a reply, where it says what was done or asks what's next, with
// the line breaks its markdown is built on. It starts at a line, and reopens
// a code block it starts inside.
function replyExcerpt(text: string): string {
  const kept = text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (kept.length <= REPLY_EXCERPT_CHARS) return kept;
  let tail = kept.slice(-REPLY_EXCERPT_CHARS);
  const line = tail.indexOf("\n");
  if (line >= 0 && line < tail.length - 1) tail = tail.slice(line + 1);
  const fences = (tail.match(/^\s*```/gm) ?? []).length;
  return fences % 2 ? `\`\`\`\n${tail}` : tail;
}

// Harness-generated user turns (slash commands, caveats, reminders,
// compaction summaries).
const SYNTHETIC_PROMPT =
  /^(<(local-command|command-|system-reminder|bash-|task-notification)|This session is being continued from a previous conversation|\[Request interrupted)/;

// What the harness queues for the chat on its own: background task and
// subagent hand-backs. The rest of the queue is prompts Jakob typed.
const HARNESS_QUEUED = /^<(task-notification|agent-message)[\s>]/;

// Claude Code logs its input queue as it changes. Replaying the log gives
// what is still queued. A dequeue takes a typed prompt ahead of harness
// items, and a remove names the item it drops.
function queuedPrompts(lines: string[]): string[] {
  let queue: string[] = [];
  for (const line of lines) {
    if (!line.includes('"queue-operation"')) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "queue-operation") continue;
    const content = typeof o.content === "string" ? o.content : "";
    if (o.operation === "enqueue") queue.push(content);
    else if (o.operation === "popAll") queue = [];
    else if (o.operation === "dequeue") {
      const typed = queue.findIndex((c) => !HARNESS_QUEUED.test(c));
      queue.splice(typed >= 0 ? typed : 0, 1);
    } else if (o.operation === "remove") {
      const at = queue.indexOf(content);
      if (at >= 0) queue.splice(at, 1);
    }
  }
  return queue.filter((c) => !HARNESS_QUEUED.test(c));
}

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

// The last tool call in an assistant message that stopped to run tools. When
// the session is waiting, its dialog belongs to this call.
function pendingTool(o: any): TranscriptSummary["pendingTool"] {
  if (o.type !== "assistant" || o.message?.stop_reason !== "tool_use")
    return null;
  const content = o.message?.content;
  if (!Array.isArray(content)) return null;
  const call = content.filter((c: any) => c?.type === "tool_use").at(-1);
  return call
    ? { id: call.id, name: call.name, input: call.input ?? {} }
    : null;
}

// The last paragraph of a reply that ended the turn on a question, so the
// chat is waiting on Jakob although no dialog is open. Trailing markdown
// such as bold or a closing quote does not hide the question mark.
function endingQuestion(o: any): string | null {
  if (o.type !== "assistant" || o.message?.stop_reason !== "end_turn")
    return null;
  const text = textOf(o.message?.content)?.trim();
  if (!text || !/\?[*_`"')\]]*$/.test(text)) return null;
  const last = text.split(/\n\s*\n/).at(-1) ?? text;
  return excerpt(last.replace(/\*\*|__|`/g, ""));
}

// Transcripts record the model but not its window: a 1M session is logged
// as plain `claude-opus-5`. Opus runs with 1M here; anything else is taken
// at 200k until a response shows it holding more.
const WINDOW = 200_000;
const LARGE_WINDOW = 1_000_000;

// What the next request would send: everything this response read, plus
// what it wrote.
function contextUsage(o: any): ContextUsage | null {
  const m = o.message;
  const u = m?.usage;
  if (!u || m.model === "<synthetic>") return null;
  const used =
    (u.input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.output_tokens ?? 0);
  const large = /opus/.test(m.model ?? "") || used > WINDOW;
  return { used, window: large ? LARGE_WINDOW : WINDOW };
}

async function summarize(path: string): Promise<TranscriptSummary> {
  const summary: TranscriptSummary = {
    name: null,
    cwd: null,
    branch: null,
    lastPrompt: null,
    lastReply: null,
    turnActive: null,
    pendingTool: null,
    question: null,
    context: null,
    queued: [],
  };
  // Settled by the last response, or by a compaction after it, which leaves
  // the window's size unknown until the next response.
  let contextKnown = false;
  const lines = await readTail(path);
  summary.queued = queuedPrompts(lines);
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
      summary.pendingTool = pendingTool(o);
      summary.question = endingQuestion(o);
    }
    if (!contextKnown && !o.isSidechain) {
      if (o.isCompactSummary) contextKnown = true;
      else if (o.type === "assistant") {
        summary.context = contextUsage(o);
        contextKnown = summary.context != null;
      }
    }
    if (o.isSidechain || o.isMeta || o.isCompactSummary) continue;

    const text = textOf(o.message?.content);
    if (!text) continue;
    if (o.type === "assistant" && !summary.lastReply) {
      summary.lastReply = replyExcerpt(text);
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
      contextKnown &&
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
// What resuming a closed chat needs, read server-side from its transcript.
// null when the session is still live, since resuming would run a second
// process on the same conversation.
export async function closedSession(
  sessionId: string,
): Promise<{ cwd: string; name: string } | null> {
  const [agents, transcripts] = await Promise.all([
    listAgents(),
    indexTranscripts(),
  ]);
  if (agents.some((a) => a.sessionId === sessionId)) return null;
  return infoFrom(sessionId, transcripts.get(sessionId));
}

// A session's directory and name, live or not, from its transcript.
export async function sessionInfo(
  sessionId: string,
): Promise<{ cwd: string; name: string } | null> {
  return infoFrom(sessionId, (await indexTranscripts()).get(sessionId));
}

async function infoFrom(sessionId: string, transcript: Transcript | undefined) {
  if (!transcript) return null;
  const s = await summarize(transcript.path);
  return s.cwd ? { cwd: s.cwd, name: s.name ?? sessionId.slice(0, 8) } : null;
}

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

// The questions of an open AskUserQuestion call, or null when the input is
// not the shape the board knows how to answer.
function questionsOf(input: any): Question[] | null {
  if (!Array.isArray(input?.questions) || input.questions.length === 0)
    return null;
  const questions: Question[] = [];
  for (const q of input.questions) {
    if (typeof q?.question !== "string" || !Array.isArray(q.options))
      return null;
    // Options are picked by digit, so at most nine, less "Type something".
    if (q.options.length === 0 || q.options.length > 8) return null;
    questions.push({
      question: q.question,
      header: typeof q.header === "string" ? q.header : null,
      multiSelect: q.multiSelect === true,
      options: q.options.map((o: any) => ({
        label: String(o?.label ?? ""),
        description: typeof o?.description === "string" ? o.description : null,
      })),
    });
  }
  return questions;
}

// What a waiting tool call is about, in one line.
function toolDetail(input: any): string | null {
  const v =
    input?.command ?? input?.file_path ?? input?.url ?? input?.description;
  if (typeof v === "string") return excerpt(v);
  const json = JSON.stringify(input ?? {});
  return json === "{}" ? null : excerpt(json);
}

function waitingOn(
  row: AgentRow,
  summary: TranscriptSummary | null,
): Waiting | null {
  if (row.status === "idle" && summary?.question) {
    return {
      reason: ASKED_IN_REPLY,
      tool: null,
      detail: summary.question,
      ask: null,
      approval: null,
    };
  }
  if (row.status !== "waiting") return null;
  const tool = summary?.pendingTool ?? null;
  const questions =
    tool?.name === "AskUserQuestion" ? questionsOf(tool.input) : null;
  return {
    reason: row.waitingFor ?? null,
    tool: tool?.name ?? null,
    detail: tool && !questions ? toolDetail(tool.input) : null,
    ask: tool && questions ? { toolUseId: tool.id, questions } : null,
    approval:
      tool && !questions && row.waitingFor === "permission prompt"
        ? { toolUseId: tool.id }
        : null,
  };
}

// Busy only counts when the transcript agrees a turn is running.
function turnRunning(row: AgentRow, turnActive: boolean | null): boolean {
  return row.status === "busy" && turnActive !== false;
}

function liveColumn(
  busy: boolean,
  needsInput: boolean,
  background: BackgroundSession[],
  subagents: Subagent[],
): Column {
  // A blocked child needs Jakob just as much as a blocked parent. A failed
  // one is over: it shows on the card but asks nothing of Jakob.
  const childNeedsHuman = background.some((b) => b.state === "blocked");
  if (needsInput || childNeedsHuman) return "waiting";
  // A parent at rest while its subagents run is still working.
  if (busy || subagents.some((s) => s.running && !s.stale)) return "working";
  return "idle";
}

export async function loadBoard(now = Date.now()): Promise<Board> {
  const warnings: string[] = [];

  const [agents, workspaces, transcripts] = await Promise.all([
    listAgents(),
    cmuxWorkspaces().catch((err) => {
      warnings.push(`cmux unavailable, workspace refs missing: ${err.message}`);
      return [] as Workspace[];
    }),
    indexTranscripts(),
  ]);
  const surfaces = await listSurfaces().catch((err) => {
    warnings.push(
      `cmux sessions unavailable, replies disabled: ${err.message}`,
    );
    return new Map<string, Surface>();
  });

  // A background session attached to a terminal has a live `status`; it is a
  // chat Jakob is in, so it gets a card like any interactive session.
  const isChat = (a: AgentRow) => a.kind === "interactive" || a.status != null;
  const interactive = agents.filter(isChat);
  const backgroundRows = agents.filter((a) => !isChat(a));
  const background = await Promise.all(backgroundRows.map(toBackground));

  // Background sessions carry no parent id, so attach them to the live
  // chats in the same directory that started before them: a chat cannot
  // have spawned a session older than itself. The rest are orphans.
  const parentOf = (parent: AgentRow, child: AgentRow) =>
    parent.cwd === child.cwd && parent.startedAt <= child.startedAt;
  const childrenOf = (parent: AgentRow) =>
    background.filter((_, i) => parentOf(parent, backgroundRows[i]));
  const orphans: Board["orphans"] = [];
  backgroundRows.forEach((row, i) => {
    if (!interactive.some((p) => parentOf(p, row))) {
      orphans.push({
        ...background[i],
        cwd: row.cwd,
        sessionId: row.sessionId,
      });
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
      // The session's own workspace when cmux hosts it; otherwise the one
      // open in the same directory.
      const surface = surfaces.get(row.sessionId);
      const ws = surface
        ? workspaces.find((w) => w.id === surface.workspaceId)
        : workspaces.find((w) => w.cwd === row.cwd);
      const children = childrenOf(row);
      const subagents = await Promise.all(
        subagentRows
          .filter((s) => s.session_id === row.sessionId)
          .map((s) => toSubagent(s, transcript?.path, now)),
      );
      const busy = turnRunning(row, summary?.turnActive ?? null);
      const waiting = waitingOn(row, summary);
      return {
        sessionId: row.sessionId,
        name: row.name,
        cwd: row.cwd,
        column: liveColumn(busy, waiting != null, children, subagents),
        branch: summary?.branch ?? null,
        lastActivityAt: transcript?.mtimeMs ?? null,
        lastPrompt: summary?.lastPrompt ?? null,
        lastReply: summary?.lastReply ?? null,
        context: summary?.context ?? null,
        terminalQueue: summary?.queued ?? [],
        boardQueue: [],
        workspaceRef: ws?.ref ?? null,
        intent: null,
        forkedFrom: null,
        worker: null,
        drivable: surfaces.has(row.sessionId),
        turnRunning: busy,
        pinned: false,
        waiting,
        closing: closingState(row.sessionId),
        background: children,
        subagents,
      };
    }),
  );

  let pinned = new Set<string>();
  try {
    pinned = new Set(pinnedSessions());
  } catch (err) {
    warnings.push(`Pin store unavailable: ${(err as Error).message}`);
  }

  // DONE: a chat Jakob closed recently, or a pinned one closed at any time.
  // It is no longer live, is not a background job, and its transcript was
  // written within the window unless it is pinned.
  const known = new Set(agents.map((a) => a.sessionId));
  const recent = [...transcripts.entries()].filter(
    ([id, t]) =>
      !known.has(id) && (pinned.has(id) || now - t.mtimeMs < DONE_VISIBLE_MS),
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
        context: s.context,
        terminalQueue: [],
        boardQueue: [],
        workspaceRef: null,
        intent: null,
        forkedFrom: null,
        worker: null,
        drivable: false,
        turnRunning: false,
        pinned: false,
        waiting: null,
        closing: null,
        background: [],
        subagents: [],
      };
    }),
  );

  const cards = [...liveCards, ...doneCards];
  for (const card of cards) card.pinned = pinned.has(card.sessionId);
  try {
    for (const row of queuedFor(cards.map((c) => c.sessionId))) {
      cards
        .find((c) => c.sessionId === row.session_id)
        ?.boardQueue.push({ id: row.id, text: row.text, queuedAt: row.queued_at });
    }
  } catch (err) {
    warnings.push(`Queue store unavailable: ${(err as Error).message}`);
  }
  try {
    const intents = new Map(
      dispatchesFor(cards.map((c) => c.sessionId)).map((d) => [
        d.session_id,
        d,
      ]),
    );
    for (const card of cards) {
      const d = intents.get(card.sessionId);
      if (d) {
        card.intent = excerpt(d.prompt);
        card.forkedFrom = d.forked_from;
        if (d.dispatch_id && d.worker) {
          card.worker = {
            dispatchId: d.dispatch_id,
            key: d.worker,
            reported: null,
          };
        }
      }
    }
  } catch (err) {
    warnings.push(`Dispatch store unavailable: ${(err as Error).message}`);
  }
  cards.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  const dispatches = loadDispatchSets(now, warnings);
  const reported = new Map(
    dispatches.flatMap((d) =>
      d.workers.map((w) => [`${d.id}/${w.key}`, w.status]),
    ),
  );
  for (const card of cards) {
    if (card.worker) {
      card.worker.reported =
        reported.get(`${card.worker.dispatchId}/${card.worker.key}`) ?? null;
    }
  }
  return {
    generatedAt: now,
    version: await servedVersion(),
    cards,
    dispatches,
    orphans,
    warnings,
  };
}

// Two levels up is the repo root from app/lib/ and from build/server/.
const SEAMUX_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function servedVersion(): Promise<string | null> {
  try {
    const { stdout } = await run(
      "git",
      ["-C", SEAMUX_ROOT, "log", "-1", "--format=%h %s"],
      { timeout: 5_000 },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

const REPO_ROOTS = [join(homedir(), "code")];

// Git repos up to two levels under each root, e.g. ~/code/seamux and
// ~/code/taskless/cli.
async function gitRepos(): Promise<string[]> {
  const found: string[] = [];
  async function scan(dir: string, depth: number) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === ".git")) found.push(dir);
    if (depth === 0) return;
    await Promise.all(
      entries
        .filter(
          (e) =>
            e.isDirectory() &&
            !e.name.startsWith(".") &&
            e.name !== "node_modules",
        )
        .map((e) => scan(join(dir, e.name), depth - 1)),
    );
  }
  await Promise.all(REPO_ROOTS.map((r) => scan(r, 2)));
  return found;
}

// Where new work is likely to go: directories in use right now first, then
// past dispatches, then every repo on disk.
export async function knownDirectories(): Promise<string[]> {
  const [agents, workspaces, repos] = await Promise.all([
    listAgents().catch(() => [] as AgentRow[]),
    cmuxWorkspaces().catch(() => [] as Workspace[]),
    gitRepos(),
  ]);
  let dispatched: string[] = [];
  try {
    dispatched = recentDispatchCwds();
  } catch {}
  const all = [
    ...agents.map((a) => a.cwd),
    ...workspaces.map((w) => w.cwd),
    ...dispatched,
    ...repos.sort(),
  ];
  return [...new Set(all)].filter((d) => d.startsWith(`${homedir()}/`));
}

// Fan-outs still waiting on workers, and complete ones from the last day.
function loadDispatchSets(now: number, warnings: string[]): DispatchSet[] {
  const sets: DispatchSet[] = [];
  for (const id of listDispatches()) {
    try {
      const s = dispatchStatus(id);
      if (s.complete && now - s.manifest.createdAt > DISPATCH_VISIBLE_MS)
        continue;
      sets.push({
        id,
        title: s.manifest.title,
        createdAt: s.manifest.createdAt,
        workers: s.manifest.workers.map((w) => ({
          key: w.key,
          sessionId: w.sessionId,
          status: s.markers[w.key]?.status ?? null,
        })),
      });
    } catch (err) {
      warnings.push(`Dispatch ${id} unreadable: ${(err as Error).message}`);
    }
  }
  return sets.sort((a, b) => b.createdAt - a.createdAt);
}

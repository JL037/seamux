// Shared board types. Safe to import from client and server.

export const COLUMNS = ["idle", "waiting", "working", "done"] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABELS: Record<Column, string> = {
  idle: "Idle",
  waiting: "Waiting",
  working: "Working",
  done: "Done",
};

// A background session, shown only as a fact about its parent card.
// We never drive these directly; they belong to the chat that spawned them.
export interface BackgroundSession {
  id: string;
  name: string;
  state: string;
  needs: string | null;
}

// A subagent, from the SubagentStart / SubagentStop hooks, described from
// its own transcript metadata.
export interface Subagent {
  agentId: string;
  type: string | null;
  description: string | null;
  running: boolean;
  // Running with no Stop, but its transcript has gone quiet. Usually a
  // session that was killed before the hook could fire.
  stale: boolean;
  startedAt: number | null;
  stoppedAt: number | null;
  lastMessage: string | null;
}

// One question from an open AskUserQuestion call, as the model asked it.
export interface Question {
  question: string;
  header: string | null;
  multiSelect: boolean;
  options: { label: string; description: string | null }[];
}

// How Jakob answers one question: option indices, or his own text. Own text
// is only offered on single-select questions.
export type Answer = { picks: number[] } | { text: string };

// The reason on a chat whose turn ended on a question in its reply. Claude
// Code calls that session idle, since no dialog is open.
export const ASKED_IN_REPLY = "asked in its reply";

// What a WAITING card is blocked on.
export interface Waiting {
  // Claude Code's own words, from `claude agents`: "input needed" for a
  // question, "permission prompt" for an approval. Or ASKED_IN_REPLY.
  reason: string | null;
  // The tool call the dialog belongs to, from the transcript.
  tool: string | null;
  detail: string | null;
  // An open AskUserQuestion, which the board can answer.
  ask: { toolUseId: string; questions: Question[] } | null;
}

// Tokens in the chat's context against the size of its window.
export interface ContextUsage {
  used: number;
  window: number;
}

export interface Card {
  sessionId: string;
  name: string;
  cwd: string;
  column: Column;
  branch: string | null;
  lastActivityAt: number | null;
  lastPrompt: string | null;
  lastReply: string | null;
  // null until the chat's first response, and again just after a compaction.
  context: ContextUsage | null;
  // Prompts typed into the terminal that wait in Claude Code's own queue.
  terminalQueue: string[];
  // Messages seamux holds for the chat, sent in order once it is idle.
  boardQueue: QueuedMessage[];
  workspaceRef: string | null;
  // What the session was dispatched or forked to do, if seamux started it.
  intent: string | null;
  forkedFrom: string | null;
  // Set when the session is a worker in a fan-out.
  worker: {
    dispatchId: string;
    key: string;
    reported: "ok" | "failed" | null;
  } | null;
  // Running in a cmux surface, so the board can send into it.
  drivable: boolean;
  // The chat's own turn is running, so Esc has something to stop. A card can
  // be WORKING without one, while only its subagents run.
  turnRunning: boolean;
  // Pinned from the board: shown in its own column whatever its state, and
  // kept on the board after it closes, however long ago.
  pinned: boolean;
  // Set when the chat itself is blocked on a dialog.
  waiting: Waiting | null;
  // Set while the board is closing it through the close-session macro, or
  // when such a close was held and left the chat open.
  closing: { state: "cleaning" | "held"; note: string | null } | null;
  background: BackgroundSession[];
  subagents: Subagent[];
}

export interface QueuedMessage {
  id: number;
  text: string;
  queuedAt: number;
}

// A fan-out set from the protocol, and which workers have reported.
export interface DispatchSet {
  id: string;
  title: string;
  createdAt: number;
  workers: {
    key: string;
    sessionId: string | null;
    status: "ok" | "failed" | null;
  }[];
}

export interface Board {
  generatedAt: number;
  // The commit the board is serving, so a landed change is visible.
  version: string | null;
  cards: Card[];
  dispatches: DispatchSet[];
  // Background sessions not matched to an open chat. Every one `claude
  // agents` still lists can be brought back with `claude attach`.
  orphans: (BackgroundSession & { cwd: string; sessionId: string })[];
  warnings: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: string | null;
}

// Finished subagents stay on their card for this long.
export const SUBAGENT_VISIBLE_MS = 30 * 60 * 1000;
// A running subagent whose transcript is quiet this long is marked stale.
export const SUBAGENT_STALE_MS = 15 * 60 * 1000;

// Complete fan-outs stay on the board for this long.
export const DISPATCH_VISIBLE_MS = 24 * 60 * 60 * 1000;

// DONE cards stay visible for this long after the chat closes.
export const DONE_VISIBLE_MS = 30 * 60 * 1000;

// Whether /exit is safe: the turn is over and no dialog is open, so it
// would land in an empty prompt box.
export function closable(card: Card): boolean {
  return card.column === "idle" || card.waiting?.reason === ASKED_IN_REPLY;
}

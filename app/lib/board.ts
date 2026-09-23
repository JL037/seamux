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

export interface Card {
  sessionId: string;
  name: string;
  cwd: string;
  column: Column;
  branch: string | null;
  lastActivityAt: number | null;
  lastPrompt: string | null;
  lastReply: string | null;
  workspaceRef: string | null;
  // Running in a cmux surface, so the board can send into it.
  drivable: boolean;
  background: BackgroundSession[];
  subagents: Subagent[];
}

export interface Board {
  generatedAt: number;
  cards: Card[];
  // Background sessions whose parent chat is no longer live.
  orphans: (BackgroundSession & { cwd: string })[];
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

// DONE cards stay visible for this long after the chat closes.
export const DONE_VISIBLE_MS = 30 * 60 * 1000;

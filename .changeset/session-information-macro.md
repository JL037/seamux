---
"seamux": patch
---

A new Session information macro tells every session seamux dispatches that it runs inside seamux, its name and directory, and where to report a problem with seamux. It now comes first in a new session's prompt, then How to worktree, then `# User prompt` and what you typed. A skill as the prompt, such as `/gtd daily`, still runs. Clearing a chat from the board sends `/clear`, pauses, then sends Session information again, with How to worktree when the chat is in a worktree. The chat log shows these macros by name, and a card shows only what you typed. If you've customised the New session macro, Session information goes at its start; add `{{session_information}}` to put it somewhere else, or empty the Session information macro to leave it out.

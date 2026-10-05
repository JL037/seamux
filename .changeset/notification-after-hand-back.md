---
"seamux": patch
---

A chat whose subagent had finished no longer sits in Working while a background shell runs. Claude Code 2.1.285 and later log the subagent's task notification after the chat has already answered its result, and the board took that notification for a turn still running.

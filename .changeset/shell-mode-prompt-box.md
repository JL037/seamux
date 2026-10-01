---
"seamux": patch
---

Before typing a message, `/exit` or `/rename` into a Claude Code or Codex chat, the board now empties its prompt box, so a draft left there is no longer sent along with the message, and a box in shell mode (led by `!`) no longer runs it as shell commands or keeps a close from going through. Claude Code keeps what was cleared: press Ctrl+Y in the chat to get it back.

---
"seamux": patch
---

Fan-outs no longer get a strip above the columns, and worker cards no longer carry a status line. Instead, the card of the chat that ran `fanout` shows `(N workers)` after its state, and clicking it opens the chat, whose side rail lists every worker next to its subagents: whether it has reported, failed or closed without reporting, and its summary. `seamux wait`, `status` and `list` are unchanged.

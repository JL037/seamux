---
"seamux": patch
---

Fan-outs no longer get a strip above the columns, and worker cards no longer carry a status line. Instead, the card of the chat that ran `fanout` shows `(N workers)` after its state, and clicking it opens the chat, whose side rail lists every worker next to its subagents: a worker still out in full, and one that has reported, failed or closed without reporting as a single line that opens to its summary. Finished subagents fold to a line the same way, and both now leave after 10 minutes rather than 30. `seamux wait`, `status` and `list` are unchanged.

---
"seamux": patch
---

A fan-out worker whose session closes without running `seamux done` now shows as gone on the board, with its own icon, instead of leaving its strip waiting forever. `seamux wait` stops waiting for it and lists it under a new `gone` key, as do `seamux status` and `seamux list`; a worker is never counted gone in the first five minutes after `fanout` starts it. Once every worker has reported or gone, the strip leaves the board 30 minutes later, as DONE cards do, rather than staying a day.

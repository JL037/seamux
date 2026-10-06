---
"seamux": patch
---

A fan-out worker whose session closes without running `seamux done` now counts as gone, with its own icon in its parent chat's side rail, instead of being waited on forever. `seamux wait` stops waiting for it and lists it under a new `gone` key, as do `seamux status` and `seamux list`; a worker is never counted gone in the first five minutes after `fanout` starts it.

---
"seamux": patch
---

A landing on main now always reaches the board without a restart. The dev server used to miss one now and then and keep serving the old code until it restarted. The board's stylesheet is also no longer cached as immutable, which could leave a phone on an old one.

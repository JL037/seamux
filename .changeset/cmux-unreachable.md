---
"seamux": patch
---

When seamux can't reach cmux, the board now says why and how to fix it on a full-page notice, instead of two warnings and a failed send each time: seamux started outside cmux, cmux not running or not installed, cmux's socket turned off, or a socket password it doesn't have. seamux also finds the `cmux` command in cmux's app bundle when it isn't on your `PATH`.

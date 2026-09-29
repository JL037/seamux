---
"seamux": minor
---

seamux talks to cmux's control socket itself instead of through the `cmux` command, which it still needs on your PATH for `cmux sessions list`. Run from a cmux terminal, as the board usually is, it uses the access cmux gives that terminal and there is nothing to do. If you've turned on cmux's socket password, set `CMUX_SOCKET_PASSWORD` in seamux's `.env` or environment: seamux no longer picks up the password saved in cmux's Settings.

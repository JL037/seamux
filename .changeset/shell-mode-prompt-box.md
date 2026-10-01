---
"seamux": patch
---

Sending a message or closing a Claude Code chat whose prompt box is in shell mode (led by `!`) now stops with a note saying so, instead of typing onto the end of the draft there, where Enter would run it as shell commands. A close in that state used to leave the chat open with nothing sent, however many times it was tried; clear the chat's prompt box and close it again.

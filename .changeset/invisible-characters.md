---
"seamux": patch
---

A message holding an invisible character, such as a zero-width space or soft hyphen that came in with pasted text, now gets sent. Claude Code strips the character and waits for a second Enter, which seamux didn't notice, so the message sat in the chat's prompt box under "Removed 1 invisible character". seamux now presses that Enter.

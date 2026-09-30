---
"seamux": patch
---

A long message sent to a Claude Code chat now arrives whole and gets sent. Before, Claude Code 2.1.285 could take one for a paste, drop parts of it, and miss the Enter, which left the message sitting unsent in the chat's prompt box while the board showed nothing sent. seamux now types it a little at a time, with Shift+Enter between lines instead of pasting, and, if the message is still in the box, types a carriage return to send it, since a chat can ignore cmux's Enter or take it as a line break. If it still won't go, the board says so, and a queued message isn't typed a second time.

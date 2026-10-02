---
"seamux": patch
---

The board now forgets what your browser keeps for a chat (its unsent draft and attached files, whether it was minimized, and its open full view) once the chat has been gone from the board for about 100 polls in a row, a few minutes. Before, minimized chats left a key in localStorage forever, and unsent attachments held memory until the tab closed. Polls while seamux can't see every chat don't count, so a cmux outage never clears a live chat's draft.

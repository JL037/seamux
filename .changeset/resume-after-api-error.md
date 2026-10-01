---
"seamux": patch
---

Chats that stop on a failed request, such as "Can't reach the API server", "529 Overloaded" or "Your computer went to sleep mid-response", now pick themselves back up. The board checks every 10 seconds whether the API answers, and once it does, sends each such chat `continue`: 30 seconds after the error, then 60 and 120 seconds after each one that follows, then leaves it to you. ATTENTION no longer shows a card for these errors; the chat's own card shows the error muted in place of a reply. ATTENTION's card also keeps the service's name in view beside a long status.

---
"seamux": patch
---

Restart the board from a browser whose board page loaded but whose buttons don't work. After ten seconds without the board's scripts starting, the page shows "Buttons not working? Restart the board" at the bottom. That link goes to `/restart`, which asks the supervisor to restart the board's server, clears the browser's cache for the board, and returns to the board once it answers again. It works from a phone over mDNS or the tunnel, and the error page links to it too.

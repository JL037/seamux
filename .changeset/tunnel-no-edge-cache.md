---
"seamux": patch
---

The board through the Cloudflare tunnel no longer gets stuck on an old stylesheet after an update, which left it without colours: everything the board answers through the tunnel tells Cloudflare not to cache it, and the dev server's stylesheet gets a new URL each time it starts. If the board through the tunnel still looks unstyled after updating, purge the hostname's cache in the Cloudflare dashboard once.

---
"seamux": minor
---

The board now runs in one of three modes: local, mDNS or the Cloudflare tunnel, never mDNS and the tunnel together. Turning one on in the Remote tab turns the other off, and a `.seamux.json` with both on keeps the tunnel. In local and tunnel mode the board answers only requests from this Mac addressed to `localhost`, `127.0.0.1` or `[::1]`, plus the tunnel's hostname in tunnel mode, so reaching it by any other name or IP address is refused. Whenever `SEAMUX_USER` and `SEAMUX_PASS` are set, every request asks for them, from this Mac too and for every file the dev server serves, which closes a gap where files under seamux's home, such as `data/seamux.db`, could be read on localhost without them. Only requests through the tunnel skip them, since Cloudflare Access logs those in. Without credentials the board no longer turns red or calls itself "seamux (unsecured)", since it then answers only this Mac.

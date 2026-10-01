# Signing in

Knowing when Claude Code or Codex has lost its login, and signing it back in from the board, from any device, with no terminal. Measured against Claude Code 2.1.283 and codex-cli 0.156.1, each signed in and out under a throwaway `CLAUDE_CONFIG_DIR` or `CODEX_HOME` so the real login was untouched ([Sign in and out under a throwaway config](measuring.md#sign-in-and-out-under-a-throwaway-config)).

In seamux, all of it is [service.server.ts](../app/lib/service.server.ts).

## An expired login is in the transcript

Claude Code writes it as an assistant message of its own: `"isApiErrorMessage": true, "error": "authentication_failed"`, model `<synthetic>`, text "Login expired · Please run /login". Server errors take the same form with `"error": "server_error"`, such as "API Error: 529 Overloaded. ..." and "API Error: Can't reach the API server ...". So do a few that are not the service's fault: "Your computer went to sleep mid-response" and "Could not refresh your login because another Claude Code process is refreshing it".

- **Measured:** Claude Code 2.1.283.
- **In seamux:** `apiErrorOf` in [board.server.ts](../app/lib/board.server.ts); `stoppedOnLogin`, `SERVER_ERROR` and `outageOf` in [service.server.ts](../app/lib/service.server.ts).
- **See also:** [Transcripts](transcripts.md).

## `claude auth status --json` exits 1 when signed out

It prints the same JSON, with `"loggedIn": false`. `codex login status` exits 1 with "Not logged in". Each takes about 0.1s. Whether `loggedIn` stays `true` once a token has expired on the server is unmeasured, so the transcript is what says a login expired.

- **Measured:** Claude Code 2.1.283, Codex 0.156.1.
- **In seamux:** `askClaude` and `askCodex` in [service.server.ts](../app/lib/service.server.ts).
- **See also:** [An expired login is in the transcript](#an-expired-login-is-in-the-transcript).

## `claude auth login` needs no terminal

With a pipe for stdin it prints "Opening browser to sign in…" and a URL wrapped in a terminal hyperlink escape. The URL's `redirect_uri` is `platform.claude.com/oauth/code/callback`, the page that shows a code to copy. It then prints `Paste code here if prompted >` and reads the code from stdin. At the same time it opens a browser on the Mac and listens on a localhost port, and that route finishes with nothing pasted. It opens the browser through `BROWSER` when that is set, passing a second URL whose `redirect_uri` is `http://localhost:<port>/callback`, so a `BROWSER` that only records its argument opens no tab and hands over the URL that needs no code. It prints "Login successful." and exits 0, or "Login failed: Request failed with status code 400" for a bad code and exits 1.

- **Measured:** Claude Code 2.1.283.
- **In seamux:** `startLogin` and `submitLoginCode` in [service.server.ts](../app/lib/service.server.ts), and [scripts/login-browser.sh](../scripts/login-browser.sh), the `BROWSER` that records its argument.
- **See also:** [A `!` command moves to the background after 120 seconds](transcripts.md#a--command-moves-to-the-background-after-120-seconds-and-its-output-leaves-the-transcript), which is where a `/login` typed in a chat loses its URL.

## `codex login --device-auth` needs no input

It prints `https://auth.openai.com/codex/device` and a one-time code such as `YHY2-A3R06`, which expires in 15 minutes, and waits for the code to be entered there.

- **Measured:** Codex 0.156.1.
- **In seamux:** `startLogin` and `LOGIN_TIMEOUT_MS` in [service.server.ts](../app/lib/service.server.ts).
- **See also:** [Codex](codex.md).

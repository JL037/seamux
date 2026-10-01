# Measuring

How the findings in this collection were found, so the next one can be found the same way. Every technique here keeps the user's own sessions, logins and data out of reach: a measurement that could type into a real chat, sign someone out or lose a draft is not worth the result.

## Record the versions first

Every entry names the versions it was measured on, so take them before you start:

```sh
claude --version        # 2.1.286 (Claude Code)
codex --version         # codex-cli 0.156.1
cmux --version          # cmux 0.64.23 (103) [211b8bb35]
cloudflared --version   # cloudflared version 2026.9.3 (built …)
sw_vers -productVersion # macOS
```

Vite and React Router are in `package-lock.json`.

## Work in a throwaway workspace

Try a new cmux or Claude Code call against a throwaway session in its own cmux workspace, never against a live one, and close the workspace afterwards. A real chat's prompt box may hold a draft, and typing into it can send that draft or [run it as shell commands](prompt-box.md#a-prompt-box-in-shell-mode-runs-what-it-holds-as-shell-commands). Pass that workspace's surface on every call, since [cmux defaults to your own](cmux.md#cmux-rpcs-default-to-the-callers-own-surface). `tests-cmux/` works the same way.

Some behaviour shows only in a long-running chat and not a fresh one, such as [a chat ignoring cmux's Enter](prompt-box.md#a-chat-can-ignore-cmuxs-enter-while-a-lone-typed-carriage-return-sends). Write down what you saw, say it didn't reproduce in a fresh chat, and leave the live chat alone.

## Read the screen

`surface.read_text` (`cmux read-screen`) returns what the terminal shows as text: the prompt box, a dialog's options, a hint above the box. It's how seamux knows [a message stayed unsent](prompt-box.md#an-enter-that-comes-while-claude-code-is-still-taking-in-a-paste-is-lost), and how most of the dialog entries were found. Colour doesn't survive it, which is why [the slash menu's selection is invisible to it](slash-commands.md#cmux-can-read-claude-codes-slash-menu-but-it-is-no-source-for-a-list).

## Type into a raw-mode reader

To tell what cmux sends from what the agent does with it, run a small script in the throwaway workspace that puts its tty in raw mode and logs every byte it reads, then send it the same keys or text you sent the agent. That's how `enter` was shown to arrive as `\r` ([`surface.send_key` encodes a key the way a keypress would be](cmux.md#surfacesend_key-encodes-a-key-the-way-a-keypress-would-be-and-the-cmux-command-goes-through-the-socket-too)), and how 3,003 characters arriving intact showed that [Claude Code, not cmux, mangles fast typing](prompt-box.md#typed-input-that-comes-too-fast-is-taken-for-a-paste-and-mangled).

## Point a client at a socket that logs

To learn a protocol, listen on a Unix socket that logs each line it receives, and point the client at it (for cmux, through `CMUX_SOCKET_PATH`). [The control socket's protocol](cmux.md#cmuxs-control-socket-speaks-one-json-line-each-way) was read off this way. Pointing a client at a socket that doesn't exist also tells you whether it uses one at all.

## Count, then bisect

Send a known amount and count what arrives: "a 1,503-character message arrived as 481 characters" is a finding, and "long messages break" isn't. When something depends on rate or size, bisect it and record both sides of the line: 100 characters every 10 ms arrived intact, 200 every 10 ms didn't. Then the code can sit on the safe side with a margin, and the next reader knows how much.

## Sign in and out under a throwaway config

`CLAUDE_CONFIG_DIR` and `CODEX_HOME` point Claude Code and Codex at another config directory, so a sign-in or sign-out there leaves the real login alone. [Signing in](signing-in.md) was measured this way. A `BROWSER` that only records its argument shows what a command would have opened, without opening it.

## Fake a request from the network

[A Mac resolves its own `.local` name to `::1`](mdns.md#a-mac-resolves-its-own-local-name-to-1-first), so a request from the Mac to itself always looks local. `curl --resolve <name>.local:<port>:<LAN address>` sends it to the LAN address instead, which is what a phone on the network would reach.

## Try it in Playwright's WebKit

Safari's caching differs from Chrome's, and a phone is slow to iterate on. Playwright's WebKit stands in for Safari well enough to show a difference, as it did for [`Clear-Site-Data`](vite-and-react-router.md#safari-honours-clear-site-data-cache-and-chrome-ignored-it-on-127001). Confirm on the device before you rely on it.

## Never build a stand-in cmux app

A folder named `cmux.app`, or shaped like one, with an executable in `Contents/MacOS` is taken by macOS for cmux itself. Run anything from it, even a copy of `/bin/sleep`, and macOS kills it and tells the user "“cmux” is damaged and can't be opened. You should move it to the Trash.", which looks like cmux broke. To make cmux's app look like it is running, put a stand-in `ps` first on `PATH` instead, as `tests/board.test.ts` does.

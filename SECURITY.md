# Security

seamux can type into every Claude Code and Codex session on the Mac it runs on, and those sessions can run commands. A way past its checks is a way into that Mac, so please report one privately.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: the **Report a vulnerability** button under this repository's **Security** tab. Please don't open a public issue for it.

Say what you found, how to reproduce it, and which ways in it affects: the board on `127.0.0.1`, mDNS on the local network, or the Cloudflare tunnel. You should hear back within a week.

## What counts

The board is meant to answer only:

- requests from the board's own pages on `127.0.0.1`,
- with mDNS on, requests to this Mac's `.local` name carrying the board's HTTP Basic credentials,
- through the Cloudflare tunnel, requests carrying a valid Cloudflare Access token.

Anything else that can read the board, or make it act, is in scope: another website driving it from your browser, a request from the network without credentials, a tunnel request without a valid token, or a way to reach files or sessions the board shouldn't. [Remote connections](docs/remote-connections.md) describes each way in.

Out of scope: what a session does once someone who is allowed in sends it a prompt. That is the agent's own permission model.

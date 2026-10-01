# mDNS

Reaching the board on the local network by this Mac's `.local` name, behind the board's HTTP Basic credentials. Measured on macOS 26.5.1 with Vite 8.3.0 and React Router 7.18.4. [docs/remote-connections.md](../docs/remote-connections.md) is the setup guide.

In seamux: `lanHost`, `isLanHost`, `isLoopback` and `remoteGate` in [remote.server.ts](../app/lib/remote.server.ts). What the dev server does along the way is in [Vite and React Router](vite-and-react-router.md), including [Safari's cache](vite-and-react-router.md#vite-serves-its-pre-bundled-dependencies-as-immutable), which a phone on the network found first.

## `scutil --get LocalHostName` is the name Bonjour answers for

On a Mac whose `hostname` is `My-Mac.local`, it's `My-Mac`. macOS already answers for it on every network it joins, so seamux has nothing to advertise.

- **Measured:** macOS 26.5.1.
- **In seamux:** `lanHost` in [remote.server.ts](../app/lib/remote.server.ts).

## A Mac resolves its own `.local` name to `::1` first

`curl http://<name>.local:<port>/` on the Mac itself connects over loopback, so it counts as local. Testing a request from the network needs `--resolve <name>.local:<port>:<LAN address>`.

- **Measured:** macOS 26.5.1.
- **See also:** [Fake a request from the network](measuring.md#fake-a-request-from-the-network).

## Vite's `host: true` listens on `*` over IPv6, dual-stack

An IPv4 peer shows up as `::ffff:192.168.1.151`, and IPv4 loopback as `::ffff:127.0.0.1`, so the loopback check matches both forms.

- **Measured:** macOS 26.5.1, Vite 8.3.0.
- **In seamux:** `isLoopback` in [remote.server.ts](../app/lib/remote.server.ts).

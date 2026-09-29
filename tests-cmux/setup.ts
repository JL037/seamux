// The vendor contract runs against the real cmux, so it needs one: run it
// from a cmux terminal, which gives it the socket path and the capability
// token cmux checks. It never runs in CI.
//
// Everything these tests do happens in workspaces they create themselves,
// unfocused, and close again (./cmux.ts). They never name a surface they
// didn't create: an unnamed surface is the caller's own terminal.

if (!process.env.CMUX_SOCKET_PATH) {
  throw new Error(
    "tests-cmux checks seamux's contract against a real cmux: run `npm run test:cmux` from a cmux terminal",
  );
}

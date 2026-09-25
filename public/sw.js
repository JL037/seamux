// The board's service worker. It is here because phones only show
// notifications through one, and it brings the board forward when one is
// tapped. It caches nothing and handles no fetches: the board is live.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const [open] = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      return open ? open.focus() : self.clients.openWindow("/");
    })(),
  );
});

// Plan B: no web push. This file exists so a future home-screen install can
// register a worker; it does not cache JSON (stale data would be worse).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

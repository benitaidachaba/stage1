/*
 * The offline layer.
 *
 * All state lives in localStorage, so an offline app is still a fully working
 * app — this file only has to keep the shell itself loadable when the network
 * is not. Pages prefer the network with an offline fallback; static assets use
 * stale-while-revalidate. Auth, API and RSC requests bypass this cache.
 */

const CACHE = "pocket-v3";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Notification actions (PRD R2): Done, Later and Can't answer a nudge without
 * opening the app. The click is posted to every client; the app, if open,
 * applies it to the store and logs it. If no client is open there is nothing
 * to apply it to — local state lives in the page, so the answer waits for the
 * next visit in the log instead.
 */
self.addEventListener("notificationclick", (event) => {
  const action = event.action; // "done" | "later" | "cant" | undefined (body click)
  const taskId = event.notification.data && event.notification.data.taskId;
  event.notification.close();

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const message = { kind: "notification-action", action, taskId };
      if (clientList.length > 0) {
        for (const client of clientList) client.postMessage(message);
        if (clientList[0].focus) await clientList[0].focus();
        return;
      }
      // Nobody home: opening the app is still better than losing the tap.
      await self.clients.openWindow("/");
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Auth codes are single-use. They and API/RSC responses must reach the server.
  if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/") ||
      url.searchParams.has("code") || url.searchParams.has("auth") ||
      url.searchParams.has("_rsc") || request.headers.get("RSC") === "1") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);

      const refreshed = fetch(request)
        .then((response) => {
          if (response.ok && !response.redirected &&
              !/no-store|private/.test(response.headers.get("Cache-Control") || "")) {
            event.waitUntil(cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => null);

      if (request.mode === "navigate") {
        const live = await refreshed;
        if (live) return live;
      }
      if (cached) {
        // Hand back what we have immediately; the network update lands next time.
        event.waitUntil(refreshed);
        return cached;
      }

      const live = await refreshed;
      if (live) return live;

      // Offline and never cached: a navigable page beats a browser error page.
      if (request.mode === "navigate") {
        const shell = await cache.match("/");
        if (shell) return shell;
      }

      return new Response("This page needs a connection the first time you open it.", {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain" },
      });
    })(),
  );
});

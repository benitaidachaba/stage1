/*
 * The offline layer.
 *
 * All state lives in localStorage, so an offline app is still a fully working
 * app — this file only has to keep the shell itself loadable when the network
 * is not. Same-origin GETs are served stale-while-revalidate; everything else
 * is left completely alone.
 */

const CACHE = "small-steps-v1";
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

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });

      const refreshed = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

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

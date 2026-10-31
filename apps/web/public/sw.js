/* eslint-env serviceworker */

/**
 * Service worker.
 *
 * It exists for two reasons, in this order:
 *
 *   1. Chrome will not offer "Install" without one that has a fetch handler.
 *      That is the whole of the requirement — the app does not need to work
 *      offline to be installable.
 *   2. A site read on a phone, on a site, on a bad signal, benefits from the
 *      shell being local even when the data is not.
 *
 * What it deliberately does NOT do is cache anything from the API.
 *
 * This is a tracker whose entire value is that the dates on screen are the
 * dates in the database. A cached activity list that is an hour old looks
 * exactly like a current one and there is no way for the reader to tell, so
 * somebody orders against a material status that changed this morning. A
 * request that cannot reach the server must fail visibly, and the app already
 * has an error path for that. Stale data presented as live is worse than no
 * data.
 *
 * So: the shell is cached, the data never is.
 */

/**
 * Bumping this discards every previous cache on activate.
 *
 * It is deliberately a hand-edited constant rather than a build hash. The
 * entries below are content-hashed by Vite already, so the only thing a build
 * hash would change is the cache *name* — evicting a perfectly good shell on
 * every deploy and making the first load after one slower for no gain.
 */
const VERSION = 'ciq-v1';
const SHELL = `${VERSION}-shell`;

/** Fetched during install so the app opens offline at all. */
const SHELL_URLS = ['/', '/index.html', '/icon.svg', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Individually, not `addAll`: that rejects the whole install if any one
      // URL 404s, and an install failing because an icon moved would take the
      // service worker down with it.
      await Promise.all(
        SHELL_URLS.map((url) => cache.add(url).catch(() => undefined)),
      );
      // Replace the previous worker straight away. The alternative is waiting
      // for every tab to close, which on a dashboard somebody leaves open all
      // week means the update lands next month.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Anything whose freshness matters more than its availability. */
function isData(url) {
  return (
    url.pathname.startsWith('/api/') ||
    // Generated per-container from its environment. A cached copy would send
    // the app to whichever API the previous deployment used.
    url.pathname === '/config.js' ||
    url.pathname === '/healthz'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET, and only our own origin. A POST is a change and must reach the
  // server; a cross-origin request is somebody else's to cache.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isData(url)) return;

  // Navigations: network first, so a deploy is picked up on the next load, and
  // the cached shell only stands in when the network is genuinely unavailable.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(SHELL);
          cache.put('/index.html', response.clone());
          return response;
        } catch {
          return (await caches.match('/index.html')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Everything else is a build artefact under a content-hashed name, so a hit
  // can be served from cache without checking: the name changes when the bytes
  // do. Misses are fetched and kept.
  event.respondWith(
    (async () => {
      const hit = await caches.match(request);
      if (hit) return hit;

      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(SHELL);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});

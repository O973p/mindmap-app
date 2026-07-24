/* Service Worker: macht die App installierbar und offline-fähig.
   Strategie: Netz zuerst (immer aktuell, wenn online), Cache als Fallback.
   API-Anfragen (/api/...) werden nie gecacht. */
const VERSION = 'v5';
const CACHE = 'mindmap-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/icons.js',
  './js/db.js',
  './js/editor.js',
  './js/main.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api/')) return; // API: immer Netz
  // Eigene Dateien am HTTP-Cache vorbei revalidieren (ETag/304 ist billig) —
  // sonst hängen Updates bis zu 10 Minuten im GitHub-Pages-Cache fest.
  const request = url.origin === location.origin
    ? (e.request.mode === 'navigate'
        ? fetch(e.request.url, { cache: 'no-cache' })
        : fetch(e.request, { cache: 'no-cache' }))
    : fetch(e.request);
  e.respondWith(
    request
      .then(r => {
        if (r.ok && url.origin === location.origin) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
      )
  );
});

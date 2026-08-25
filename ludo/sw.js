/* Ludora Pro — service worker
   Precache the full app shell (tiny payload), serve cache-first with a
   background refresh, and swap in new versions safely via SKIP_WAITING. */
'use strict';
var VERSION = 'ludora-v1.2.0';
var PRECACHE = [
  './',
  './index.html',
  './css/app.css',
  './js/engine.js',
  './js/ai.js',
  './js/persist.js',
  './js/store.js',
  './js/profile.js',
  './js/audio.js',
  './js/board.js',
  './js/net.js',
  './js/mp.js',
  './js/qr.js',
  './js/ads.js',
  './js/game.js',
  './js/ui.js',
  './js/main.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== VERSION) return caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  /* navigations: cache-first on the shell so cold starts are instant offline */
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then(function (cached) {
        var fresh = fetch(req).then(function (res) {
          caches.open(VERSION).then(function (c) { c.put('./index.html', res.clone()); });
          return res;
        }).catch(function () { return cached; });
        return cached || fresh;
      })
    );
    return;
  }

  /* assets: stale-while-revalidate */
  e.respondWith(
    caches.match(req).then(function (cached) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.ok) {
          caches.open(VERSION).then(function (c) { c.put(req, res.clone()); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || fresh;
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

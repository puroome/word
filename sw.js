const CACHE_VERSION = 'word-app-v12';
const APP_SHELL = [
  './',
  './index.html',
  './style.css?v=5',
  './manifest.json',
  './favicon.png',
  './beep.mp3',
  './js/main.js',
  './js/config.js',
  './js/api.js',
  './js/utils.js',
  './js/stats-store.js',
  './js/events.js',
  './js/ui.js',
  './js/learning.js',
  './js/quiz.js',
  './js/dashboard.js',
  './js/features.js',
  './images/learn.png',
  './images/test.png',
  './images/quiz1.webp?v=3',
  './images/quiz2.webp?v=3',
  './images/quiz3.webp?v=3',
  './images/quiz4.webp?v=3'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isLocalAsset = url.origin === self.location.origin;
  const isStaticLibrary =
    url.hostname === 'cdn.tailwindcss.com' ||
    url.hostname === 'cdn.jsdelivr.net' ||
    (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/'));
  if (!isLocalAsset && !isStaticLibrary) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        throw new Error('offline-resource-unavailable');
      })
  );
});

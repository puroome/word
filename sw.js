// sw.js (초기화 버전)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // 아무것도 캐시하지 않고 그냥 네트워크로 연결
  event.respondWith(fetch(event.request));
});

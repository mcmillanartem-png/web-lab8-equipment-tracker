// Service worker: сохраняет файлы в кеш, чтобы сайт открывался без интернета (как в ЛР №6–7)
const CACHE_NAME = 'lab8-cache';

const FILES = [
  '/',
  '/about',
  '/style.css',
  '/script.js',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// При установке — кладём файлы в кеш и сразу активируемся
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

// При активации — удаляем все чужие и старые кеши и сразу берём страницы под управление
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// При каждом запросе — пробуем сеть (и сохраняем свежую копию), если сети нет — берём из СВОЕГО кеша
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      fetch(event.request)
        .then((response) => {
          cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cache.match(event.request))
    )
  );
});

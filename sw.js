const CACHE_NAME = 'cb-frota-v1';

// Instalação do Service Worker
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Ativação do Service Worker
self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Intercepta requisições para garantir o critério de PWA
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});

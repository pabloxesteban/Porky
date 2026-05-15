const CACHE = 'porky-v1';
const ASSETS = [
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/planner.js',
  './js/shopping.js',
  './data/products.json',
  './data/meals.json',
  './logo.png',
  './manifest.json',
];

// Al instalar: guarda todos los archivos en caché
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Al activar: borra cachés viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Al hacer fetch: caché primero, luego red
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // Guardar en caché respuestas exitosas de nuestros propios archivos
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Si no hay red ni caché, mostrar página offline básica
      if (event.request.destination === 'document') {
        return caches.match('./index.html');
      }
    })
  );
});

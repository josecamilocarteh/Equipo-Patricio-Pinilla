// service-worker.js
//
// Permite que la app abra sin internet, mostrando la última versión
// guardada de la página y del ranking de mociones.
//
// Estrategia simple: "network first, cache fallback"
// - Si hay internet: pide todo a la red (siempre la versión más fresca)
//   y de paso actualiza la copia guardada.
// - Si NO hay internet: usa la última copia guardada en vez de fallar.

const CACHE_NAME = "equipo-pinilla-v1";

// Archivos que se guardan apenas se instala la app (lo mínimo para que
// la página cargue sin red: el HTML y el manifest).
const ARCHIVOS_BASE = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_BASE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Limpieza: borra versiones de caché antiguas si en el futuro cambia CACHE_NAME
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((nombre) => nombre !== CACHE_NAME)
          .map((nombre) => caches.delete(nombre))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Solo interceptamos peticiones GET (no afecta nada que envíe datos)
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((respuestaRed) => {
        // Si la red respondió bien, actualizamos la copia guardada
        // (esto incluye /api/mociones, así que el ranking offline
        // siempre será el último que sí cargó con internet).
        const copia = respuestaRed.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, copia);
        });
        return respuestaRed;
      })
      .catch(() => {
        // Sin internet: devolvemos lo último guardado, si existe
        return caches.match(event.request).then((respuestaCache) => {
          return respuestaCache || caches.match("/index.html");
        });
      })
  );
});

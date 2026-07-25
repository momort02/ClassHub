const CACHE_NAME = "classhub-cache-v2";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/login.html",
  "/dashboard.html",
  "/admin.html",
  "/delegue.html",
  "/annonces.html",
  "/sondages.html",
  "/profil.html",
  "/confidentialite.html",
  "/mentions-legales.html",
  "/css/style.css",
  "/js/auth.js",
  "/js/admin.js",
  "/js/annonces.js",
  "/js/delegue.js",
  "/js/demandes.js",
  "/js/profil.js",
  "/js/sondages.js",
  "/firebase/firebase.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Ne pas intercepter les appels vers Firebase / Firestore / Google APIs :
  // ces requêtes doivent toujours passer par le réseau.
  if (
    request.method !== "GET" ||
    request.url.includes("firestore.googleapis.com") ||
    request.url.includes("googleapis.com") ||
    request.url.includes("google.com") ||
    request.url.includes("gstatic.com")
  ) {
    return;
  }

  // Navigation (chargement de page) : réseau en priorité, cache en secours (offline).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // Autres ressources statiques (css/js/icônes) : cache en priorité, réseau en secours.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);
    })
  );
});

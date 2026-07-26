const CACHE_NAME = "classhub-cache-v4";

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
  "/icons/apple-touch-icon.png",
  "/icons/favicon-64.png",
];

// Extensions dont le contenu change souvent pendant le développement :
// on privilégie toujours le réseau pour ne jamais servir une version périmée.
const ALWAYS_FRESH_EXTENSIONS = [".js", ".css", ".html", ".json"];

function isAlwaysFresh(url) {
  return ALWAYS_FRESH_EXTENSIONS.some((ext) => url.pathname.endsWith(ext));
}

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
  const url = new URL(request.url);

  // Ne pas intercepter les appels vers Firebase / Firestore / Google APIs :
  // ces requêtes doivent toujours passer par le réseau.
  if (
    request.method !== "GET" ||
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("google.com") ||
    url.hostname.includes("gstatic.com")
  ) {
    return;
  }

  // Navigation (chargement de page), et fichiers JS/CSS/JSON : réseau en
  // priorité, cache seulement en secours si hors-ligne. Ça évite qu'un
  // navigateur reste bloqué sur une ancienne version du code après un
  // déploiement (source des redirections/authentification "bizarres").
  if (request.mode === "navigate" || isAlwaysFresh(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((r) => r || (request.mode === "navigate" ? caches.match("/index.html") : undefined))
        )
    );
    return;
  }

  // Images/icônes (changent rarement) : cache en priorité, réseau en secours.
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

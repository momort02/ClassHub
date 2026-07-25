// ============================================================================
// firebase-messaging-sw.js — Service worker dédié aux notifications push
// (Firebase Cloud Messaging). Doit rester à la racine du site.
// Séparé de sw.js (qui gère le cache hors-ligne) car FCM a besoin de son
// propre fichier de service worker pour recevoir les messages en arrière-plan.
// ============================================================================

importScripts("https://www.gstatic.com/firebasejs/11.4.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.4.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCATWpxQOgJJvXhaH2y-aANiF0RUvx5Fw0",
  authDomain: "classhub-ff5d1.firebaseapp.com",
  projectId: "classhub-ff5d1",
  storageBucket: "classhub-ff5d1.firebasestorage.app",
  messagingSenderId: "1031121129173",
  appId: "1:1031121129173:web:f973322702d430c60b1c5c",
});

const messaging = firebase.messaging();

// Notification reçue alors que l'app est fermée ou en arrière-plan.
messaging.onBackgroundMessage((payload) => {
  const notif = payload.notification || {};
  const data = payload.data || {};

  self.registration.showNotification(notif.title || "ClassHub", {
    body: notif.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data,
  });
});

// Clic sur la notification -> ouvre (ou remet au premier plan) la bonne page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard.html";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

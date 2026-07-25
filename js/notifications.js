// ============================================================================
// notifications.js — Notifications push (Firebase Cloud Messaging).
// Gère : activation/désactivation du push, préférences par catégorie,
// et l'affichage d'un toast quand une notification arrive app ouverte.
// ============================================================================

import { auth, db } from "../firebase/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { doc, getDoc, setDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";
import { getMessaging, getToken, deleteToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-messaging.js";

// ⚠️ À REMPLACER : clé VAPID générée dans Firebase Console
// (⚙️ Paramètres du projet → Cloud Messaging → onglet "Web configuration"
// → "Générer une paire de clés"). Sans ça, l'activation échouera.
export const VAPID_KEY = "REMPLACE_MOI_PAR_TA_CLE_VAPID";

export const DEFAULT_NOTIFICATION_PREFS = {
  nouvellesDemandes: true,
  reponsesDemandes: true,
  annonces: true,
  sondages: true,
};

let messagingInstance = null;
let messagingSupported = null;

async function getMessagingInstance() {
  if (messagingSupported === null) {
    try {
      messagingSupported = "serviceWorker" in navigator && "Notification" in window && (await isSupported());
    } catch (e) {
      messagingSupported = false;
    }
  }
  if (!messagingSupported) return null;
  if (!messagingInstance) messagingInstance = getMessaging();
  return messagingInstance;
}

export function getNotificationPermissionState() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission; // "granted" | "denied" | "default"
}

export async function getNotificationPrefs(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(snap.data()?.preferences?.notifications || {}) };
}

export async function saveNotificationPrefs(uid, prefs) {
  await setDoc(doc(db, "users", uid), { preferences: { notifications: prefs } }, { merge: true });
}

/** Demande la permission navigateur, récupère un token FCM et l'enregistre sur le profil. */
export async function enablePushNotifications() {
  const messaging = await getMessagingInstance();
  if (!messaging) throw new Error("Les notifications push ne sont pas supportées sur ce navigateur.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permission refusée par le navigateur.");

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error("Impossible d'obtenir un token de notification.");
  if (!auth.currentUser) throw new Error("Utilisateur non connecté.");

  await setDoc(doc(db, "users", auth.currentUser.uid), { fcmTokens: arrayUnion(token) }, { merge: true });
  return token;
}

/** Supprime le token courant (navigateur + Firestore). */
export async function disablePushNotifications() {
  const messaging = await getMessagingInstance();
  if (!messaging || !auth.currentUser) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
    const token = registration
      ? await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration }).catch(() => null)
      : null;

    if (token) {
      await setDoc(doc(db, "users", auth.currentUser.uid), { fcmTokens: arrayRemove(token) }, { merge: true });
    }
    await deleteToken(messaging).catch(() => {});
  } catch (e) {
    console.warn("Erreur lors de la désactivation des notifications :", e);
  }
}

function ensureToastStack() {
  let stack = document.getElementById("toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showNotificationToast(title, body) {
  const stack = ensureToastStack();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <span class="toast-icon">🔔</span>
    <div>
      <strong>${escapeHtml(title || "ClassHub")}</strong>
      <p>${escapeHtml(body || "")}</p>
    </div>
  `;
  stack.appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(6px) scale(0.98)";
    window.setTimeout(() => toast.remove(), 220);
  }, 4500);
}

let initialized = false;

/**
 * À appeler une fois par page authentifiée : affiche un toast pour les push
 * reçues pendant que l'app est ouverte, et rafraîchit silencieusement le
 * token si la permission a déjà été accordée précédemment sur cet appareil.
 */
export function initNotifications() {
  if (initialized) return;
  initialized = true;

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    const messaging = await getMessagingInstance();
    if (!messaging) return;

    onMessage(messaging, (payload) => {
      const notif = payload.notification || {};
      showNotificationToast(notif.title, notif.body);
    });

    if (Notification.permission === "granted") {
      try {
        const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
        const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
        if (token) {
          await setDoc(doc(db, "users", user.uid), { fcmTokens: arrayUnion(token) }, { merge: true });
        }
      } catch (e) {
        console.warn("Rafraîchissement du token FCM impossible :", e);
      }
    }
  });
}

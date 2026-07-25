// ============================================================================
// functions/index.js — Cloud Functions ClassHub.
// Envoie une notification push (FCM) quand :
//  1. une nouvelle demande est créée         -> délégués + admins de la classe
//  2. le statut d'une demande change         -> l'auteur de la demande
//  3. une nouvelle annonce est publiée       -> toute la classe
//  4. un nouveau sondage est créé            -> toute la classe
// Respecte les préférences de notification de chaque utilisateur
// (users/{uid}.preferences.notifications.*), enregistrées depuis profil.html.
// ============================================================================

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

// Adapte si ton projet Firebase est ailleurs (ex: "us-central1", région par défaut).
const REGION = "europe-west1";

function prefOk(userData, key) {
  return userData?.preferences?.notifications?.[key] !== false;
}

/** Envoie une notification à une liste d'utilisateurs (par uid), en respectant
 * leurs tokens enregistrés, et nettoie les tokens devenus invalides. */
async function sendToUsers(uids, notification, data = {}) {
  const uniqueUids = [...new Set(uids)].filter(Boolean);
  if (uniqueUids.length === 0) return;

  const userRefs = uniqueUids.map((uid) => db.collection("users").doc(uid));
  const userSnaps = await db.getAll(...userRefs);

  const tokenToUid = new Map();
  userSnaps.forEach((snap) => {
    if (!snap.exists) return;
    (snap.data().fcmTokens || []).forEach((token) => tokenToUid.set(token, snap.id));
  });

  const tokens = Array.from(tokenToUid.keys());
  if (tokens.length === 0) return;

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification,
    data,
    webpush: {
      fcmOptions: { link: data.url || "/dashboard.html" },
      notification: { icon: "/icons/icon-192.png" },
    },
  });

  // Retire les tokens expirés/désinstallés pour ne pas les re-solliciter.
  const invalidTokensByUid = new Map();
  response.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (!r.success && (code === "messaging/invalid-registration-token" || code === "messaging/registration-token-not-registered")) {
      const token = tokens[i];
      const uid = tokenToUid.get(token);
      if (!invalidTokensByUid.has(uid)) invalidTokensByUid.set(uid, []);
      invalidTokensByUid.get(uid).push(token);
    }
  });

  await Promise.all(
    Array.from(invalidTokensByUid.entries()).map(([uid, badTokens]) => {
      const snap = userSnaps.find((s) => s.id === uid);
      if (!snap?.exists) return null;
      const remaining = (snap.data().fcmTokens || []).filter((t) => !badTokens.includes(t));
      return snap.ref.update({ fcmTokens: remaining });
    })
  );
}

// 1. Nouvelle demande -> délégués + admins de la classe (sauf l'auteur lui-même)
exports.onDemandeCreated = onDocumentCreated({ document: "demandes/{id}", region: REGION }, async (event) => {
  const demande = event.data?.data();
  if (!demande) return;

  const usersSnap = await db.collection("users").where("classId", "==", demande.classId).get();
  const recipientUids = [];
  usersSnap.forEach((docSnap) => {
    const u = docSnap.data();
    if ((u.role === "delegue" || u.isAdmin === true) && prefOk(u, "nouvellesDemandes")) {
      recipientUids.push(docSnap.id);
    }
  });

  await sendToUsers(
    recipientUids,
    {
      title: "Nouvelle demande 📝",
      body: `${demande.titre} — ${demande.anonyme ? "Anonyme" : (demande.authorName || "Un élève")}`,
    },
    { url: "/dashboard.html" }
  );
});

// 2. Statut d'une demande modifié -> l'auteur de la demande
exports.onDemandeStatusChanged = onDocumentUpdated({ document: "demandes/{id}", region: REGION }, async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after || before.statut === after.statut || !after.authorUid) return;

  const authorSnap = await db.collection("users").doc(after.authorUid).get();
  if (!authorSnap.exists || !prefOk(authorSnap.data(), "reponsesDemandes")) return;

  await sendToUsers(
    [after.authorUid],
    {
      title: "Ta demande a été mise à jour",
      body: `« ${after.titre} » est maintenant : ${after.statut}`,
    },
    { url: "/dashboard.html" }
  );
});

// 3. Nouvelle annonce -> toute la classe
exports.onAnnonceCreated = onDocumentCreated({ document: "annonces/{id}", region: REGION }, async (event) => {
  const annonce = event.data?.data();
  if (!annonce) return;

  const usersSnap = await db.collection("users").where("classId", "==", annonce.classId).get();
  const recipientUids = [];
  usersSnap.forEach((docSnap) => {
    if (prefOk(docSnap.data(), "annonces")) recipientUids.push(docSnap.id);
  });

  await sendToUsers(
    recipientUids,
    { title: "Nouvelle annonce 📢", body: annonce.titre },
    { url: "/annonces.html" }
  );
});

// 4. Nouveau sondage -> toute la classe
exports.onSondageCreated = onDocumentCreated({ document: "sondages/{id}", region: REGION }, async (event) => {
  const sondage = event.data?.data();
  if (!sondage) return;

  const usersSnap = await db.collection("users").where("classId", "==", sondage.classId).get();
  const recipientUids = [];
  usersSnap.forEach((docSnap) => {
    if (prefOk(docSnap.data(), "sondages")) recipientUids.push(docSnap.id);
  });

  await sendToUsers(
    recipientUids,
    { title: "Nouveau sondage 📊", body: sondage.question },
    { url: "/sondages.html" }
  );
});

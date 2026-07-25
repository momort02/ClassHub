// ============================================================================
// notifications-worker/src/worker.js
// Alternative 100% gratuite à Firebase Cloud Functions (pas besoin du plan
// Blaze / carte bancaire). Tourne sur un cron Cloudflare Workers (gratuit),
// interroge Firestore via son API REST avec un compte de service, et envoie
// les notifications push via l'API FCM HTTP v1.
//
// Reproduit exactement la logique de functions/index.js :
//  1. Nouvelle demande               -> délégués + admins de la classe
//  2. Changement de statut d'une demande -> l'auteur de la demande
//  3. Nouvelle annonce               -> toute la classe
//  4. Nouveau sondage                -> toute la classe
// (en respectant users/{uid}.preferences.notifications.*)
// ============================================================================

const PROJECT_ID = "classhub-ff5d1";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const KV_KEY_LAST_RUN = "lastRun";

// ---------------------------------------------------------------------------
// Auth : échange le compte de service (JSON) contre un token OAuth2, en
// signant le JWT en RS256 via Web Crypto (disponible nativement dans Workers).
// ---------------------------------------------------------------------------

function base64url(bytesOrString) {
  let base64;
  if (typeof bytesOrString === "string") {
    base64 = btoa(bytesOrString);
  } else {
    let binary = "";
    const bytes = new Uint8Array(bytesOrString);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(serviceAccount, scopes) {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: serviceAccount.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${base64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error("Échec obtention token OAuth2 : " + JSON.stringify(data));
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Firestore REST : décodage des documents + requêtes structurées.
// ---------------------------------------------------------------------------

function decodeValue(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.nullValue !== undefined) return null;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(decodeValue);
  if (v.mapValue !== undefined) return decodeFields(v.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}

function decodeDoc(doc) {
  return { id: doc.name.split("/").pop(), ...decodeFields(doc.fields || {}) };
}

async function runQuery(accessToken, structuredQuery) {
  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
  });
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.filter((r) => r.document).map((r) => decodeDoc(r.document));
}

async function getUsersByClass(accessToken, classId) {
  return runQuery(accessToken, {
    from: [{ collectionId: "users" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "classId" },
        op: "EQUAL",
        value: { stringValue: classId },
      },
    },
  });
}

async function getUser(accessToken, uid) {
  const res = await fetch(`${FIRESTORE_BASE}/users/${uid}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return decodeDoc(await res.json());
}

async function removeTokenFromUser(accessToken, uid, badToken) {
  const user = await getUser(accessToken, uid);
  if (!user) return;
  const remaining = (user.fcmTokens || []).filter((t) => t !== badToken);

  await fetch(`${FIRESTORE_BASE}/users/${uid}?updateMask.fieldPaths=fcmTokens`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        fcmTokens: { arrayValue: { values: remaining.map((t) => ({ stringValue: t })) } },
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// FCM HTTP v1 : envoi d'une notification à un token, avec nettoyage des
// tokens invalides/expirés directement sur le document utilisateur.
// ---------------------------------------------------------------------------

async function sendFcm(accessToken, uid, token, notification, data) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification,
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        webpush: {
          fcm_options: { link: data.url || "/dashboard.html" },
          notification: { icon: "/icons/icon-192.png" },
        },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const status = err?.error?.status;
    if (status === "NOT_FOUND" || status === "UNREGISTERED" || status === "INVALID_ARGUMENT") {
      await removeTokenFromUser(accessToken, uid, token);
    }
  }
}

function prefOk(userData, key) {
  return userData?.preferences?.notifications?.[key] !== false;
}

async function sendToUsers(accessToken, users, notification, data) {
  const jobs = [];
  users.forEach((u) => {
    (u.fcmTokens || []).forEach((token) => {
      jobs.push(sendFcm(accessToken, u.id, token, notification, data));
    });
  });
  await Promise.allSettled(jobs);
}

// ---------------------------------------------------------------------------
// Boucle principale : appelée par le cron toutes les 2 minutes.
// ---------------------------------------------------------------------------

async function poll(env) {
  const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const accessToken = await getAccessToken(serviceAccount, [
    "https://www.googleapis.com/auth/datastore",
    "https://www.googleapis.com/auth/firebase.messaging",
  ]);

  const runStartedAt = new Date().toISOString();
  let lastRun = await env.NOTIF_STATE.get(KV_KEY_LAST_RUN);

  // Premier passage : on initialise le curseur sans rien envoyer, pour ne pas
  // spammer tout le monde avec l'historique complet de la base.
  if (!lastRun) {
    await env.NOTIF_STATE.put(KV_KEY_LAST_RUN, runStartedAt);
    return { firstRun: true };
  }

  const classUsersCache = new Map();
  async function usersOfClass(classId) {
    if (!classUsersCache.has(classId)) {
      classUsersCache.set(classId, await getUsersByClass(accessToken, classId));
    }
    return classUsersCache.get(classId);
  }

  let sent = 0;

  // 1. Nouvelles demandes
  const newDemandes = await runQuery(accessToken, {
    from: [{ collectionId: "demandes" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "createdAt" },
        op: "GREATER_THAN",
        value: { timestampValue: lastRun },
      },
    },
    orderBy: [{ field: { fieldPath: "createdAt" }, direction: "ASCENDING" }],
  });

  for (const demande of newDemandes) {
    const classUsers = await usersOfClass(demande.classId);
    const recipients = classUsers.filter(
      (u) => u.id !== demande.authorUid && (u.role === "delegue" || u.isAdmin === true) && prefOk(u, "nouvellesDemandes")
    );
    await sendToUsers(
      accessToken,
      recipients,
      { title: "Nouvelle demande 📝", body: `${demande.titre} — ${demande.anonyme ? "Anonyme" : (demande.authorName || "Un élève")}` },
      { url: "/dashboard.html" }
    );
    sent += recipients.length;
  }

  // 2. Demandes dont le statut a changé (updatedAt > createdAt, et modifiées depuis le dernier passage)
  const updatedDemandes = await runQuery(accessToken, {
    from: [{ collectionId: "demandes" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "updatedAt" },
        op: "GREATER_THAN",
        value: { timestampValue: lastRun },
      },
    },
    orderBy: [{ field: { fieldPath: "updatedAt" }, direction: "ASCENDING" }],
  });

  for (const demande of updatedDemandes) {
    if (!demande.updatedAt || demande.updatedAt === demande.createdAt) continue; // simple création, déjà traitée ci-dessus
    if (!demande.authorUid) continue;

    const author = await getUser(accessToken, demande.authorUid);
    if (!author || !prefOk(author, "reponsesDemandes")) continue;

    await sendToUsers(
      accessToken,
      [author],
      { title: "Ta demande a été mise à jour", body: `« ${demande.titre} » est maintenant : ${demande.statut}` },
      { url: "/dashboard.html" }
    );
    sent += 1;
  }

  // 3. Nouvelles annonces
  const newAnnonces = await runQuery(accessToken, {
    from: [{ collectionId: "annonces" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "createdAt" },
        op: "GREATER_THAN",
        value: { timestampValue: lastRun },
      },
    },
    orderBy: [{ field: { fieldPath: "createdAt" }, direction: "ASCENDING" }],
  });

  for (const annonce of newAnnonces) {
    const classUsers = await usersOfClass(annonce.classId);
    const recipients = classUsers.filter((u) => prefOk(u, "annonces"));
    await sendToUsers(accessToken, recipients, { title: "Nouvelle annonce 📢", body: annonce.titre }, { url: "/annonces.html" });
    sent += recipients.length;
  }

  // 4. Nouveaux sondages
  const newSondages = await runQuery(accessToken, {
    from: [{ collectionId: "sondages" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "createdAt" },
        op: "GREATER_THAN",
        value: { timestampValue: lastRun },
      },
    },
    orderBy: [{ field: { fieldPath: "createdAt" }, direction: "ASCENDING" }],
  });

  for (const sondage of newSondages) {
    const classUsers = await usersOfClass(sondage.classId);
    const recipients = classUsers.filter((u) => prefOk(u, "sondages"));
    await sendToUsers(accessToken, recipients, { title: "Nouveau sondage 📊", body: sondage.question }, { url: "/sondages.html" });
    sent += recipients.length;
  }

  await env.NOTIF_STATE.put(KV_KEY_LAST_RUN, runStartedAt);
  return { sent, newDemandes: newDemandes.length, updatedDemandes: updatedDemandes.length, newAnnonces: newAnnonces.length, newSondages: newSondages.length };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(poll(env));
  },

  // Endpoint manuel pratique pour tester le déploiement (GET sur l'URL du worker).
  // Protégé par un jeton simple pour éviter que n'importe qui le déclenche.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get("token") !== env.MANUAL_TRIGGER_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const result = await poll(env);
      return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  },
};

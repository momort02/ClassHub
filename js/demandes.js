// ============================================================================
// demandes.js — Page "Demandes" (dashboard.html).
// Gère : création (avec option anonyme), vote (dédupliqué côté serveur via
// un tableau `votedBy`, plus fiable que le localStorage utilisé avant),
// et l'espace de discussion (commentaires en temps réel) sous chaque carte.
// ============================================================================

import { auth, db } from "../firebase/firebase.js";
import { initNotifications } from "./notifications.js";

initNotifications();
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import {
  collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp,
  doc, getDoc, updateDoc, increment, arrayUnion,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

let currentUser = null;
let currentUid = null;

// Id de la demande dont le panneau de commentaires est actuellement ouvert,
// et fonction pour se désabonner de son listener temps réel quand on ferme
// le panneau ou qu'on en ouvre un autre.
let openCommentId = null;
let unsubComments = null;

// Fait correspondre le statut (texte affiché) à la classe CSS de badge
// définie dans style.css (badge-attente, badge-discussion, ...).
const STATUT_TO_BADGE = {
  "En attente": "badge-attente",
  "En discussion": "badge-discussion",
  "Acceptée": "badge-acceptee",
  "Refusée": "badge-refusee",
  "Résolue": "badge-resolue",
};

function escapeHTML(str = "") {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  currentUid = user.uid;
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) { currentUser = snap.data(); listenDemandes(); }
});

document.getElementById("btn-logout")?.addEventListener("click", () => signOut(auth));

const modal = document.getElementById("modal-demande");
document.getElementById("btn-open-modal")?.addEventListener("click", () => modal.classList.add("active"));
document.getElementById("btn-close-modal")?.addEventListener("click", () => modal.classList.remove("active"));

document.getElementById("form-demande")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const anonyme = document.getElementById("demande-anonyme").checked;

  await addDoc(collection(db, "demandes"), {
    titre: document.getElementById("demande-titre").value,
    categorie: document.getElementById("demande-categorie").value,
    description: document.getElementById("demande-description").value,
    authorName: `${currentUser.prenom} ${currentUser.nom}`,
    authorUid: currentUid,
    anonyme,
    classId: currentUser.classId,
    statut: "En attente",
    votes: 0,
    votedBy: [],
    createdAt: serverTimestamp(),
  });

  modal.classList.remove("active");
  e.target.reset();
});

// --- Liste des demandes (avec délégation d'événements pour vote/commentaires) ---
const listContainer = document.getElementById("demandes-list");

function listenDemandes() {
  const q = query(collection(db, "demandes"), where("classId", "==", currentUser.classId));

  onSnapshot(q, (snapshot) => {
    listContainer.innerHTML = "";

    if (snapshot.empty) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📝</div>
          <h4>Aucune demande pour le moment</h4>
          <p>Les propositions de la classe apparaîtront ici dès qu’elles seront publiées.</p>
        </div>
      `;
      return;
    }

    snapshot.forEach((d) => {
      const data = d.data();
      const id = d.id;
      const votedBy = data.votedBy || [];
      const hasVoted = votedBy.includes(currentUid);
      const badgeClass = STATUT_TO_BADGE[data.statut] || "badge-attente";
      const authorLabel = data.anonyme ? "Anonyme" : escapeHTML(data.authorName || "");
      const isCommentOpen = openCommentId === id;

      const card = document.createElement("div");
      card.className = "card";
      card.dataset.demandeId = id;
      card.innerHTML = `
        <div class="card-header">
          <div class="card-title">${escapeHTML(data.titre)}</div>
          <span class="badge ${badgeClass}">${data.statut}</span>
        </div>
        <p style="color: var(--text-muted); font-size:0.9rem;">${escapeHTML(data.description)}</p>
        <p style="font-size:0.78rem; color:var(--text-muted); margin-top:0.4rem;">par ${authorLabel}</p>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem;">
          <small style="color:var(--accent);">${escapeHTML(data.categorie)}</small>
          <button class="btn btn-secondary btn-vote" data-id="${id}" ${hasVoted ? "disabled" : ""} style="padding: 6px 12px; font-size: 0.9rem;">
            👍 ${data.votes || 0} ${hasVoted ? "(Voté)" : ""}
          </button>
        </div>
        <button class="btn-comments-toggle" data-id="${id}" style="background:none; border:none; color:var(--text-muted); font-size:0.8rem; margin-top:0.8rem; padding:0; cursor:pointer;">
          💬 ${isCommentOpen ? "Masquer les commentaires" : "Voir les commentaires"}
        </button>
        <div class="comments-panel" data-panel-id="${id}" style="display:${isCommentOpen ? "block" : "none"};">
          <div class="comments-list" id="comments-list-${id}"><p class="text-muted" style="font-size:0.8rem;">Chargement…</p></div>
          <form class="form-comment" data-id="${id}">
            <input type="text" class="comment-input" placeholder="Écrire un commentaire…" required>
            <button type="submit" class="btn-comment-send"><span class="material-icons" style="font-size:18px;">send</span></button>
          </form>
        </div>
      `;
      listContainer.appendChild(card);
    });

    // Si un panneau de commentaires était ouvert, on rebranche son écoute
    // temps réel après ce nouveau rendu (le DOM a été entièrement recréé).
    if (openCommentId) listenComments(openCommentId);
  });
}

// --- Délégation d'événements : un seul listener, quel que soit le rendu ---
listContainer.addEventListener("click", async (e) => {
  const voteBtn = e.target.closest(".btn-vote");
  if (voteBtn) {
    const id = voteBtn.dataset.id;
    const ref = doc(db, "demandes", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const votedBy = snap.data().votedBy || [];
    if (votedBy.includes(currentUid)) return; // déjà voté, protection double-clic
    await updateDoc(ref, { votes: increment(1), votedBy: arrayUnion(currentUid) });
    return;
  }

  const toggleBtn = e.target.closest(".btn-comments-toggle");
  if (toggleBtn) {
    const id = toggleBtn.dataset.id;
    const panel = listContainer.querySelector(`.comments-panel[data-panel-id="${id}"]`);
    const isOpening = openCommentId !== id;

    if (unsubComments) { unsubComments(); unsubComments = null; }

    if (isOpening) {
      openCommentId = id;
      panel.style.display = "block";
      toggleBtn.textContent = "💬 Masquer les commentaires";
      listenComments(id);
    } else {
      openCommentId = null;
      panel.style.display = "none";
      toggleBtn.textContent = "💬 Voir les commentaires";
    }
    return;
  }
});

listContainer.addEventListener("submit", async (e) => {
  const form = e.target.closest(".form-comment");
  if (!form) return;
  e.preventDefault();

  const id = form.dataset.id;
  const input = form.querySelector(".comment-input");
  const texte = input.value.trim();
  if (!texte) return;

  await addDoc(collection(db, "demandes", id, "commentaires"), {
    texte,
    authorName: `${currentUser.prenom} ${currentUser.nom}`,
    authorUid: currentUid,
    createdAt: serverTimestamp(),
  });

  input.value = "";
});

/** Écoute en temps réel les commentaires d'une demande et les affiche. */
function listenComments(demandeId) {
  const q = query(
    collection(db, "demandes", demandeId, "commentaires"),
    orderBy("createdAt", "asc")
  );

  unsubComments = onSnapshot(q, (snapshot) => {
    const container = document.getElementById(`comments-list-${demandeId}`);
    if (!container) return; // le panneau a pu être démonté entre-temps

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="empty-state" style="padding:0.8rem; border-style:dashed; background:transparent;">
          <div class="empty-icon">💬</div>
          <h4>Aucun commentaire</h4>
          <p>Soyez le premier à ouvrir la discussion.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = "";
    snapshot.forEach((d) => {
      const c = d.data();
      const row = document.createElement("div");
      row.className = "comment-row";
      row.innerHTML = `
        <strong>${escapeHTML(c.authorName)}</strong>
        <p>${escapeHTML(c.texte)}</p>
      `;
      container.appendChild(row);
    });
    container.scrollTop = container.scrollHeight;
  });
}


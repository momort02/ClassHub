import { auth, db } from "../firebase/firebase.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { collection, query, where, onSnapshot, addDoc, doc, getDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

let currentUser = null;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(message, type = "success") {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type === "success" ? "toast-success" : ""}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === "success" ? "✓" : "i"}</span>
    <div>
      <strong>${type === "success" ? "Succès" : "Information"}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;

  stack.appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(6px) scale(0.98)";
    window.setTimeout(() => toast.remove(), 220);
  }, 2800);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) {
    currentUser = snap.data();
    if (currentUser.role !== "delegue") {
      window.location.href = "dashboard.html";
      return;
    }
    listenDemandesDelegue();
    loadElevesSelect();
  }
});

function listenDemandesDelegue() {
  const q = query(collection(db, "demandes"), where("classId", "==", currentUser.classId));
  onSnapshot(q, (s) => {
    let total = 0, attente = 0;
    const container = document.getElementById("delegue-demandes-list");
    container.innerHTML = "";

    if (s.empty) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <h4>Aucune demande pour le moment</h4>
          <p>Les nouvelles demandes de la classe apparaîtront ici automatiquement.</p>
        </div>
      `;
      document.getElementById("stat-total").textContent = total;
      document.getElementById("stat-attente").textContent = attente;
      return;
    }

    s.forEach(d => {
      total++;
      const data = d.data();
      if (data.statut === "En attente") attente++;

      const authorLabel = data.anonyme ? "Anonyme" : data.authorName;
      const div = document.createElement("div");
      div.className = "card request-card";
      div.style.background = "var(--bg-tertiary)";
      div.innerHTML = `
        <h4>${data.titre} <small>(${authorLabel})</small></h4>
        <p style="font-size:0.85rem; color:var(--text-muted); margin: 0.5rem 0;">${data.description}</p>
        <p style="font-size:0.8rem;">Statut : <strong>${data.statut}</strong> | Votes : 👍 ${data.votes}</p>
        <div style="display:flex; gap:0.5rem; margin-top:0.8rem; flex-wrap:wrap;">
          <button class="btn btn-secondary btn-status" data-id="${d.id}" data-statut="Acceptée" style="padding:4px 8px; font-size:0.75rem;">Accepter</button>
          <button class="btn btn-secondary btn-status" data-id="${d.id}" data-statut="Résolue" style="padding:4px 8px; font-size:0.75rem; background-color:var(--accent);">Résoudre</button>
          <button class="btn btn-danger btn-status" data-id="${d.id}" data-statut="Refusée" style="padding:4px 8px; font-size:0.75rem;">Refuser</button>
        </div>
      `;
      container.appendChild(div);
    });

    document.getElementById("stat-total").textContent = total;
    document.getElementById("stat-attente").textContent = attente;

    document.querySelectorAll(".btn-status").forEach(b => {
      b.addEventListener("click", async (e) => {
        const id = e.currentTarget.dataset.id;
        const newStatut = e.currentTarget.dataset.statut;
        await updateDoc(doc(db, "demandes", id), { statut: newStatut });
        showToast(`Le statut a été mis à jour avec succès.`, "success");
      });
    });
  });
}

function loadElevesSelect() {
  const q = query(collection(db, "users"), where("classId", "==", currentUser.classId));
  onSnapshot(q, (s) => {
    const select = document.getElementById("avis-eleve-select");
    select.innerHTML = '<option value="">-- Choisir un élève --</option>';
    s.forEach(d => {
      const u = d.data();
      select.innerHTML += `<option value="${u.uid}">${u.prenom} ${u.nom}</option>`;
    });
  });
}

document.getElementById("form-avis")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const eleveUid = document.getElementById("avis-eleve-select").value;
  const periode = document.getElementById("avis-periode-select").value;
  const avis = document.getElementById("avis-texte").value;

  if (!eleveUid) return alert("Sélectionnez un élève.");

  const docId = `${eleveUid}_${periode.replace(/\s+/g, '_')}`;

  await setDoc(doc(db, "avis_profs", docId), {
    eleveUid: eleveUid,
    periode: periode,
    avis: avis,
    updatedAt: new Date(),
    author: `${currentUser.prenom} ${currentUser.nom}`
  });

  e.target.reset();
  showToast(`Avis du ${periode} enregistré avec succès.`, "success");
});

document.getElementById("form-annonce")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "annonces"), { 
    titre: document.getElementById("annonce-titre").value, 
    contenu: document.getElementById("annonce-contenu").value, 
    classId: currentUser.classId 
  });
  e.target.reset(); 
  showToast("Annonce publiée avec succès.", "success");
});

document.getElementById("form-sondage")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await addDoc(collection(db, "sondages"), { 
    question: document.getElementById("sondage-question").value, 
    opt1: document.getElementById("sondage-opt1").value, 
    opt2: document.getElementById("sondage-opt2").value, 
    votes1: 0, 
    votes2: 0,
    votedBy: [],
    classId: currentUser.classId 
  });
  e.target.reset(); 
  showToast("Sondage créé avec succès.", "success");
});

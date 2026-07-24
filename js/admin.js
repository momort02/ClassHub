import { auth, db } from "../firebase/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { collection, query, onSnapshot, doc, getDoc, updateDoc, deleteDoc, orderBy } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

// L'accès admin n'est plus protégé par un mot de passe partagé écrit dans le
// code (n'importe qui pouvait le lire dans les DevTools). Il dépend désormais
// du champ `role` du profil Firestore du compte connecté : seul un profil
// avec role === "admin" peut voir cette page.
//
// Pour nommer le tout premier admin : ouvrir la console Firebase >
// Firestore Database > collection "users" > le document de la personne
// concernée > mettre son champ `role` à "admin" à la main. Ensuite, cette
// personne peut nommer d'autres admins directement depuis cette page.

const deniedCard = document.getElementById("admin-denied");
const adminContent = document.getElementById("admin-content");

let allUsers = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const snap = await getDoc(doc(db, "users", user.uid));
  const role = snap.exists() ? snap.data().role : null;

  if (role !== "admin") {
    deniedCard.style.display = "block";
    return;
  }

  adminContent.style.display = "flex";
  loadAdminDashboard();
});

function loadAdminDashboard() {
  // Chargement des utilisateurs
  const usersRef = collection(db, "users");
  onSnapshot(usersRef, (snapshot) => {
    allUsers = [];
    let countDelegues = 0;
    const classesSet = new Set();

    snapshot.forEach((d) => {
      const u = { id: d.id, ...d.data() };
      allUsers.push(u);
      if (u.role === "delegue") countDelegues++;
      if (u.classId) classesSet.add(u.classId);
    });

    document.getElementById("stat-total-users").textContent = allUsers.length;
    document.getElementById("stat-total-delegues").textContent = countDelegues;

    const selectFilter = document.getElementById("filter-admin-class");
    selectFilter.innerHTML = '<option value="ALL">Toutes les classes</option>';
    classesSet.forEach(cId => {
      selectFilter.innerHTML += `<option value="${cId}">${cId}</option>`;
    });

    renderUsersList("ALL");
  });

  // Chargement des tickets de support
  const supportRef = collection(db, "support_tickets");
  onSnapshot(supportRef, (snapshot) => {
    const container = document.getElementById("admin-support-list");
    container.innerHTML = "";

    if (snapshot.empty) {
      container.innerHTML = "<p style='color:var(--text-muted); font-style:italic;'>Aucun message de support pour le moment.</p>";
      return;
    }

    snapshot.forEach((d) => {
      const msg = d.data();
      const card = document.createElement("div");
      card.className = "card";
      card.style.cssText = "background:var(--bg-tertiary); margin-bottom:0.8rem; border-left:4px solid var(--accent);";

      card.innerHTML = `
        <div style="display:flex; justify-style:space-between; align-items:center; margin-bottom:0.4rem;">
          <strong style="color:var(--accent);">${msg.sujet}</strong>
          <small style="color:var(--text-muted);">${msg.userName} (${msg.classId})</small>
        </div>
        <p style="margin-bottom:0.8rem; font-size:0.9rem;">"${msg.message}"</p>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <small style="color:var(--text-muted);">${msg.userEmail}</small>
          <button class="btn btn-secondary btn-delete-ticket" style="font-size:0.75rem; padding:0.3rem 0.6rem;">
            Marquer comme résolu ✔️
          </button>
        </div>
      `;

      card.querySelector(".btn-delete-ticket").onclick = async () => {
        await deleteDoc(doc(db, "support_tickets", d.id));
      };

      container.appendChild(card);
    });
  });

  document.getElementById("filter-admin-class").addEventListener("change", (e) => {
    renderUsersList(e.target.value);
  });
}

function renderUsersList(selectedClass) {
  const container = document.getElementById("admin-users-list");
  container.innerHTML = "";

  const filtered = selectedClass === "ALL" 
    ? allUsers 
    : allUsers.filter(u => u.classId === selectedClass);

  if (filtered.length === 0) {
    container.innerHTML = "<p style='color:var(--text-muted);'>Aucun élève trouvé.</p>";
    return;
  }

  filtered.forEach((u) => {
    const isDelegue = u.role === "delegue";
    const item = document.createElement("div");
    item.className = "card";
    item.style.cssText = "background:var(--bg-tertiary); margin-bottom:0.8rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;";

    item.innerHTML = `
      <div>
        <strong>${u.prenom || ''} ${u.nom || ''}</strong> <small style="color:var(--text-muted);">(${u.email})</small><br>
        <small style="color:var(--accent);">Classe: ${u.classe || u.classId || 'N/A'}</small> | 
        <span style="font-weight:bold; color:${isDelegue ? 'var(--warning)' : 'var(--text-muted)'}">${isDelegue ? '⭐ Délégué' : 'Élève'}</span>
      </div>
      <button class="btn btn-secondary btn-toggle-role" style="font-size:0.8rem; padding:0.4rem 0.8rem;">
        ${isDelegue ? 'Destituer ❌' : 'Nommer Délégué 👑'}
      </button>
    `;

    item.querySelector(".btn-toggle-role").onclick = async () => {
      const newRole = isDelegue ? "eleve" : "delegue";
      await updateDoc(doc(db, "users", u.id), { role: newRole });
      alert(`Rôle mis à jour pour ${u.prenom} ${u.nom}`);
    };

    container.appendChild(item);
  });
}

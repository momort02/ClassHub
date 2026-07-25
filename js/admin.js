import { auth, db } from "../firebase/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { collection, query, onSnapshot, doc, getDoc, updateDoc, deleteDoc, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

const deniedCard = document.getElementById("admin-denied");
const adminContent = document.getElementById("admin-content");

let allUsers = [];
let knownClasses = [];

function escapeHTML(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDefaultEditableField(collectionName) {
  switch (collectionName) {
    case "users": return "prenom";
    case "annonces": return "titre";
    case "sondages": return "question";
    case "demandes": return "titre";
    case "support_tickets": return "sujet";
    default: return "";
  }
}

function formatDateInputValue(dateValue) {
  if (!dateValue) return "";

  const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60000);
  return localDate.toISOString().split("T")[0];
}

function parseEditableValue(rawValue, currentValue) {
  if (rawValue === null) return currentValue;
  if (rawValue === "") return "";
  if (typeof currentValue === "number" || /^-?\d+(\.\d+)?$/.test(rawValue)) {
    return Number(rawValue);
  }
  if (/^(true|false)$/i.test(rawValue)) {
    return rawValue.toLowerCase() === "true";
  }
  if ((rawValue.startsWith("{") && rawValue.endsWith("}")) || (rawValue.startsWith("[") && rawValue.endsWith("]"))) {
    try {
      return JSON.parse(rawValue);
    } catch {
      return rawValue;
    }
  }
  return rawValue;
}

async function editDocumentField(collectionName, docId, currentData) {
  const fieldName = prompt("Nom du champ à modifier", getDefaultEditableField(collectionName));
  if (!fieldName) return;

  const currentValue = currentData[fieldName];
  const rawValue = prompt(
    `Nouvelle valeur pour "${fieldName}"`,
    typeof currentValue === "object" ? JSON.stringify(currentValue) : (currentValue ?? "")
  );
  if (rawValue === null) return;

  const newValue = parseEditableValue(rawValue, currentValue);
  await updateDoc(doc(db, collectionName, docId), { [fieldName]: newValue });
  await loadDatabaseCollection(collectionName);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const snap = await getDoc(doc(db, "users", user.uid));
  const isAdmin = snap.exists() && snap.data().isAdmin === true;

  if (!isAdmin) {
    deniedCard.style.display = "block";
    return;
  }

  adminContent.style.display = "flex";
  loadAdminDashboard();
});

async function saveElectionDatesForClasses(classIds, startDate, endDate) {
  for (const cId of classIds) {
    await setDoc(doc(db, "elections_classes", cId), {
      classId: cId,
      startDate,
      endDate,
      statut: "en_cours",
      tour: 1,
      modeDesignation: false,
    }, { merge: true });
  }
}

function getDefaultResetYear() {
  const now = new Date();
  const year = now.getFullYear();
  const sept1ThisYear = new Date(`${year}-09-01T23:59:59`);
  // Si le 1er septembre de cette année est déjà passé, on cible l'année scolaire suivante
  return now > sept1ThisYear ? year + 1 : year;
}

async function loadElectionDateSettings(classId) {
  const startInput = document.getElementById("admin-election-start-date");
  const endInput = document.getElementById("admin-election-end-date");
  const statusEl = document.getElementById("election-date-status");

  if (!classId || !startInput || !endInput) return;

  startInput.value = "";
  endInput.value = "";

  if (classId === "ALL") {
    if (statusEl) {
      statusEl.textContent = "Renseigne des dates puis « Enregistrer » ou « Réinitialiser » pour les appliquer à toutes les classes.";
      statusEl.style.color = "var(--text-muted)";
    }
    return;
  }

  const snap = await getDoc(doc(db, "elections_classes", classId));
  if (snap.exists()) {
    const data = snap.data();
    startInput.value = formatDateInputValue(data.startDate);
    endInput.value = formatDateInputValue(data.endDate);
    if (statusEl) {
      statusEl.textContent = `Dates actuellement enregistrées pour la classe ${classId}.`;
      statusEl.style.color = "var(--accent)";
    }
  } else if (statusEl) {
    statusEl.textContent = `Aucune date enregistrée pour la classe ${classId}.`;
    statusEl.style.color = "var(--text-muted)";
  }
}

function loadAdminDashboard() {
  // Chargement des utilisateurs
  const usersRef = collection(db, "users");
  onSnapshot(usersRef, (snapshot) => {
    allUsers = [];
    let countDelegues = 0;
    let countAdmins = 0;
    const classesSet = new Set();

    snapshot.forEach((d) => {
      const u = { id: d.id, ...d.data() };
      allUsers.push(u);
      if (u.role === "delegue") countDelegues++;
      if (u.isAdmin === true) countAdmins++;
      if (u.classId) classesSet.add(u.classId);
    });

    document.getElementById("stat-total-users").textContent = allUsers.length;
    document.getElementById("stat-total-delegues").textContent = countDelegues;
    document.getElementById("stat-total-admins").textContent = countAdmins;

    const selectFilter = document.getElementById("filter-admin-class");
    selectFilter.innerHTML = '<option value="ALL">Toutes les classes</option>';
    classesSet.forEach(cId => {
      selectFilter.innerHTML += `<option value="${cId}">${cId}</option>`;
    });

    const electionClassSelect = document.getElementById("admin-election-class-select");
    if (electionClassSelect) {
      knownClasses = Array.from(classesSet);
      electionClassSelect.innerHTML = '<option value="">Sélectionner une classe</option><option value="ALL">📋 Toutes les classes</option>';
      knownClasses.forEach(cId => {
        electionClassSelect.innerHTML += `<option value="${cId}">${cId}</option>`;
      });

      if (!electionClassSelect.dataset.bound) {
        electionClassSelect.dataset.bound = "true";
        electionClassSelect.addEventListener("change", (e) => {
          loadElectionDateSettings(e.target.value);
        });
      }

      const firstClass = Array.from(classesSet)[0];
      if (firstClass) {
        electionClassSelect.value = firstClass;
        loadElectionDateSettings(firstClass);
      }
    }

    renderUsersList("ALL");
  });

  // Chargement des tickets de support
  const supportRef = collection(db, "support_tickets");
  onSnapshot(supportRef, (snapshot) => {
    const container = document.getElementById("admin-support-list");
    container.innerHTML = "";

    if (snapshot.empty) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🛟</div>
          <h4>Aucun message de support</h4>
          <p>Les demandes d’aide apparaîtront ici.</p>
        </div>
      `;
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

  document.getElementById("admin-collection-select").addEventListener("change", (e) => {
    loadDatabaseCollection(e.target.value);
  });

  document.getElementById("btn-save-election-dates")?.addEventListener("click", async () => {
    const classId = document.getElementById("admin-election-class-select")?.value;
    const startInput = document.getElementById("admin-election-start-date");
    const endInput = document.getElementById("admin-election-end-date");
    const statusEl = document.getElementById("election-date-status");

    if (!classId || !startInput?.value || !endInput?.value) {
      if (statusEl) {
        statusEl.textContent = "Sélectionnez une classe et renseignez les deux dates.";
        statusEl.style.color = "var(--danger)";
      }
      return;
    }

    const startDate = new Date(`${startInput.value}T00:00:00`);
    const endDate = new Date(`${endInput.value}T23:59:59`);

    if (endDate < startDate) {
      if (statusEl) {
        statusEl.textContent = "La date de fin doit être postérieure à la date de début.";
        statusEl.style.color = "var(--danger)";
      }
      return;
    }

    const targetClasses = classId === "ALL" ? knownClasses : [classId];
    if (targetClasses.length === 0) {
      if (statusEl) {
        statusEl.textContent = "Aucune classe disponible.";
        statusEl.style.color = "var(--danger)";
      }
      return;
    }

    try {
      await saveElectionDatesForClasses(targetClasses, startDate, endDate);

      if (statusEl) {
        statusEl.textContent = classId === "ALL"
          ? `Dates enregistrées pour les ${targetClasses.length} classes.`
          : `Dates enregistrées pour la classe ${classId}.`;
        statusEl.style.color = "var(--success)";
      }
    } catch (error) {
      console.error("Erreur lors de l'enregistrement des dates d'élection :", error);
      if (statusEl) {
        statusEl.textContent = "Échec de l'enregistrement. Vérifie la connexion puis réessaie.";
        statusEl.style.color = "var(--danger)";
      }
    }
  });

  document.getElementById("btn-reset-election-dates")?.addEventListener("click", async (e) => {
    const resetBtn = e.currentTarget;
    const classId = document.getElementById("admin-election-class-select")?.value;
    const startInput = document.getElementById("admin-election-start-date");
    const endInput = document.getElementById("admin-election-end-date");
    const statusEl = document.getElementById("election-date-status");

    if (!classId) {
      if (statusEl) {
        statusEl.textContent = "Sélectionnez une classe (ou « Toutes les classes ») avant de réinitialiser.";
        statusEl.style.color = "var(--danger)";
      }
      return;
    }

    // Confirmation en 2 clics (au lieu de window.confirm, qui peut être bloqué silencieusement
    // dans certains navigateurs/webviews et donner l'impression que le bouton ne répond pas).
    if (resetBtn.dataset.confirming !== "true") {
      resetBtn.dataset.confirming = "true";
      const originalLabel = resetBtn.textContent;
      resetBtn.dataset.originalLabel = originalLabel;
      resetBtn.textContent = "Cliquez à nouveau pour confirmer ✔️";
      if (statusEl) {
        statusEl.textContent = classId === "ALL"
          ? "Cliquez de nouveau sur le bouton pour confirmer la réinitialisation de TOUTES les classes."
          : `Cliquez de nouveau sur le bouton pour confirmer la réinitialisation pour la classe ${classId}.`;
        statusEl.style.color = "var(--danger)";
      }
      clearTimeout(resetBtn._confirmTimeout);
      resetBtn._confirmTimeout = setTimeout(() => {
        resetBtn.dataset.confirming = "false";
        resetBtn.textContent = resetBtn.dataset.originalLabel;
      }, 4000);
      return;
    }

    clearTimeout(resetBtn._confirmTimeout);
    resetBtn.dataset.confirming = "false";
    resetBtn.textContent = resetBtn.dataset.originalLabel || "↺ Réinitialiser (15/08 → 01/09)";

    const targetClasses = classId === "ALL" ? knownClasses : [classId];
    if (targetClasses.length === 0) {
      if (statusEl) {
        statusEl.textContent = "Aucune classe disponible.";
        statusEl.style.color = "var(--danger)";
      }
      return;
    }

    const year = getDefaultResetYear();
    const startDate = new Date(`${year}-08-15T00:00:00`);
    const endDate = new Date(`${year}-09-01T23:59:59`);

    try {
      await saveElectionDatesForClasses(targetClasses, startDate, endDate);

      if (startInput) startInput.value = formatDateInputValue(startDate);
      if (endInput) endInput.value = formatDateInputValue(endDate);

      if (statusEl) {
        statusEl.textContent = classId === "ALL"
          ? `Dates réinitialisées (15/08 → 01/09/${year}) pour les ${targetClasses.length} classes.`
          : `Dates réinitialisées (15/08 → 01/09/${year}) pour la classe ${classId}.`;
        statusEl.style.color = "var(--success)";
      }
    } catch (error) {
      console.error("Erreur lors de la réinitialisation des dates d'élection :", error);
      if (statusEl) {
        statusEl.textContent = "Échec de la réinitialisation. Vérifie la connexion puis réessaie.";
        statusEl.style.color = "var(--danger)";
      }
    }
  });

  loadDatabaseCollection("users");
}

async function loadDatabaseCollection(collectionName) {
  const container = document.getElementById("admin-database-list");
  if (!container) return;

  container.innerHTML = "<p style='color:var(--text-muted); font-style:italic;'>Chargement de la collection...</p>";

  try {
    const snapshot = await getDocs(collection(db, collectionName));
    const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (docs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🗂️</div>
          <h4>Aucune donnée dans cette collection</h4>
          <p>La base de données affichera ici les nouveaux éléments dès qu’ils seront ajoutés.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = "";

    docs.forEach((docData) => {
      const card = document.createElement("div");
      card.className = "card";
      card.style.cssText = "background:var(--bg-tertiary); margin-bottom:0.8rem; display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:0.75rem;";

      const info = document.createElement("div");
      info.style.flex = "1";

      const title = document.createElement("strong");
      title.textContent = `${collectionName} · ${docData.id}`;
      info.appendChild(title);

      const subtitle = document.createElement("p");
      subtitle.style.cssText = "margin:0.35rem 0 0.5rem; color:var(--text-muted); font-size:0.9rem;";

      if (collectionName === "users") {
        subtitle.textContent = `${docData.prenom || ""} ${docData.nom || ""}`.trim() || docData.email || "Utilisateur";
      } else if (collectionName === "demandes") {
        subtitle.textContent = `${docData.titre || "Sans titre"} · ${docData.statut || "Sans statut"}`;
      } else if (collectionName === "annonces") {
        subtitle.textContent = docData.titre || "Annonce";
      } else if (collectionName === "sondages") {
        subtitle.textContent = docData.question || "Sondage";
      } else if (collectionName === "support_tickets") {
        subtitle.textContent = `${docData.sujet || "Support"} · ${docData.userEmail || ""}`;
      } else {
        subtitle.textContent = JSON.stringify(docData).slice(0, 140);
      }
      info.appendChild(subtitle);

      const pre = document.createElement("pre");
      pre.style.cssText = "white-space:pre-wrap; word-break:break-word; font-size:0.72rem; margin:0; color:var(--text-muted);";
      pre.textContent = JSON.stringify(docData, null, 2);
      info.appendChild(pre);

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "0.4rem";
      actions.style.flexWrap = "wrap";

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-secondary";
      editBtn.style.cssText = "font-size:0.8rem; padding:0.4rem 0.8rem;";
      editBtn.textContent = "Modifier";
      editBtn.onclick = async () => {
        try {
          await editDocumentField(collectionName, docData.id, docData);
        } catch (err) {
          console.error("Erreur modification document :", err);
          alert("Impossible de modifier ce document.");
        }
      };
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn btn-secondary";
      deleteBtn.style.cssText = "font-size:0.8rem; padding:0.4rem 0.8rem;";
      deleteBtn.textContent = "Supprimer";
      deleteBtn.onclick = async () => {
        try {
          await deleteDoc(doc(db, collectionName, docData.id));
          await loadDatabaseCollection(collectionName);
        } catch (err) {
          console.error("Erreur suppression document :", err);
          alert("Impossible de supprimer ce document.");
        }
      };
      actions.appendChild(deleteBtn);

      if (collectionName === "users") {
        const roleBtn = document.createElement("button");
        roleBtn.className = "btn btn-secondary";
        roleBtn.style.cssText = "font-size:0.8rem; padding:0.4rem 0.8rem;";
        const isDelegue = docData.role === "delegue";
        roleBtn.textContent = isDelegue ? "Destituer" : "Nommer délégué";
        roleBtn.onclick = async () => {
          await updateDoc(doc(db, "users", docData.id), { role: isDelegue ? "eleve" : "delegue" });
          await loadDatabaseCollection("users");
        };
        actions.appendChild(roleBtn);

        const adminBtn = document.createElement("button");
        adminBtn.className = "btn btn-secondary";
        adminBtn.style.cssText = "font-size:0.8rem; padding:0.4rem 0.8rem;";
        const isAdminUser = docData.isAdmin === true;
        adminBtn.textContent = isAdminUser ? "Retirer admin" : "Rendre admin";
        adminBtn.onclick = async () => {
          await updateDoc(doc(db, "users", docData.id), { isAdmin: !isAdminUser });
          await loadDatabaseCollection("users");
        };
        actions.appendChild(adminBtn);
      }

      card.appendChild(info);
      card.appendChild(actions);
      container.appendChild(card);
    });
  } catch (err) {
    console.error("Erreur chargement collection :", err);
    container.innerHTML = `<p style='color:var(--danger);'>Impossible de charger cette collection.</p>`;
  }
}

function renderUsersList(selectedClass) {
  const container = document.getElementById("admin-users-list");
  container.innerHTML = "";

  const filtered = selectedClass === "ALL" 
    ? allUsers 
    : allUsers.filter(u => u.classId === selectedClass);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">👤</div>
        <h4>Aucun élève trouvé</h4>
        <p>Aucune personne ne correspond à ce filtre pour le moment.</p>
      </div>
    `;
    return;
  }

  filtered.forEach((u) => {
    const isDelegue = u.role === "delegue";
    const isAdminUser = u.isAdmin === true;
    const item = document.createElement("div");
    item.className = "card";
    item.style.cssText = "background:var(--bg-tertiary); margin-bottom:0.8rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;";

    item.innerHTML = `
      <div>
        <strong>${u.prenom || ''} ${u.nom || ''}</strong> <small style="color:var(--text-muted);">(${u.email})</small><br>
        <small style="color:var(--accent);">Classe: ${u.classe || u.classId || 'N/A'}</small> | 
        <span style="font-weight:bold; color:${isDelegue ? 'var(--warning)' : 'var(--text-muted)'}">${isDelegue ? '⭐ Délégué' : 'Élève'}</span>
        ${isAdminUser ? '<span style="font-weight:bold; color:var(--info); margin-left:0.4rem;">🛡️ Admin</span>' : ''}
      </div>
      <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
        <button class="btn btn-secondary btn-toggle-role" style="font-size:0.8rem; padding:0.4rem 0.8rem;">
          ${isDelegue ? 'Destituer ❌' : 'Nommer Délégué 👑'}
        </button>
        <button class="btn btn-secondary btn-toggle-admin" style="font-size:0.8rem; padding:0.4rem 0.8rem;">
          ${isAdminUser ? 'Retirer Admin 🛡️❌' : 'Rendre Admin 🛡️'}
        </button>
      </div>
    `;

    item.querySelector(".btn-toggle-role").onclick = async () => {
      const newRole = isDelegue ? "eleve" : "delegue";
      await updateDoc(doc(db, "users", u.id), { role: newRole });
      alert(`Rôle mis à jour pour ${u.prenom} ${u.nom}`);
    };

    item.querySelector(".btn-toggle-admin").onclick = async () => {
      await updateDoc(doc(db, "users", u.id), { isAdmin: !isAdminUser });
      alert(`Statut admin mis à jour pour ${u.prenom} ${u.nom}`);
    };

    container.appendChild(item);
  });
}

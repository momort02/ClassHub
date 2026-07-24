import { auth, db, setThemePreference } from "../firebase/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, setDoc, increment, getDocs, addDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

let currentUser = null;
let currentUserData = null;

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%23313338'/%3E%3Ccircle cx='32' cy='24' r='12' fill='%23949ba4'/%3E%3Cpath d='M8 60c2-14 14-22 24-22s22 8 24 22' fill='%23949ba4'/%3E%3C/svg%3E";

// Taille maximale prudente pour le champ `photoURL` (chaîne base64 stockée
// directement dans le document Firestore). Un document Firestore complet ne
// peut pas dépasser 1 Mo ; on se garde une grosse marge pour le reste du
// profil (nom, classe, historiques d'élection, etc.).
const MAX_AVATAR_DATA_URL_LENGTH = 250_000; // ~180 Ko d'image réelle

/**
 * Redimensionne et recadre une image en carré, puis la compresse en JPEG.
 * Tourne entièrement dans le navigateur (canvas), pas d'appel réseau :
 * évite Firebase Storage (qui exige désormais le plan payant Blaze) sans
 * dépendre d'un service tiers pour héberger les photos des élèves.
 */
function resizeImageToDataURL(file, size = 160, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image illisible."));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        // Recadrage "cover" : on remplit le carré en centrant l'image,
        // comme un avatar classique, plutôt que de la déformer.
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;

  const snap = await getDoc(doc(db, "users", user.uid));
  if (snap.exists()) {
    currentUserData = snap.data();
    
    // Vérification et réinitialisation annuelle (1er Septembre)
    await verifierReinitialisationAnnuelle();

    document.getElementById("profil-nom-complet").textContent = `${currentUserData.prenom} ${currentUserData.nom}`;
    document.getElementById("profil-email").textContent = currentUserData.email;
    document.getElementById("profil-avatar").src = currentUserData.photoURL || DEFAULT_AVATAR;
    document.getElementById("profil-classe").value = currentUserData.classe || currentUserData.classId;
    document.getElementById("profil-role").value =
      (currentUserData.role === "delegue" ? "Délégué" : "Élève") +
      (currentUserData.isAdmin === true ? " + Administrateur" : "");
    if (currentUserData.role === "delegue") document.getElementById("btn-delegue").style.display = "flex";
    if (currentUserData.isAdmin === true) document.getElementById("btn-admin").style.display = "flex";

    initThemeSettings();
    initElections();
    loadAvis();
    initAvatarUpload();
    initSupportForm();
  }
});

/** Permet à l'élève de changer sa photo de profil (compressée puis stockée dans Firestore). */
function initThemeSettings() {
  const toggle = document.getElementById("theme-toggle");
  const statusEl = document.getElementById("theme-status");
  if (!toggle) return;

  const currentTheme = document.documentElement.getAttribute("data-theme") || localStorage.getItem("classhub-theme") || "light";
  toggle.checked = currentTheme === "dark";

  if (toggle.dataset.bound === "true") return;
  toggle.dataset.bound = "true";

  toggle.addEventListener("change", async () => {
    const nextTheme = toggle.checked ? "dark" : "light";
    await setThemePreference(nextTheme);

    if (statusEl) {
      statusEl.textContent = nextTheme === "dark" ? "Mode sombre activé ✅" : "Mode clair activé ☀️";
      statusEl.style.display = "block";
      setTimeout(() => {
        statusEl.style.display = "none";
      }, 1800);
    }
  });
}

function initAvatarUpload() {
  const btnChange = document.getElementById("btn-change-avatar");
  const fileInput = document.getElementById("avatar-input");
  const statusEl = document.getElementById("avatar-status");
  if (!btnChange || !fileInput) return;

  btnChange.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      statusEl.textContent = "Ce fichier n'est pas une image.";
      statusEl.style.display = "block";
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      statusEl.textContent = "Image trop lourde (8 Mo max avant compression).";
      statusEl.style.display = "block";
      return;
    }

    statusEl.textContent = "Compression de l'image…";
    statusEl.style.display = "block";

    try {
      let dataUrl = await resizeImageToDataURL(file, 160, 0.72);

      // Si malgré la compression c'est encore trop lourd pour un champ
      // Firestore, on retente une fois en plus petit/plus compressé avant
      // d'abandonner (photo très détaillée, bruitée, etc.).
      if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
        dataUrl = await resizeImageToDataURL(file, 120, 0.55);
      }
      if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
        statusEl.textContent = "Image trop complexe même compressée, essaie une autre photo.";
        return;
      }

      await updateDoc(doc(db, "users", currentUser.uid), { photoURL: dataUrl });
      document.getElementById("profil-avatar").src = dataUrl;
      statusEl.textContent = "Photo mise à jour ✅";
      setTimeout(() => { statusEl.style.display = "none"; }, 2500);
    } catch (err) {
      console.error("Erreur traitement avatar:", err);
      statusEl.textContent = "Échec de l'envoi, réessaie.";
    }
  });
}

/** Envoie un message de support (lu par les admins sur admin.html). */
function initSupportForm() {
  const form = document.getElementById("form-support");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const sujet = document.getElementById("support-sujet").value.trim();
    const message = document.getElementById("support-message").value.trim();
    if (!sujet || !message) return;

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;

    try {
      await addDoc(collection(db, "support_tickets"), {
        sujet,
        message,
        userName: `${currentUserData.prenom} ${currentUserData.nom}`,
        userEmail: currentUserData.email,
        classId: currentUserData.classId,
        createdAt: serverTimestamp(),
      });
      form.reset();
      alert("Message envoyé au support !");
    } catch (err) {
      console.error("Erreur envoi support:", err);
      alert("Échec de l'envoi, réessaie.");
    } finally {
      btn.disabled = false;
    }
  });
}

// Réinitialisation automatique de la base de données le 1er septembre
async function verifierReinitialisationAnnuelle() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const rentreeDate = new Date(currentYear, 8, 1); // 1er Septembre

  // Si on est à partir du 1er septembre
  if (now >= rentreeDate) {
    const classRef = doc(db, "elections_classes", currentUserData.classId);
    const classSnap = await getDoc(classRef);

    // Si la réinitialisation de cette année n'a pas encore eu lieu
    if (!classSnap.exists() || classSnap.data().derniereRentree !== currentYear) {
      console.log(`🧹 Réinitialisation de la classe ${currentUserData.classId} pour la rentrée ${currentYear}...`);

      // 1. Réinitialiser les rôles des élèves de la classe
      const usersQuery = query(collection(db, "users"), where("classId", "==", currentUserData.classId));
      const usersSnap = await getDocs(usersQuery);
      for (const uDoc of usersSnap.docs) {
        await updateDoc(doc(db, "users", uDoc.id), {
          role: "eleve",
          votesElectoraux: 0,
          votesDesignation: 0,
          isCandidat: false
        });
      }

      // 2. Supprimer les votes enregistrés pour cette classe
      const votesQuery = query(collection(db, "elections_votes"), where("classId", "==", currentUserData.classId));
      const votesSnap = await getDocs(votesQuery);
      for (const vDoc of votesSnap.docs) {
        await deleteDoc(doc(db, "elections_votes", vDoc.id));
      }

      // 3. Supprimer les candidatures en binômes
      const binomesQuery = query(collection(db, "binomes_candidats"), where("classId", "==", currentUserData.classId));
      const binomesSnap = await getDocs(binomesQuery);
      for (const bDoc of binomesSnap.docs) {
        await deleteDoc(doc(db, "binomes_candidats", bDoc.id));
      }

      // 4. Mettre à jour le statut d'élection de la classe pour la nouvelle année
      await setDoc(classRef, {
        classId: currentUserData.classId,
        tour: 1,
        statut: "en_cours",
        modeDesignation: false,
        derniereRentree: currentYear
      });

      console.log("✅ Réinitialisation annuelle effectuée !");
    }
  }
}

async function initElections() {
  const now = new Date();
  const year = now.getFullYear();
  const startDate = new Date(year, 8, 15); // 15 Septembre
  const endDate = new Date(year, 9, 1);    // 1er Octobre

  const statusMsg = document.getElementById("election-status-msg");
  const candBox = document.getElementById("election-candidature-box");
  const voteBox = document.getElementById("election-vote-box");

  if (now < startDate) {
    statusMsg.textContent = `Les élections ouvriront le 15 septembre ${year}.`;
    return;
  }

  const electionRef = doc(db, "elections_classes", currentUserData.classId);
  const electionSnap = await getDoc(electionRef);

  let tourActuel = 1;
  let modeDesignation = false;

  if (electionSnap.exists()) {
    tourActuel = electionSnap.data().tour || 1;
    modeDesignation = electionSnap.data().modeDesignation || false;
    if (electionSnap.data().statut === "termine") {
      statusMsg.textContent = "Élections terminées. Les 2 binômes de délégués ont été nommés.";
      return;
    }
  }

  const usersQuery = query(collection(db, "users"), where("classId", "==", currentUserData.classId));
  const usersSnap = await getDocs(usersQuery);
  const totalEleves = usersSnap.size;

  const binomesQuery = query(collection(db, "binomes_candidats"), 
    where("classId", "==", currentUserData.classId),
    where("tourQualifie", "==", tourActuel)
  );
  const binomesSnap = await getDocs(binomesQuery);

  const selectSupp = document.getElementById("select-suppleant");
  if (selectSupp) {
    selectSupp.innerHTML = '<option value="">-- Sélectionner un élève --</option>';
    usersSnap.forEach((d) => {
      const u = d.data();
      if (u.uid !== currentUser.uid) {
        selectSupp.innerHTML += `<option value="${u.uid}">${u.prenom} ${u.nom}</option>`;
      }
    });
  }

  if (binomesSnap.empty && (now >= endDate || modeDesignation)) {
    if (!modeDesignation) {
      await updateDoc(electionRef, { modeDesignation: true });
    }
    statusMsg.textContent = "⚠️ Aucun candidat ne s'est présenté. La classe doit désigner d'office 2 binômes !";
    candBox.style.display = "none";
    voteBox.style.display = "block";
    afficherModeDesignation(usersSnap);
    return;
  }

  const votesQuery = query(collection(db, "elections_votes"), 
    where("classId", "==", currentUserData.classId),
    where("tour", "==", tourActuel)
  );
  const votesSnap = await getDocs(votesQuery);
  const totalVotesCount = votesSnap.size;
  const hasVoted = votesSnap.docs.some(d => d.data().voterUid === currentUser.uid);

  document.getElementById("tour-titre").textContent = `Élection de 2 Binômes - ${tourActuel === 1 ? "1er Tour (Majorité absolue)" : "2nd Tour (Majorité relative)"}`;
  statusMsg.textContent = `${tourActuel}${tourActuel === 1 ? 'er' : 'nd'} Tour : ${totalVotesCount}/${totalEleves} élèves ont voté. (2 binômes seront élus).`;

  candBox.style.display = tourActuel === 1 ? "block" : "none";
  voteBox.style.display = "block";

  const btnCreer = document.getElementById("btn-creer-binome");
  if (btnCreer) {
    btnCreer.onclick = async () => {
      const suppUid = selectSupp.value;
      if (!suppUid) return alert("Sélectionnez un suppléant.");

      const suppSnap = await getDoc(doc(db, "users", suppUid));
      const suppData = suppSnap.data();

      await addDoc(collection(db, "binomes_candidats"), {
        classId: currentUserData.classId,
        titulaireUid: currentUser.uid,
        titulaireNom: `${currentUserData.prenom} ${currentUserData.nom}`,
        suppleantUid: suppUid,
        suppleantNom: `${suppData.prenom} ${suppData.nom}`,
        votesTour1: 0,
        votesTour2: 0,
        tourQualifie: 1
      });

      alert("Votre binôme est bien inscrit pour l'élection !");
      location.reload();
    };
  }

  const candList = document.getElementById("candidats-list");
  candList.innerHTML = "";

  binomesSnap.forEach((d) => {
    const b = d.data();
    const btnVote = document.createElement("button");
    btnVote.className = "btn btn-secondary";
    btnVote.style.cssText = "width:100%; margin-bottom:0.8rem; justify-content:space-between; text-align:left; padding:0.8rem;";
    btnVote.disabled = hasVoted;

    btnVote.innerHTML = `
      <div>
        <strong>Titulaire:</strong> ${b.titulaireNom}<br>
        <small style="color:var(--text-muted);">Suppléant: ${b.suppleantNom}</small>
      </div>
      <span>${hasVoted ? "A voté" : "Voter 👍"}</span>
    `;

    btnVote.onclick = async () => {
      if (hasVoted) return;

      const voteField = tourActuel === 1 ? "votesTour1" : "votesTour2";
      await updateDoc(doc(db, "binomes_candidats", d.id), { [voteField]: increment(1) });
      
      await setDoc(doc(db, "elections_votes", `${currentUser.uid}_T${tourActuel}_${currentUserData.classId}`), {
        classId: currentUserData.classId,
        voterUid: currentUser.uid,
        tour: tourActuel,
        votedAt: new Date()
      });

      alert("Vote anonyme enregistré !");
      location.reload();
    };

    candList.appendChild(btnVote);
  });

  if (candList.children.length === 0) {
    candList.innerHTML = "<p style='font-style:italic; font-size:0.85rem;'>Aucun binôme candidat pour l'instant.</p>";
  }

  if (totalEleves > 0 && totalVotesCount >= totalEleves) {
    depouillerElections(tourActuel, binomesSnap, totalVotesCount);
  }
}

async function depouillerElections(tour, binomesSnap, totalVotes) {
  let binomes = [];
  binomesSnap.forEach(d => binomes.push({ id: d.id, ...d.data() }));

  if (tour === 1) {
    binomes.sort((a, b) => b.votesTour1 - a.votesTour1);
    const majoriteAbsolue = Math.floor(totalVotes / 2) + 1;

    if (binomes.length >= 2 && binomes[0].votesTour1 >= majoriteAbsolue && binomes[1].votesTour1 >= majoriteAbsolue) {
      await nommer2BinomesGagnants(binomes[0], binomes[1]);
    } else {
      for (let i = 0; i < Math.min(4, binomes.length); i++) {
        await updateDoc(doc(db, "binomes_candidats", binomes[i].id), { tourQualifie: 2 });
      }
      await updateDoc(doc(db, "elections_classes", currentUserData.classId), { tour: 2 });
      alert("Ouverture du 2nd tour pour élire les 2 binômes !");
      location.reload();
    }
  } else if (tour === 2) {
    binomes.sort((a, b) => b.votesTour2 - a.votesTour2);
    if (binomes.length >= 2) {
      await nommer2BinomesGagnants(binomes[0], binomes[1]);
    } else if (binomes.length === 1) {
      await nommer1BinomeGagnant(binomes[0]);
    }
  }
}

async function nommer2BinomesGagnants(b1, b2) {
  await updateDoc(doc(db, "users", b1.titulaireUid), { role: "delegue" });
  await updateDoc(doc(db, "users", b1.suppleantUid), { role: "delegue" });
  await updateDoc(doc(db, "users", b2.titulaireUid), { role: "delegue" });
  await updateDoc(doc(db, "users", b2.suppleantUid), { role: "delegue" });

  await updateDoc(doc(db, "elections_classes", currentUserData.classId), { statut: "termine" });
  alert("Élection terminée ! Les 2 binômes de délégués ont été officiellement élus.");
  location.reload();
}

async function nommer1BinomeGagnant(b1) {
  await updateDoc(doc(db, "users", b1.titulaireUid), { role: "delegue" });
  await updateDoc(doc(db, "users", b1.suppleantUid), { role: "delegue" });

  await updateDoc(doc(db, "elections_classes", currentUserData.classId), { statut: "termine" });
  alert("Élection terminée ! Le binôme a été élu.");
  location.reload();
}

function afficherModeDesignation(usersSnap) {
  const candList = document.getElementById("candidats-list");
  candList.innerHTML = "<p style='font-size:0.85rem; margin-bottom:1rem;'>Votez pour l'élève que vous souhaitez désigner comme délégué d'office :</p>";

  usersSnap.forEach((d) => {
    const u = d.data();
    const btnDesign = document.createElement("button");
    btnDesign.className = "btn btn-secondary";
    btnDesign.style.cssText = "width:100%; margin-bottom:0.5rem; justify-content:space-between;";
    btnDesign.innerHTML = `<span>${u.prenom} ${u.nom}</span> <span>Désigner 🗳️</span>`;

    btnDesign.onclick = async () => {
      await updateDoc(doc(db, "users", d.id), { votesDesignation: increment(1) });
      alert(`Votre désignation pour ${u.prenom} a été enregistrée.`);
      location.reload();
    };
    candList.appendChild(btnDesign);
  });
}

function loadAvis() {
  const q = query(collection(db, "avis_profs"), where("eleveUid", "==", currentUser.uid));
  onSnapshot(q, (snapshot) => {
    const container = document.getElementById("liste-avis-container");
    container.innerHTML = "";
    if (snapshot.empty) {
      container.innerHTML = `<p style="color:var(--text-muted); font-style:italic;">Aucun avis enregistré.</p>`;
      return;
    }
    snapshot.forEach((d) => {
      const data = d.data();
      container.innerHTML += `
        <div class="card" style="background:var(--bg-tertiary); margin-bottom:0.8rem;">
          <strong style="color:var(--accent);">${data.periode}</strong>
          <p style="margin-top:0.4rem;">"${data.avis}"</p>
        </div>`;
    });
  });
}

// ============================================================================
// sondages.js — Page "Sondages". Le vote est désormais dédupliqué côté
// Firestore via un tableau `votedBy` sur le document (au lieu du localStorage
// précédent, qui pouvait être contourné en navigation privée ou en changeant
// d'appareil).
// ============================================================================

import { auth, db } from "../firebase/firebase.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import {
  collection, query, where, onSnapshot, doc, getDoc, updateDoc, increment, arrayUnion,
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const u = await getDoc(doc(db, "users", user.uid));
  if (!u.exists()) return;

  onSnapshot(query(collection(db, "sondages"), where("classId", "==", u.data().classId)), (s) => {
    const c = document.getElementById("sondages-list");
    c.innerHTML = "";

    if (s.empty) {
      c.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <h4>Aucun sondage pour le moment</h4>
          <p>Les sondages créés par la classe apparaîtront ici.</p>
        </div>
      `;
      return;
    }

    s.forEach((d) => {
      const v = d.data();
      const pollId = d.id;
      const votedBy = v.votedBy || [];
      const hasVoted = votedBy.includes(user.uid);

      const div = document.createElement("div");
      div.className = "card";
      div.innerHTML = `
        <h3>📊 ${v.question}</h3>
        <div style="margin-top:1rem; display:flex; gap:0.5rem; flex-direction:column;">
          <button class="btn btn-secondary opt1" ${hasVoted ? "disabled" : ""}>${v.opt1} (${v.votes1})</button>
          <button class="btn btn-secondary opt2" ${hasVoted ? "disabled" : ""}>${v.opt2} (${v.votes2})</button>
        </div>
        ${hasVoted ? '<p style="color:var(--text-muted); font-size:0.8rem; margin-top:0.5rem; text-align:center;">Vous avez déjà voté</p>' : ""}
      `;

      const handleVote = async (field) => {
        // Relit le document au moment du clic pour éviter un double-vote en
        // cas de clics rapprochés avant que le prochain onSnapshot n'arrive.
        const fresh = await getDoc(doc(db, "sondages", pollId));
        const freshVoted = fresh.data()?.votedBy || [];
        if (freshVoted.includes(user.uid)) return;

        await updateDoc(doc(db, "sondages", pollId), {
          [field]: increment(1),
          votedBy: arrayUnion(user.uid),
        });
      };

      div.querySelector(".opt1").addEventListener("click", () => handleVote("votes1"));
      div.querySelector(".opt2").addEventListener("click", () => handleVote("votes2"));

      c.appendChild(div);
    });
  });
});


import { auth, db } from "../firebase/firebase.js";
import { initNotifications } from "./notifications.js";

initNotifications();
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { collection, query, where, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  const u = await getDoc(doc(db, "users", user.uid));
  if(u.exists()) {
    onSnapshot(query(collection(db, "annonces"), where("classId", "==", u.data().classId)), (s) => {
      const container = document.getElementById("annonces-list");
      container.innerHTML = "";

      if (s.empty) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📢</div>
            <h4>Aucune annonce pour le moment</h4>
            <p>Les prochaines publications de la classe apparaîtront ici.</p>
          </div>
        `;
        return;
      }

      s.forEach(d => {
        const v = d.data();
        container.innerHTML += `<div class="card"><h3>📢 ${v.titre}</h3><p style="margin-top:0.5rem;font-size:0.95rem;">${v.contenu}</p></div>`;
      });
    });
  }
});

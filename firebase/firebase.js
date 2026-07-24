import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCATWpxQOgJJvXhaH2y-aANiF0RUvx5Fw0",
  authDomain: "classhub-ff5d1.firebaseapp.com",
  projectId: "classhub-ff5d1",
  storageBucket: "classhub-ff5d1.firebasestorage.app",
  messagingSenderId: "1031121129173",
  appId: "1:1031121129173:web:f973322702d430c60b1c5c",
  measurementId: "G-FJ8ZR3571V"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

const THEME_STORAGE_KEY = "classhub-theme";

function applyTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", normalized);
  document.body?.setAttribute("data-theme", normalized);
  localStorage.setItem(THEME_STORAGE_KEY, normalized);

  const toggle = document.getElementById("theme-toggle");
  if (toggle) toggle.checked = normalized === "dark";
}

export async function setThemePreference(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  applyTheme(normalized);

  if (!auth.currentUser) return;

  try {
    await setDoc(doc(db, "users", auth.currentUser.uid), {
      preferences: {
        theme: normalized
      }
    }, { merge: true });
  } catch (error) {
    console.error("Erreur enregistrement thème Firebase:", error);
  }
}

function initThemePreference() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || "light";
  applyTheme(savedTheme);

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const firestoreTheme = snap.exists() && snap.data()?.preferences?.theme;
      if (firestoreTheme) {
        applyTheme(firestoreTheme);
      }
    } catch (error) {
      console.error("Erreur chargement thème depuis Firebase:", error);
    }
  });
}

initThemePreference();



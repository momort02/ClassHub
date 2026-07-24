import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

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
// Pas d'export "storage" : les photos de profil sont stockées directement
// dans Firestore (voir js/profil.js), pas besoin de Firebase Storage, donc
// pas besoin du plan payant Blaze pour ça.


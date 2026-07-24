import { auth, db, googleProvider } from "../firebase/firebase.js";
import { signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

const btnLoginGoogle = document.getElementById("btn-login-google");
const formEmailLogin = document.getElementById("form-email-login");
const btnSignUp = document.getElementById("btn-sign-up");
const emailInput = document.getElementById("email-input");
const passwordInput = document.getElementById("password-input");
const authError = document.getElementById("auth-error");

const loginCard = document.getElementById("login-card");
const onboardingContainer = document.getElementById("onboarding-container");
const btnSaveOnboarding = document.getElementById("btn-save-onboarding");

const searchInput = document.getElementById("search-etablissement");
const etablissementSelect = document.getElementById("onboard-etablissement");

function showError(msg) {
  if (authError) { authError.textContent = msg; authError.style.display = "block"; }
}

if (btnLoginGoogle) {
  btnLoginGoogle.addEventListener("click", async () => {
    try { const res = await signInWithPopup(auth, googleProvider); checkUser(res.user); }
    catch(e) { showError(e.message); }
  });
}

if (formEmailLogin) {
  formEmailLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { const res = await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value); checkUser(res.user); }
    catch(e) { showError("Identifiants incorrects."); }
  });
}

if (btnSignUp) {
  btnSignUp.addEventListener("click", async () => {
    try { const res = await createUserWithEmailAndPassword(auth, emailInput.value, passwordInput.value); checkUser(res.user); }
    catch(e) { showError(e.message); }
  });
}

async function checkUser(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) {
    loginCard.style.display = "none";
    onboardingContainer.style.display = "block";
  } else {
    window.location.href = "dashboard.html";
  }
}

let searchTimeout;
searchInput?.addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();
  if (query.length < 3) return;
  searchTimeout = setTimeout(() => { fetchEtablissementsGouv(query); }, 400);
});

async function fetchEtablissementsGouv(query) {
  try {
    const url = `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records?where=search(nom_etablissement, "${query}") or search(nom_commune, "${query}")&limit=20&lang=fr`;
    const response = await fetch(url);
    const data = await response.json();

    etablissementSelect.innerHTML = '<option value="">-- Choisir dans la liste --</option>';

    if (data.results && data.results.length > 0) {
      data.results.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.identifiant_de_l_etablissement;
        option.textContent = `${item.nom_etablissement} (${item.nom_commune})`;
        option.dataset.fullname = item.nom_etablissement;
        option.dataset.city = item.nom_commune;
        etablissementSelect.appendChild(option);
      });
      etablissementSelect.disabled = false;
    } else {
      etablissementSelect.innerHTML = '<option value="">Aucun établissement trouvé</option>';
      etablissementSelect.disabled = true;
    }
  } catch (err) {
    console.error("Erreur API Annuaire Éducation:", err);
  }
}

btnSaveOnboarding?.addEventListener("click", async () => {
  const user = auth.currentUser;
  const selectedOption = etablissementSelect.options[etablissementSelect.selectedIndex];
  const uai = etablissementSelect.value;
  const niveau = document.getElementById("onboard-niveau").value;
  const numClasse = document.getElementById("onboard-numero-classe").value.trim().toUpperCase();

  if (!uai || !niveau || !numClasse) return alert("Veuillez remplir tous les champs.");

  const classeNom = `${niveau} ${numClasse}`;
  const classId = `${uai}_${niveau}_${numClasse}`;

  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    email: user.email,
    prenom: document.getElementById("onboard-prenom").value,
    nom: document.getElementById("onboard-nom").value,
    etablissementUAI: uai,
    etablissementNom: selectedOption.dataset.fullname,
    ville: selectedOption.dataset.city,
    niveau: niveau,
    numeroClasse: numClasse,
    classe: classeNom,
    classId: classId,
    role: "eleve"
  });

  window.location.href = "dashboard.html";
});
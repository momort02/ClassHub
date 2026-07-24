# ClassHub

## État du projet

Ce dépôt est ta version d'origine. Une passe de correctifs vient d'être
appliquée : **#2 (mot de passe admin), #4 (votes dédupliqués), #5
(commentaires, anonymat, photo de profil)**.

### Ce qui a été corrigé dans cette passe

- **Admin (`admin.js` / `admin.html`)** : le mot de passe maître écrit en
  clair dans le JS a été retiré. L'accès dépend maintenant du champ
  `role: "admin"` sur le profil Firestore du compte connecté.
  → **Pour nommer le premier admin** : Firebase Console → Firestore Database
  → collection `users` → document de la personne → mettre `role` à `"admin"`
  à la main. Cette personne peut ensuite gérer les rôles depuis `admin.html`.

- **Votes (`demandes.js`, `sondages.js`)** : le suivi "j'ai déjà voté" ne
  repose plus sur `localStorage` (contournable en navigation privée ou sur un
  autre appareil) mais sur un tableau `votedBy` stocké dans le document
  Firestore lui-même.

- **Demandes (`demandes.js`, `dashboard.html`)** :
  - case "Publier anonymement" à la création (`anonyme: true/false`),
    masque le nom dans la liste élève ET dans la vue délégué
  - `authorUid` est maintenant enregistré sur chaque demande
  - espace de discussion en temps réel sous chaque demande
    (sous-collection `demandes/{id}/commentaires`)

- **Profil (`profil.js`, `profil.html`)** :
  - photo de profil (upload vers Firebase Storage, `avatars/{uid}`)
  - le formulaire "Contact & Support" fonctionne enfin (il ne faisait rien
    avant : `admin.html` attendait des tickets qui n'étaient jamais créés)

### Ce qui n'a volontairement pas été touché

- **`firestore.rules` reste grand ouvert** (`allow read, write: if
  request.auth != null`). N'importe quel compte connecté peut toujours lire
  ou écrire n'importe quel document, de n'importe quelle classe. Les champs
  ajoutés dans cette passe (`votedBy`, `authorUid`, `role: "admin"`) sont
  prêts à être exploités par des règles plus strictes le jour où on s'y
  attaque, mais pour l'instant rien n'empêche un utilisateur malveillant de
  les modifier directement.
- **Le système d'élection** (`profil.js`) attribue `role: "delegue"` via un
  `updateDoc` déclenché depuis le navigateur d'un élève normal, à la fin du
  dépouillement. Sécuriser les règles sans casser ce mécanisme demandera un
  traitement dédié (vérifier via les règles que l'élection est réellement
  terminée avant d'autoriser le changement de rôle).

### Prochaine étape suggérée

Reprendre les règles Firestore (`firestore.rules`) pour limiter chaque
lecture/écriture à la bonne classe et au bon rôle, en tenant compte du cas
particulier de l'élection.


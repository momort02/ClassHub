# ClassHub — Notifications push (Cloudflare Workers, 100% gratuit)

Ce dossier remplace Firebase Cloud Functions : pas besoin du plan Blaze ni de
carte bancaire. Un Worker Cloudflare tourne toutes les 2 minutes (cron gratuit),
regarde ce qui a changé dans Firestore, et envoie les notifications push.

## Ce qu'il faut avant de commencer

- Un compte Cloudflare gratuit → https://dash.cloudflare.com/sign-up
- Node.js installé sur ton PC
- Une **clé de compte de service Firebase** (fichier JSON) :
  Firebase Console → ⚙️ Paramètres du projet → **Comptes de service** →
  "Générer une nouvelle clé privée" → télécharge le fichier `.json`.
  ⚠️ Ne commite jamais ce fichier sur GitHub, garde-le en local uniquement.

## Étapes de déploiement

```bash
cd notifications-worker

# 1. Installer l'outil Cloudflare
npm install -g wrangler

# 2. Se connecter à ton compte Cloudflare (ouvre le navigateur)
wrangler login

# 3. Créer l'espace de stockage KV (mémorise le "dernier passage" du cron)
wrangler kv namespace create NOTIF_STATE
```

La commande précédente affiche un `id` — copie-le dans `wrangler.toml`,
à la place de `REMPLACE_MOI_PAR_L_ID_DU_NAMESPACE_KV`.

```bash
# 4. Enregistrer le compte de service comme secret (jamais dans le code)
wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
# -> colle tout le contenu du fichier .json téléchargé, puis Entrée

# 5. Enregistrer un jeton pour l'endpoint de test manuel (inventes-en un)
wrangler secret put MANUAL_TRIGGER_TOKEN
# -> ex: un mot de passe long et aléatoire

# 6. Déployer
wrangler deploy
```

## Vérifier que ça marche

Une fois déployé, Wrangler affiche une URL du type
`https://classhub-notifications.<ton-compte>.workers.dev`.

Pour déclencher un passage manuellement (sans attendre le cron) :
```
https://classhub-notifications.<ton-compte>.workers.dev/?token=LE_JETON_CHOISI_A_L_ETAPE_5
```

**Important** : le tout premier appel n'envoie rien — il initialise juste le
curseur de suivi (`firstRun: true` dans la réponse), pour ne pas spammer tout
le monde avec l'historique complet. À partir du deuxième passage, ça envoie
les notifications pour tout ce qui a changé depuis.

## Coût réel

- Cloudflare Workers : 100 000 requêtes/jour gratuites (le cron toutes les
  2 min ≈ 720 exécutions/jour, très largement dans le quota gratuit)
- Cloudflare KV : quota gratuit largement suffisant pour une seule clé
- Firestore (lecture via API REST) et FCM (envoi de notifications) : gratuits,
  aucun changement de plan Firebase nécessaire

## Limite à connaître

Contrairement à Cloud Functions (temps réel), ce système vérifie toutes les
**2 minutes** — un délai de quelques dizaines de secondes à 2 minutes est donc
normal entre l'action (nouvelle demande, réponse, etc.) et la réception de la
notification. Pour une appli de classe, c'est largement suffisant.

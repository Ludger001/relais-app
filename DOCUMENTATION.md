# Relais — Documentation technique

Ce fichier est la référence unique du projet : ce que fait l'application, comment
elle est bâtie, qui a le droit de faire quoi, et pourquoi les choix ont été faits
ainsi. Il est écrit pour qu'une personne — ou une IA — qui découvre le projet
puisse reprendre le travail sans reconstituer le contexte.

**Feuille de route consultable :** https://claude.ai/code/artifact/db4077a6-63b7-42ac-afe2-ed0ad10f067e

---

## 1. Ce que fait l'application

Relais est un **réseau B2B fermé** qui met en relation deux professionnels du
commerce en Afrique de l'Ouest et Centrale :

- l'**e-commerçant**, qui vend en ligne et a des colis à faire livrer,
- l'**agence de livraison COD**, qui livre et encaisse le paiement en espèces
  chez le client final (*Cash On Delivery*).

Pays couverts : Bénin, Togo, Sénégal, Côte d'Ivoire, Gabon.

### Le modèle économique

Relais **ne livre rien et n'emploie personne**. C'est un tiers de confiance entre
deux clients payants. Le revenu vient de **deux abonnements mensuels**, jamais
d'une commission sur les livraisons :

| Abonné | Plan | Tarif | Tarif barré |
|---|---|---|---|
| E-commerçant | `starter_merchant` | 10 000 FCFA / mois | 15 000 FCFA |
| Agence | `pro_agency` | 25 000 FCFA / mois | 35 000 FCFA |

La grille vit dans la table `plans_abonnement`, pas en dur dans le HTML.

### Le vrai produit : la disparition d'Excel

Le chat n'est pas le produit. Le produit, c'est la **réconciliation financière
automatique**.

Aujourd'hui, une agence finit sa tournée et bricole un tableau : commandes
livrées, cash encaissé, ses frais, la soustraction — puis elle envoie ça au
marchand qui doit la croire sur parole.

Dans Relais, l'agence clôture ses commandes une par une et le bilan se calcule
tout seul. **Les deux parties voient exactement les mêmes chiffres**, parce que
c'est la base de données qui les calcule, pas l'une des deux parties.

### La clé de voûte : le bon de commande structuré

Le marchand ne tape **jamais** un numéro de téléphone dans la conversation. Il
remplit un formulaire, et les coordonnées du client voyagent par la table
`orders` — pas par la messagerie.

D'où la règle du filtre anti-désintermédiation :

- **contact du client final = autorisé** — c'est le métier, l'agence en a besoin
  pour livrer ;
- **contact entre marchand et agence = interdit** — c'est la désintermédiation,
  et elle détruirait le modèle économique.

---

## 2. Fonctionnalités implémentées

### Comptes et accès
- Inscription e-commerçant et agence, avec mot de passe
- Connexion, déconnexion, mot de passe oublié
- Le rôle vient du profil en base — jamais d'un choix côté navigateur
- Le profil et la fiche métier se créent automatiquement à l'inscription
- Une demande de rôle « administrateur » à l'inscription est **ignorée**
- Chaque rôle n'a accès qu'à ses propres écrans, y compris contre un forçage
  depuis la console du navigateur

### Annuaire
- Liste des agences **certifiées uniquement**
- Filtres par pays, par ville, par fréquence de reversement, par entreposage
- Le filtre « ville » se construit à partir des agences réellement présentes
- Trois états vides distincts : annuaire injoignable, aucune agence certifiée,
  aucun résultat pour ces critères

### Chat sécurisé
- Une conversation exclusive par paire marchand–agence
- Seul un marchand peut ouvrir une conversation, et seulement vers une agence
  certifiée
- Tout message passe par une **fonction serveur** qui le filtre avant écriture
- Le texte d'origine est conservé mais **illisible pour tous les clients**
- Les tentatives de contournement sont tracées pour l'administrateur

### Commandes COD
- Bon de commande structuré : produit, quantité, montant à encaisser, frais
  convenus, et coordonnées complètes du destinataire
- Référence générée par la base (`REL-2026-00001`)
- La carte de commande s'affiche dans le fil, construite depuis la table
- Seule l'agence en charge peut faire évoluer la livraison
- Chaque changement de statut est consigné : qui, quand, de quoi vers quoi
- Les conditions sont **figées** dès que le colis est pris en charge

### Point financier
- Bilan par période : aujourd'hui, hier, 7 jours, 30 jours, tout l'historique
- Cash encaissé − frais de livraison = net à reverser
- Calculé uniquement sur les livraisons réussies

### Reversement du cash
Trois gestes, deux acteurs, aucun raccourci possible :
1. l'agence **arrête les comptes** sur une période → `draft`
2. elle **déclare le virement** avec justificatif → `initiated`
3. le marchand **confirme la réception** → `confirmed`, et les commandes sont soldées

Chacun peut **contester** tant que le reversement n'est pas confirmé.

### Certification des agences (KYC)
- L'agence dépose ses pièces depuis son espace (PDF, JPG, PNG — 5 Mo max)
- Dépôt **privé** : chaque agence ne voit que ses fichiers
- Consultation par lien signé valable **2 minutes** — jamais d'adresse permanente
- L'administrateur voit les dossiers en attente et les pièces réellement déposées
- Un dossier sans pièce est signalé en rouge
- Une agence ne peut pas se certifier elle-même

### Abonnements
- Grille tarifaire en base
- Lecture de l'état avec période de grâce
- Bandeau d'alerte à l'approche de l'échéance ou après expiration
- Table `paiements` pour tracer les transactions, avec la réponse brute du
  prestataire conservée

---

## 3. Structure des fichiers

```
relais-app/
├── public/                      ← ce que Vercel met en ligne
│   ├── index.html               page d'accueil publique (landing, tarifs, FAQ)
│   ├── connexion.html           connexion et mot de passe oublié
│   ├── inscription-marchand.html
│   ├── candidature-agence.html
│   ├── app.html                 l'application : annuaire, chat, agence, finance, admin
│   ├── app.js                   toute la logique applicative
│   ├── style.css                design system de l'application
│   ├── landing.css              design system des pages publiques
│   ├── lib/
│   │   ├── supabaseClient.js    connexion, session, profil, traduction des erreurs
│   │   ├── inscription.js       logique partagée des deux formulaires
│   │   └── antiBypassFilter.js  filtre — côté navigateur, AVERTISSEMENT SEUL
│   └── assets/                  images
│
├── supabase/functions/
│   └── envoyer-message/         fonction serveur : le filtre qui fait foi
│       ├── index.ts             vérification du jeton, du participant, écriture
│       └── filtre.js            COPIE GÉNÉRÉE — ne pas éditer à la main
│
├── database/
│   ├── 01_schema.sql            12 tables, 9 types, 14 index
│   ├── 02_securite.sql          fonctions d'identité, RLS, retrait des privilèges
│   ├── 03_comptes_et_commandes.sql  création de profil, références, gel des conditions
│   └── README.md                notes de sécurité de la base
│
├── scripts/
│   └── genererFiltreServeur.js  produit la copie serveur du filtre
│
├── tests/
│   ├── testAntiBypass.js        les règles du filtre
│   ├── testFiltreSynchronise.js les deux copies disent-elles la même chose ?
│   ├── testRoles.js             cloisonnement des rôles + tentatives de forçage
│   ├── testAffichageVide.js     aucun écran ne plante avec une base vide
│   ├── testResponsive.js        6 pages × 8 modèles de téléphones
│   ├── testChatServeur.js       le filtre serveur est-il contournable ?
│   ├── testCycleCommande.js     cycle complet, marchand + agence simultanés
│   ├── testCertificationKYC.js  parcours de certification, 3 rôles
│   └── testReversement.js       double accusé de réception
│
├── README.md                    démarrage rapide et feuille de route
├── DOCUMENTATION.md             ce fichier
├── package.json
└── vercel.json                  dossier servi + en-têtes de sécurité HTTP
```

---

## 4. Technologies

| Rôle | Choix | Pourquoi |
|---|---|---|
| Pages | HTML / CSS / JavaScript, sans framework | Pas d'étape de compilation ; le fichier écrit est le fichier servi |
| Base de données | PostgreSQL via Supabase | Le métier est comptable : totaux, jointures, intégrité. Un modèle relationnel s'imposait |
| Authentification | Supabase Auth | Intégré aux règles de sécurité de la base |
| Fichiers | Supabase Storage | Dépôt privé avec liens signés |
| Serveur | Supabase Edge Functions (Deno) | Un seul point de passage pour les messages |
| Hébergement | Vercel | Redéploiement automatique à chaque `git push` |
| Tests navigateur | Playwright | Mesurer réellement, sur de vrais formats d'écran |

**Aucune dépendance dans le navigateur** hormis la librairie Supabase, chargée
depuis un CDN. Pas de React, pas de Tailwind, pas d'empaqueteur.

### Environnement

| | |
|---|---|
| Projet Supabase | `relais-hub` — `uqusictqdviahnxpzylu` — région `eu-central-1` |
| Site en ligne | https://relais-app-wwk4.vercel.app |
| Code | https://github.com/Ludger001/relais-app |
| Dossier local | `C:\Users\Windows User\Projets\relais-app` |

---

## 5. Modèle d'habilitations (IAM)

C'est la partie la plus importante de ce document.

### Les trois rôles

| Rôle | Qui | Comment il l'obtient |
|---|---|---|
| `merchant` | E-commerçant | À l'inscription |
| `agency` | Agence de livraison | À l'inscription |
| `admin` | Équipe Relais | **Uniquement à la main, en base** |

Le déclencheur `handle_new_user` **refuse** le rôle `admin` demandé à
l'inscription. Le déclencheur `prevent_role_escalation` empêche un membre de
changer son propre rôle.

### Le principe directeur

> **Ne jamais dépendre uniquement de l'absence d'une règle RLS.**
> Quand un accès doit être impossible, le privilège SQL est retiré aussi.

Une policy oubliée est un trou. Un privilège retiré reste fermé même si
quelqu'un ajoute une policy par erreur plus tard.

### Écrans accessibles par rôle

| Écran | Marchand | Agence | Admin |
|---|:---:|:---:|:---:|
| Annuaire des agences | ✅ | ❌ | ✅ |
| Chat & commandes | ✅ | ✅ | ✅ |
| Mon agence (KYC) | ❌ | ✅ | ❌ |
| Point financier | ✅ | ✅ | ✅ |
| SuperAdmin | ❌ | ❌ | ✅ |

L'agence n'a **pas** l'annuaire : c'est l'outil du marchand qui cherche un
prestataire. Une agence n'a pas à y observer ses concurrentes.

### Droits par table

Les rôles `anon` (visiteur) et `authenticated` (membre connecté) sont ceux de
PostgreSQL. Le rôle métier (`merchant` / `agency` / `admin`) est lu dans
`profiles` par les fonctions d'identité.

| Table | Lecture | Écriture |
|---|---|---|
| `profiles` | soi-même, ou admin | soi-même, sauf le rôle |
| `agencies` | les certifiées + la sienne + admin | la sienne, sauf certification et note |
| `merchants` | soi-même + l'agence en conversation + admin | soi-même |
| `conversations` | les participants | création par le marchand uniquement |
| `messages` | les participants, **hors texte d'origine** | **personne** — fonction serveur seule |
| `messages_readable` | les participants | lecture seule |
| `orders` | les participants | création marchand ; statut agence ; conditions figées après ramassage |
| `order_status_logs` | les participants | **personne** — déclencheur seul |
| `financial_payouts` | les participants | **personne** — quatre fonctions dédiées |
| `payout_orders` | les participants | **personne** |
| `security_violations` | **admin seul** | **personne** — fonction serveur seule |
| `subscriptions` | soi-même | **personne** — webhook de paiement |
| `paiements` | soi-même + admin | **personne** — webhook de paiement |
| `plans_abonnement` | **tout le monde**, même sans compte | **personne** |
| `reviews` | tous les membres | après une livraison réussie seulement |

Le visiteur anonyme n'a **aucun** privilège sur les tables métier. Seule la
grille tarifaire lui est ouverte, parce que la page publique l'affiche.

### Fonctions d'identité

Utilisées par les policies. Elles ne révèlent jamais que l'identité de
l'appelant lui-même.

| Fonction | Renvoie |
|---|---|
| `current_profile_id()` | son propre identifiant de profil |
| `my_role()` | son rôle métier |
| `is_admin()` | est-il administrateur ? |
| `my_merchant_id()` | sa fiche marchand, ou `NULL` |
| `my_agency_id()` | sa fiche agence, ou `NULL` |
| `is_conversation_participant(id)` | participe-t-il à cette conversation ? |

> ⚠️ **Piège majeur.** `my_merchant_id()` renvoie `NULL` pour une agence. En SQL,
> `valeur <> NULL` vaut **INCONNU**, pas VRAI — un contrôle écrit ainsi ne se
> déclenche jamais pour l'autre rôle. Une agence a pu, à cause de cela, confirmer
> la réception des fonds à la place du marchand. **Toujours utiliser
> `IS DISTINCT FROM`** pour comparer un identifiant de rôle.

### Déclencheurs de protection

| Déclencheur | Empêche |
|---|---|
| `prevent_role_escalation` | de changer son propre rôle |
| `protect_agency_verification` | de se certifier ou de modifier sa note |
| `log_order_status_change` | qu'un autre que l'agence fasse évoluer la livraison ; consigne tout |
| `figer_conditions_commande` | de réécrire montants, frais, coordonnées après ramassage |
| `handle_new_user` | qu'on naisse administrateur |

Tous laissent passer le **contexte serveur** (`auth.uid() IS NULL`) : sans cela,
l'administration en SQL serait impossible. Une requête d'un membre connecté porte
toujours un `auth.uid()`, donc rien n'est relâché pour les utilisateurs.

### Dépôt des pièces KYC

Rangement : `pieces-kyc/<identifiant du compte>/<horodatage>-<nom>`.

Le premier segment du chemin sert de clé d'appartenance : chaque agence ne peut
déposer, lire et retirer que dans son propre dossier. L'administrateur lit
partout. Consultation par lien signé de 2 minutes.

---

## 6. Décisions de design

**Le bon de commande ne passe pas par le chat.** Le téléphone du client est
légitime mais le filtre l'aurait masqué. Il voyage donc par la table `orders`,
réservée aux deux participants. La carte affichée dans le fil est construite
depuis cette table.

**Le filtre existe en deux exemplaires.** Celui du navigateur prévient
l'utilisateur avant l'envoi ; celui du serveur décide. La copie serveur est
**générée**, jamais éditée, et un test échoue si les règles divergent — sinon
l'avertissement affiché mentirait.

**Le texte d'origine des messages est conservé mais illisible.** Il ne sert qu'à
instruire un litige. Même l'auteur du message ne peut pas le relire.

**Les totaux financiers sont calculés par la base.** Ni l'agence ni le marchand
ne les saisissent : c'est ce qui rend le chiffre opposable aux deux.

**Les conditions d'une commande sont figées au ramassage.** La correction avant
ramassage reste possible — un marchand qui s'est trompé de prix doit pouvoir se
reprendre.

**Les références sont générées par la base.** Deux marchands commandant au même
instant ne peuvent pas produire la même référence.

**Aucun framework dans le navigateur.** Le projet est petit et sans étape de
compilation : le fichier écrit est le fichier servi. Ajouter React ou un
empaqueteur coûterait plus qu'il ne rapporterait aujourd'hui.

**L'interface ne ment pas.** Un bouton ne dit pas « Payer 10 000 FCFA » s'il ne
prélève rien. Une zone vide dit pourquoi elle est vide. Un compteur affiche le
vrai nombre.

**La clé Supabase est publique, et c'est normal.** Elle est faite pour le
navigateur. Ce sont les règles de la base qui protègent les données, pas son
secret. La clé `service_role`, elle, ne doit **jamais** apparaître côté client.

---

## 7. Instructions

### Travailler en local

```bash
npm install              # une seule fois
npm run dev              # http://localhost:3000
```

### Tests

```bash
npm test                 # filtre, synchronisation, rôles, écrans vides
npm run test:responsive  # 6 pages × 8 modèles de téléphones
npm run test:chat        # le filtre serveur est-il contournable ?
npm run test:commande    # cycle complet d'une commande
npm run test:kyc         # parcours de certification
npm run test:reversement # double accusé de réception
```

Les tests navigateur acceptent une URL pour viser la production :

```bash
npm run test:responsive https://relais-app-wwk4.vercel.app
```

### Déployer

```bash
git add -A
git commit -m "…"
git push                 # Vercel redéploie automatiquement
```

### ⚠️ Après avoir modifié le filtre anti-désintermédiation

```bash
npm run filtre:generer   # régénère la copie serveur
```

**Puis redéployer la fonction `envoyer-message`.** Le test de synchronisation
compare les fichiers du dépôt — il ne voit pas la version déployée.

### Comptes de démonstration

| Rôle | E-mail | Mot de passe |
|---|---|---|
| E-commerçant | `marchand@demo.relais` | `RelaisDemo2026` |
| Agence | `agence@demo.relais` | `RelaisDemo2026` |
| Administrateur | `admin@demo.relais` | `RelaisDemo2026` |

**À supprimer avant toute ouverture au public.**

### Créer un administrateur

Impossible par l'inscription. Il faut insérer la ligne en base : voir la
migration `relais_stockage_pieces_kyc` pour le modèle de requête. Ne pas oublier
de remplir les colonnes texte de `auth.users` avec `''` et non `NULL`, sinon la
connexion échoue avec `Database error querying schema`.

---

## 8. Points futurs

### Bloquant avant l'ouverture

1. **Service d'envoi d'e-mails.** La confirmation d'adresse est désactivée depuis
   le 5 septembre 2026 : le service intégré de Supabase, limité à quelques envois
   par heure, bloquait toute inscription. Brancher Resend ou Brevo, puis
   réactiver « Confirm email ».
2. **Paiement en ligne.** Ouvrir un compte marchand FedaPay ou Kkiapay, brancher
   le webhook. La mécanique en base est prête.
3. **Suppression de compte.** Supprimer un profil ayant écrit des messages échoue
   aujourd'hui — c'est volontaire, pour préserver la piste d'audit. Il faut une
   procédure d'**anonymisation** avant toute ouverture.
4. **Mentions légales et CGU**, et un nom de domaine.

### Évolutions produit envisagées

**Un espace pour les closeurs.** Dans l'écosystème COD africain, le *closeur*
est celui qui appelle les prospects et transforme les intentions en commandes
confirmées. C'est un troisième métier, distinct de l'agence de livraison, et les
e-commerçants en cherchent autant que des livreurs.

Ce que cela impliquerait :
- un troisième rôle (`closer`) et un troisième abonnement,
- un annuaire de closeurs, visible des marchands,
- la même logique de certification et de chat filtré,
- une question à trancher : le closeur voit-il les coordonnées du prospect ?
  Probablement oui, puisque c'est son métier de l'appeler — donc le même
  mécanisme que le bon de commande, avec une fiche prospect structurée.

*Noté le 6 septembre 2026. À approfondir plus tard.*

### Améliorations techniques identifiées

- **Temps réel dans le chat.** Les messages ne se rafraîchissent qu'au
  chargement ; Supabase Realtime permettrait de les voir arriver.
- **Notation des agences.** La table `reviews` existe et sa policy autorise un
  avis après une livraison réussie, mais aucune interface ne la sert.
- **Six avertissements d'audit assumés.** Les fonctions d'identité sont
  appelables en RPC par les membres connectés. C'est nécessaire aux policies et
  sans risque — elles ne révèlent que l'appelant. Les déplacer dans un schéma non
  exposé supprimerait l'avertissement.
- **Pagination.** L'annuaire, le chat et le bordereau chargent tout. À revoir
  au-delà de quelques centaines de lignes.

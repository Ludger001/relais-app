# Relais

Réseau B2B fermé qui connecte des e-commerçants audités et des agences de livraison
COD (paiement à la livraison) vérifiées au **Bénin, Togo, Sénégal, Côte d'Ivoire et Gabon**.

Chat exclusif 1-to-1, passation d'ordres de livraison, réconciliation financière du cash
collecté, et bouclier anti-désintermédiation.

---

## État actuel

**Ce qui est réel :** les comptes, la connexion, les rôles, l'annuaire des agences, et
le chat — messages filtrés côté serveur, enregistrés en base, relus depuis la base.
L'application est fermée aux visiteurs et le rôle vient du profil, plus d'un bouton.

**Ce qui ne l'est pas encore :** le reversement des fonds (les deux boutons de
validation sont encore une simulation) et le paiement de l'abonnement.

La logique métier, elle, est juste : le bon de commande transmet les coordonnées du client
à l'agence, l'agence clôture ses livraisons, et le bilan se calcule sur la période choisie.

## Démarrer en local

```bash
npm install            # une seule fois, installe les outils
npm run dev            # lance le site sur http://localhost:3000

npm test               # filtre, synchronisation des deux copies, rôles, écrans vides
npm run test:responsive  # 6 pages × 8 formats de téléphones, dans un vrai navigateur
npm run test:chat        # le filtre serveur est-il contournable ? (navigateur réel)
npm run test:commande    # cycle complet d'une commande, marchand et agence
```

Les deux derniers acceptent une URL : `npm run test:responsive https://…` pour vérifier
la production plutôt que le local.

## Structure

```
public/                      Le site (c'est ce que Vercel met en ligne)
  index.html                 Page d'accueil publique
  connexion.html             Connexion, mot de passe oublié
  inscription-marchand.html  Inscription e-commerçant
  candidature-agence.html    Candidature agence de livraison
  app.html                   L'application (annuaire, chat, commandes, finance, admin)
  app.js                     Logique de l'application
  lib/supabaseClient.js      Connexion à Supabase, session, profil
  lib/inscription.js         Logique partagée des deux formulaires
  lib/antiBypassFilter.js    Filtre — côté navigateur, avertissement seul
  style.css / landing.css    Styles
  assets/                    Images

supabase/functions/          Fonction serveur : le filtre qui fait foi
scripts/                     Génération de la copie serveur du filtre
database/                    Schéma SQL réellement appliqué + notes de sécurité
tests/                       Filtre, rôles, écrans vides, responsive, chat
vercel.json                  Config de déploiement
```

## Le modèle en une phrase

Relais ne livre rien et n'emploie personne. C'est un **tiers de confiance** entre deux
clients payants : l'e-commerçant qui a des colis, et l'agence vérifiée qui les livre.
Le revenu vient des deux abonnements, pas d'une commission sur les livraisons.

Le vrai produit n'est pas le chat, c'est **la disparition d'Excel** : à la fin de sa
tournée, l'agence clôture ses commandes et le bilan (cash encaissé − frais de livraison
= net à reverser) se calcule tout seul, identique pour les deux parties.

La clé de voûte est le **bon de commande structuré** : le marchand ne tape jamais un
numéro dans la conversation, il remplit un formulaire. D'où la règle du filtre —
*contact du client final = autorisé* (c'est le métier), *contact entre marchand et
agence = interdit* (c'est la désintermédiation).

## Feuille de route

Principe : des **tranches verticales** (un parcours complet de bout en bout), pas des
couches horizontales (tous les écrans, puis la base). Ne jamais construire deux écrans
sur des données qui n'existent pas encore.

- [x] **Bloc 0** — Outillage (Node.js, Git)
- [x] **Bloc 1** — Mise en ligne sur Vercel → https://relais-app-wwk4.vercel.app
- [x] **Bloc 2** — Réparation des trous métier du prototype
- [x] **Bloc 3** — Supabase : schéma + règles RLS (voir [database/README.md](database/README.md))
- [x] **Bloc 4** — Parcours d'inscription réel (compte, connexion, accès protégé)
- [x] **Bloc 5** — Données réelles : annuaire, chat, commandes et bilan financier
- [ ] **Bloc 6** — Tableau de bord agence + validation KYC
- [x] **Bloc 7** — Filtre anti-désintermédiation côté serveur (remonté avant le Bloc 5)
- [ ] **Bloc 8** — Paiement réel (FedaPay / Kkiapay) et abonnements
- [ ] **Bloc 9** — Admin, domaine, mise en production

### 🔴 Engagement à ne pas oublier : le service d'e-mails

La confirmation d'adresse e-mail est **désactivée** sur `relais-hub` depuis le
2026-09-05, pour pouvoir développer. Le service d'envoi intégré de Supabase est
limité à quelques messages par heure : il bloquait toute inscription.

**Avant la moindre ouverture à de vrais clients, il faut :**

1. Brancher un service d'envoi (Resend ou Brevo, gratuits jusqu'à ~3 000 messages/mois)
   dans Supabase → Project Settings → Authentication → SMTP Settings
2. Réactiver **Confirm email** (Authentication → Sign In / Providers → Email)
3. Vérifier qu'un compte créé depuis le formulaire reçoit bien son lien

Sans ça, n'importe qui peut s'inscrire avec l'adresse e-mail d'un tiers, et
« mot de passe oublié » ne fonctionne pour personne.

## Le bouclier anti-désintermédiation

C'est le cœur du modèle : si marchand et agence s'échangent leurs numéros, ils
contournent Relais et le revenu disparaît. La protection tient en trois pièces :

1. **Le navigateur n'a pas le droit d'écrire dans `messages`.** Le privilège INSERT
   a été retiré au rôle `authenticated`. Aucune ligne ne peut y entrer autrement.
2. **La fonction serveur `envoyer-message` est le seul chemin.** Elle vérifie le
   jeton, confirme que l'expéditeur participe bien à la conversation, filtre, puis
   écrit avec la clé de service.
3. **Le texte d'origine est illisible pour tous les clients.** `original_content`
   n'est accessible à personne d'autre qu'un administrateur : il sert uniquement à
   instruire un litige.

Le filtre du navigateur reste, mais il ne décide de rien : il prévient l'utilisateur
avant l'aller-retour réseau. `npm test` vérifie que les deux copies portent bien les
mêmes règles — sinon l'avertissement affiché mentirait.

⚠️ **Après toute modification de `public/lib/antiBypassFilter.js`** : lancer
`npm run filtre:generer`, puis **redéployer** la fonction `envoyer-message`. Le test
de synchronisation compare les fichiers du dépôt, il ne voit pas la version déployée.

## Points d'attention connus

1. **Le paiement de l'abonnement n'existe pas.** L'inscription crée un compte, sans
   aucun prélèvement. Bloc 8.
2. **Une agence dépose son dossier mais ne peut pas encore envoyer ses pièces KYC.**
   Elle reste invisible dans l'annuaire jusqu'à validation manuelle en base. Bloc 6.
3. **Le point financier ne génère pas encore de reversement.** Les boutons « Virement
   effectué » et « Fonds reçus » affichent une simulation ; la table `financial_payouts`
   existe mais n'est pas alimentée. Bloc 8.
4. **Suppression de compte impossible en l'état** — voir [database/README.md](database/README.md).
5. **Comptes de démonstration à supprimer avant l'ouverture** : `marchand@demo.relais`
   et `agence@demo.relais`.

# Relais

Réseau B2B fermé qui connecte des e-commerçants audités et des agences de livraison
COD (paiement à la livraison) vérifiées au **Bénin, Togo, Sénégal, Côte d'Ivoire et Gabon**.

Chat exclusif 1-to-1, passation d'ordres de livraison, réconciliation financière du cash
collecté, et bouclier anti-désintermédiation.

---

## État actuel

**Ce qui est réel :** les comptes, la connexion, les rôles, et l'annuaire des agences.
L'application est fermée aux visiteurs et le rôle vient du profil en base, plus d'un
bouton. Les règles de sécurité sont écrites et testées.

**Ce qui ne l'est pas encore :** le chat, les commandes et le bilan financier sont vides
en attendant d'être branchés. Le paiement de l'abonnement est simulé.

La logique métier, elle, est juste : le bon de commande transmet les coordonnées du client
à l'agence, l'agence clôture ses livraisons, et le bilan se calcule sur la période choisie.

## Démarrer en local

```bash
npm install     # une seule fois, installe les outils
npm run dev     # lance le site sur http://localhost:3000
npm test        # vérifie le filtre anti-désintermédiation
```

## Structure

```
public/                      Le site (c'est ce que Vercel met en ligne)
  index.html                 Page d'accueil publique
  app.html                   L'application (annuaire, chat, commandes, finance, admin)
  inscription-marchand.html  Inscription e-commerçant
  candidature-agence.html    Candidature agence de livraison
  app.js                     Logique de l'application
  lib/supabaseClient.js      Connexion à Supabase, session, profil
  lib/inscription.js         Logique partagée des deux formulaires
  connexion.html             Connexion, mot de passe oublié
  style.css / landing.css    Styles
  lib/antiBypassFilter.js    Filtre anti-désintermédiation (avertissement seul)

supabase/functions/          Fonction serveur : le filtre qui fait foi
scripts/                     Génération de la copie serveur du filtre
  assets/                    Images

database/                    Schéma SQL réellement appliqué + notes de sécurité
tests/testAntiBypass.js      Tests du filtre
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
- [~] **Bloc 5** — Données réelles : annuaire et chat branchés, bilan à suivre
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
4. **Une agence dépose son dossier mais ne peut pas encore envoyer ses pièces KYC.**
   Elle reste donc invisible dans l'annuaire jusqu'à validation manuelle. Bloc 6.
5. **L'annuaire lit la vraie base ; le chat, les commandes et le bilan sont encore
   vides.** Envoyer un message est volontairement impossible tant que le filtre ne
   tourne pas côté serveur (Bloc 7) : le privilège d'écriture sur `messages` est retiré.
6. **Suppression de compte impossible en l'état** — voir [database/README.md](database/README.md).
7. **Comptes de démonstration à supprimer avant l'ouverture** : `marchand@demo.relais`
   et `agence@demo.relais`.

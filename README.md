# Relais

Réseau B2B fermé qui connecte des e-commerçants audités et des agences de livraison
COD (paiement à la livraison) vérifiées au **Bénin, Togo, Sénégal, Côte d'Ivoire et Gabon**.

Chat exclusif 1-to-1, passation d'ordres de livraison, réconciliation financière du cash
collecté, et bouclier anti-désintermédiation.

---

## État actuel : prototype front-end

⚠️ **Rien n'est encore connecté à une vraie base de données.** L'interface fonctionne avec
des données simulées écrites en dur dans `public/app.js`. Le paiement est simulé. Il n'y a
pas encore de comptes utilisateurs — le sélecteur de rôle en haut fait semblant.

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
  app.js                     Toute la logique + les données simulées
  style.css / landing.css    Styles
  lib/antiBypassFilter.js    Filtre anti-désintermédiation
  assets/                    Images

database/schema.sql          Schéma PostgreSQL / Supabase (13 tables) — pas encore exécuté
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
- [ ] **Bloc 3** — Supabase : schéma + règles RLS + comptes
- [ ] **Bloc 4** — Parcours d'inscription réel (tarif → formulaire → compte → rôle)
- [ ] **Bloc 5** — Tableau de bord marchand sur vraies données
- [ ] **Bloc 6** — Tableau de bord agence + validation KYC
- [ ] **Bloc 7** — Filtre anti-désintermédiation côté serveur
- [ ] **Bloc 8** — Paiement réel (FedaPay / Kkiapay) et abonnements
- [ ] **Bloc 9** — Admin, domaine, e-mails, mise en production

## Points d'attention connus

1. **Le filtre anti-désintermédiation tourne dans le navigateur** — donc contournable.
   C'est le cœur du modèle économique : il devra tourner côté serveur (Bloc 7).
   Le journal de sécurité affiche « Masqué côté serveur », ce qui est faux aujourd'hui.
2. **Le filtre détecte les chiffres écrits en toutes lettres mais ne les masque pas.**
   Le test « numéro en lettres » passe uniquement parce que le mot « contact » est
   repéré. À reprendre au Bloc 7.
3. **`database/schema.sql` n'a aucune règle RLS.** Sans elles, sur Supabase, chaque
   utilisateur pourrait lire les conversations de tous les autres. Bloc 3.
4. **Aucun des deux formulaires d'inscription ne demande de mot de passe** — impossible
   de se reconnecter. À traiter au Bloc 4.
5. **Le paiement de l'abonnement est factice** (`setTimeout` + `alert`). Bloc 8.

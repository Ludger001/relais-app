# Relais

Réseau B2B fermé qui connecte des e-commerçants audités et des agences de livraison
COD (paiement à la livraison) vérifiées au **Bénin, Togo, Sénégal, Côte d'Ivoire et Gabon**.

Chat exclusif 1-to-1, passation d'ordres de livraison, réconciliation financière du cash
collecté, et bouclier anti-désintermédiation.

---

## État actuel : prototype front-end

⚠️ **Rien n'est encore connecté à une vraie base de données.** L'interface fonctionne avec
des données simulées écrites en dur dans `public/app.js`. Le paiement est simulé. Il n'y a
pas encore de comptes utilisateurs.

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

## Feuille de route

- [x] **Phase 0** — Outillage (Node.js, Git)
- [ ] **Phase 1** — Mise en ligne de la maquette sur Vercel
- [ ] **Phase 2** — Base de données Supabase + règles de sécurité RLS
- [ ] **Phase 3** — Comptes utilisateurs (inscription, connexion, rôles)
- [ ] **Phase 4** — Brancher l'interface sur les vraies données
- [ ] **Phase 5** — Passer le filtre anti-désintermédiation côté serveur
- [ ] **Phase 6** — Vrai paiement (FedaPay / Kkiapay) et abonnements
- [ ] **Phase 7** — KYC et validation des agences par l'admin
- [ ] **Phase 8** — Mise en production (domaine, e-mails, mentions légales)

## Points d'attention connus

1. **Le filtre anti-désintermédiation tourne dans le navigateur** — donc contournable.
   C'est le cœur du modèle économique : il devra impérativement tourner côté serveur (Phase 5).
2. **`database/schema.sql` n'a aucune règle RLS.** Sans elles, sur Supabase, chaque
   utilisateur pourrait lire les conversations de tous les autres. À écrire en Phase 2.
3. **Le paiement de l'abonnement est factice** (`setTimeout` + `alert`). Phase 6.

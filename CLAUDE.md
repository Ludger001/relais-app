# Relais — repères pour travailler sur ce projet

**Lire `DOCUMENTATION.md` en premier.** Il contient le modèle métier, la structure,
le modèle d'habilitations complet et les décisions de design.

## Ce qu'il ne faut jamais casser

**Le filtre anti-désintermédiation est le modèle économique.** Si marchand et
agence échangent leurs numéros, ils contournent Relais et le revenu disparaît.
Le navigateur n'a pas le droit d'écrire dans `messages` : la fonction serveur
`envoyer-message` est le seul chemin. Ne jamais rendre ce droit au client.

**Le contact du client final est autorisé, le contact entre les deux parties ne
l'est pas.** Le téléphone du destinataire voyage par la table `orders`, jamais
par un message — sinon le filtre le masquerait alors que l'agence en a besoin.

**Les chiffres financiers sont calculés par la base.** Ni l'agence ni le marchand
ne les saisissent. C'est ce qui les rend opposables aux deux.

## Règles de travail

**TOUT DOIT ÊTRE UTILISABLE SUR TÉLÉPHONE.** Les clients de Relais — marchands
et agences en Afrique de l'Ouest et Centrale — travaillent au téléphone. Un
écran inutilisable sur mobile est un écran inutilisable. Aucun écran n'est fini
tant qu'il n'a pas été **vu** sur un format de téléphone.

⚠️ `npm run test:responsive` ne mesure que le **débordement horizontal** et la
taille du texte. Il est passé au vert sur 184 contrôles pendant que le chat
était inutilisable au doigt. Un test vert n'est pas une preuve. Il faut :

1. capturer chaque écran modifié à **320, 360, 390 et 430 px**, et le regarder ;
2. vérifier les cibles tactiles (≥ 44 px), le texte qui s'empile, les
   chevauchements, et que l'action principale est atteignable sans défiler ;
3. lancer `npm run test:tactile` en plus de `test:responsive`.


**Ne jamais dépendre uniquement de l'absence d'une policy RLS.** Quand un accès
doit être impossible, retirer aussi le privilège SQL.

**Comparer les identifiants de rôle avec `IS DISTINCT FROM`.** `my_merchant_id()`
renvoie `NULL` pour une agence ; `valeur <> NULL` vaut INCONNU et ne déclenche
jamais le contrôle. Cette erreur a déjà laissé une agence signer à la place d'un
marchand.

**Après avoir modifié `public/lib/antiBypassFilter.js`** : `npm run filtre:generer`
puis **redéployer la fonction `envoyer-message`**. Le test de synchronisation ne
voit pas la version déployée.

**L'interface ne ment pas.** Pas de bouton « Payer » qui ne prélève rien, pas de
compteur écrit en dur, pas de zone vide sans explication.

## Vérifier avant de pousser

```bash
npm test                 # filtre, synchronisation, rôles, écrans vides
npm run test:responsive  # 8 modèles de téléphones
npm run test:chat        # contournement du filtre serveur
npm run test:commande    # cycle d'une commande
npm run test:kyc         # certification d'une agence
npm run test:reversement # double accusé de réception
```

Les tests navigateur acceptent une URL pour viser la production.

## Environnement

- Base : Supabase `relais-hub` (`uqusictqdviahnxpzylu`, `eu-central-1`)
- Site : https://relais-app-wwk4.vercel.app — redéployé à chaque `git push`
- Comptes de démo : `marchand@`, `agence@`, `admin@demo.relais` / `RelaisDemo2026`
- La clé Supabase visible dans le code est **publique** et doit l'être. La clé
  `service_role` ne doit jamais apparaître côté navigateur.

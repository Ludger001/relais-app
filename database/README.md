# Base de données

Projet Supabase : **`relais-hub`** — région `eu-central-1` (Francfort), PostgreSQL 17.6.

Les deux fichiers de ce dossier sont le SQL réellement appliqué, dans l'ordre :

| Fichier | Contenu |
|---|---|
| `01_schema.sql` | 12 tables, 9 types énumérés, 14 index |
| `02_securite.sql` | fonctions d'identité, RLS, triggers, retrait des privilèges |

## La règle de sécurité du projet

**Ne jamais dépendre uniquement de l'absence d'une policy RLS.** Quand un accès doit
être impossible, on retire *aussi* le privilège SQL. Une policy oubliée est un trou ;
un privilège retiré reste fermé même si quelqu'un ajoute une policy par erreur.

## Ce qui est garanti, et vérifié

Testé le 2026-09-05 en se faisant réellement passer pour deux marchands distincts :

- Un marchand ne voit **que** sa conversation, ses messages, ses commandes, son profil
- `messages.original_content` (le message avant masquage) est **illisible** pour tout
  le monde, y compris pour les participants légitimes de la conversation
- **Personne ne peut écrire directement dans `messages`** : le privilège INSERT est
  retiré. Le seul chemin sera la fonction serveur de filtrage (Bloc 7)
- Un membre ne peut pas se promouvoir administrateur
- Une agence ne peut ni se certifier, ni modifier sa propre note
- Le visiteur anonyme n'a aucun privilège sur les tables métier
- L'historique des statuts et le journal des violations ne sont pas falsifiables
- On ne supprime ni commande, ni avis, ni agence : les traces restent opposables

## Avertissements connus et acceptés

L'audit Supabase signale 6 fonctions `SECURITY DEFINER` appelables par les membres
connectés (`current_profile_id`, `my_role`, `is_admin`, `my_merchant_id`,
`my_agency_id`, `is_conversation_participant`). C'est **volontaire** : les policies RLS
en ont besoin. Chacune ne renvoie que l'identité de l'appelant lui-même — elles ne
révèlent rien sur les autres membres. Pour supprimer l'avertissement il faudrait les
déplacer dans un schéma non exposé par l'API ; à envisager plus tard.

## Point à traiter : la suppression d'un compte

`messages.sender_id` et `order_status_logs.changed_by` référencent `profiles` **sans**
`ON DELETE CASCADE`. Supprimer un profil qui a écrit des messages échoue donc.

C'est le bon comportement pour une piste d'audit — on ne veut pas qu'un litige
s'évapore parce qu'une partie a fermé son compte. Mais il faudra une vraie procédure
de suppression de compte (anonymisation plutôt qu'effacement) avant la mise en
production, pour les obligations de protection des données.

## Rejouer ce schéma sur une base neuve

Dans le SQL Editor de Supabase, exécuter `01_schema.sql` puis `02_securite.sql`.

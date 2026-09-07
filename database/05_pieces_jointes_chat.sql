-- =============================================================================
-- RELAIS — PIECES JOINTES DU CHAT
--
-- Applique le 2026-09-06 sur le projet Supabase "relais-hub" :
--   relais_pieces_jointes_chat
--
-- Le metier en a besoin : photo du colis abime, preuve de livraison, capture du
-- virement. Le depot est PRIVE : aucune adresse permanente, on passe par des
-- liens signes de courte duree, comme pour les pieces KYC.
--
-- Le chemin porte l'identifiant de la conversation en PREMIER segment :
--     <conversation_id>/<nom du fichier>
-- C'est ce qui permet aux regles ci-dessous de verifier que le demandeur est
-- bien l'un des deux participants — la meme fonction que pour les messages. La
-- fonction serveur envoyer-message revérifie ce prefixe avant d'attacher le
-- fichier : sans ce controle, un participant pourrait rattacher a son message
-- le fichier d'une conversation ou il n'est pas.
--
-- Pas de video ni de son. Une note vocale est un canal de contournement
-- parfait — on peut y dicter un numero — et rien ne sait la filtrer aujourd'hui.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pieces-chat', 'pieces-chat', FALSE, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = FALSE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "chat_pieces_lecture_participants" ON storage.objects;
DROP POLICY IF EXISTS "chat_pieces_depot_participants"   ON storage.objects;

-- Lire : seulement les deux participants de la conversation.
CREATE POLICY "chat_pieces_lecture_participants"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'pieces-chat'
  AND public.is_conversation_participant((storage.foldername(name))[1]::uuid)
);

-- Deposer : meme regle. Le premier segment du chemin doit designer une
-- conversation a laquelle on appartient, sinon rien ne s'ecrit.
CREATE POLICY "chat_pieces_depot_participants"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'pieces-chat'
  AND public.is_conversation_participant((storage.foldername(name))[1]::uuid)
);

-- Aucune regle UPDATE ni DELETE, volontairement : une piece jointe fait partie
-- d'un historique commercial qui engage deux parties. Aucune ne peut la retirer
-- seule apres coup, pas plus qu'elle ne peut effacer une commande livree.
-- tests/testPiecesJointes.js verifie cette propriete.

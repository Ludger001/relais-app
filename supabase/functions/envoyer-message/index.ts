/**
 * =============================================================================
 * RELAIS — ENVOI D'UN MESSAGE (POINT DE PASSAGE UNIQUE)
 * =============================================================================
 *
 * Le droit d'écrire dans la table `messages` a été retiré au rôle
 * `authenticated` (voir database/02_securite.sql). Aucun navigateur ne peut
 * donc insérer un message directement : ce chemin-ci est le seul.
 *
 * C'est ce qui rend le bouclier anti-désintermédiation réel. Le filtre du
 * navigateur ne sert qu'à prévenir l'utilisateur avant l'envoi ; celui-ci
 * fait foi, et personne ne peut le contourner en ouvrant la console.
 *
 * Le message brut est conservé dans `original_content` — colonne illisible
 * pour tous les rôles clients — afin de pouvoir instruire un litige.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { inspectAndSanitizeMessage } from './filtre.js';

const enTetesCors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function reponse(corps: unknown, statut = 200) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...enTetesCors, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (requete) => {
  if (requete.method === 'OPTIONS') {
    return new Response('ok', { headers: enTetesCors });
  }
  if (requete.method !== 'POST') {
    return reponse({ erreur: 'Méthode non autorisée.' }, 405);
  }

  const urlSupabase = Deno.env.get('SUPABASE_URL')!;
  const cleService  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const cleAnon     = Deno.env.get('SUPABASE_ANON_KEY')!;

  // 1. QUI PARLE ? On ne fait jamais confiance à un identifiant envoyé par le
  //    client : on lit l'utilisateur depuis son jeton, vérifié par Supabase.
  const entete = requete.headers.get('Authorization') ?? '';
  if (!entete.startsWith('Bearer ')) {
    return reponse({ erreur: 'Authentification requise.' }, 401);
  }

  const clientAppelant = createClient(urlSupabase, cleAnon, {
    global: { headers: { Authorization: entete } }
  });

  const { data: auth, error: erreurAuth } = await clientAppelant.auth.getUser();
  if (erreurAuth || !auth?.user) {
    return reponse({ erreur: 'Session invalide ou expirée.' }, 401);
  }

  // 2. CE QU'IL ENVOIE
  let charge: { conversation_id?: string; content?: string };
  try {
    charge = await requete.json();
  } catch {
    return reponse({ erreur: 'Corps de requête illisible.' }, 400);
  }

  const conversationId = (charge.conversation_id ?? '').trim();
  const contenu = (charge.content ?? '').trim();

  if (!conversationId || !contenu) {
    return reponse({ erreur: 'conversation_id et content sont obligatoires.' }, 400);
  }
  if (contenu.length > 4000) {
    return reponse({ erreur: 'Message trop long (4000 caractères maximum).' }, 400);
  }

  // 3. A-T-IL LE DROIT D'ÉCRIRE ICI ?
  //    Le client service_role ignore les règles RLS : on vérifie donc
  //    l'appartenance à la conversation nous-mêmes, explicitement.
  const admin = createClient(urlSupabase, cleService);

  const { data: profil, error: erreurProfil } = await admin
    .from('profiles')
    .select('id, role, is_active')
    .eq('auth_user_id', auth.user.id)
    .maybeSingle();

  if (erreurProfil || !profil) {
    return reponse({ erreur: "Aucun profil Relais rattaché à ce compte." }, 403);
  }
  if (!profil.is_active) {
    return reponse({ erreur: 'Ce compte est désactivé.' }, 403);
  }

  const { data: conversation, error: erreurConv } = await admin
    .from('conversations')
    .select('id, is_blocked, merchant_id, agency_id, merchants!inner(profile_id), agencies!inner(profile_id)')
    .eq('id', conversationId)
    .maybeSingle();

  if (erreurConv || !conversation) {
    return reponse({ erreur: 'Conversation introuvable.' }, 404);
  }

  const profilMarchand = (conversation as any).merchants?.profile_id;
  const profilAgence   = (conversation as any).agencies?.profile_id;
  const estParticipant = profil.id === profilMarchand || profil.id === profilAgence;

  if (!estParticipant) {
    return reponse({ erreur: "Vous ne participez pas à cette conversation." }, 403);
  }
  if (conversation.is_blocked) {
    return reponse({ erreur: 'Cette conversation est bloquée.' }, 403);
  }

  // 4. LE FILTRE — le vrai, celui qu'on ne peut pas contourner
  const inspection = inspectAndSanitizeMessage(contenu);

  // 5. ENREGISTREMENT
  const { data: message, error: erreurInsertion } = await admin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: profil.id,
      original_content: contenu,
      filtered_content: inspection.cleanText,
      has_contact_leak_attempt: inspection.isBlocked
    })
    .select('id, conversation_id, sender_id, filtered_content, has_contact_leak_attempt, created_at')
    .single();

  if (erreurInsertion) {
    console.error('[Relais] Insertion du message impossible :', erreurInsertion.message);
    return reponse({ erreur: "Le message n'a pas pu être enregistré." }, 500);
  }

  await admin
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  // 6. TRACE DE LA TENTATIVE, pour l'espace d'administration
  if (inspection.isBlocked) {
    const { error: erreurTrace } = await admin.from('security_violations').insert({
      user_id: profil.id,
      conversation_id: conversationId,
      detected_pattern: (inspection.violations[0] ?? 'Coordonnées détectées').slice(0, 100),
      attempted_content: contenu,
      action_taken: 'masked_and_warned'
    });
    // Une trace manquante ne doit pas empêcher la conversation d'avancer
    if (erreurTrace) console.error('[Relais] Trace non enregistrée :', erreurTrace.message);
  }

  return reponse({
    message,
    filtre: {
      bloque: inspection.isBlocked,
      violations: inspection.violations
    }
  });
});

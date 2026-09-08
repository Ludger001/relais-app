/**
 * =============================================================================
 * RELAIS — DÉMARRER LE PAIEMENT D'UN ABONNEMENT
 * =============================================================================
 *
 * Le navigateur ne parle jamais à Moneroo. Il demande un forfait, et reçoit en
 * retour une adresse de paiement. La clé secrète du prestataire vit dans les
 * secrets Supabase et ne quitte jamais ce fichier — la mettre côté client
 * reviendrait à laisser n'importe qui émettre des paiements en notre nom.
 *
 * LE MONTANT NE VIENT PAS DU CLIENT
 * ---------------------------------
 * `demarrer_paiement_abonnement()` lit le prix dans `plans_abonnement` et crée
 * la ligne de paiement. Si le prix venait du navigateur, il suffirait de
 * modifier la requête pour payer 100 FCFA un abonnement à 25 000.
 *
 * Ce qui active réellement l'abonnement, c'est le webhook — pas cette
 * fonction. Ici on ne fait qu'ouvrir la porte ; personne n'est abonné tant que
 * Moneroo n'a pas confirmé.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

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
  if (requete.method === 'OPTIONS') return new Response('ok', { headers: enTetesCors });
  if (requete.method !== 'POST') return reponse({ erreur: 'Méthode non autorisée.' }, 405);

  const urlSupabase = Deno.env.get('SUPABASE_URL')!;
  const cleService  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const cleAnon     = Deno.env.get('SUPABASE_ANON_KEY')!;
  const cleMoneroo  = Deno.env.get('MONEROO_SECRET_KEY');
  const siteUrl     = Deno.env.get('RELAIS_SITE_URL') ?? 'https://relais-app-wwk4.vercel.app';

  // 1. QUI PAIE ? On lit l'utilisateur depuis son jeton, jamais depuis le corps.
  //    On authentifie AVANT de regarder notre configuration : un appelant
  //    inconnu n'a pas à apprendre que la clé du prestataire nous manque.
  const entete = requete.headers.get('Authorization') ?? '';
  if (!entete.startsWith('Bearer ')) return reponse({ erreur: 'Authentification requise.' }, 401);

  const clientAppelant = createClient(urlSupabase, cleAnon, {
    global: { headers: { Authorization: entete } }
  });
  const { data: auth, error: erreurAuth } = await clientAppelant.auth.getUser();
  if (erreurAuth || !auth?.user) return reponse({ erreur: 'Session invalide ou expirée.' }, 401);

  if (!cleMoneroo) {
    console.error('[Relais] MONEROO_SECRET_KEY absente.');
    return reponse({ erreur: "Le paiement n'est pas encore configuré." }, 503);
  }

  // 2. QUEL FORFAIT ?
  let charge: { plan_code?: string };
  try { charge = await requete.json(); }
  catch { return reponse({ erreur: 'Corps de requête illisible.' }, 400); }

  const planCode = (charge.plan_code ?? '').trim();
  if (!planCode) return reponse({ erreur: 'Aucun forfait demandé.' }, 400);

  // 3. LA BASE DÉCIDE DU PRIX, ET ÉMET LA RÉFÉRENCE
  //    On passe par le jeton de l'appelant : la fonction s'appuie sur
  //    current_profile_id(), qui ne connaît que l'utilisateur connecté.
  const { data: ouverture, error: erreurOuverture } = await clientAppelant
    .rpc('demarrer_paiement_abonnement', { p_plan_code: planCode });

  if (erreurOuverture) {
    console.error('[Relais] Ouverture de paiement refusée :', erreurOuverture.message);
    return reponse({ erreur: erreurOuverture.message }, 400);
  }

  const paiement = Array.isArray(ouverture) ? ouverture[0] : ouverture;
  if (!paiement?.reference_interne) {
    return reponse({ erreur: "Le paiement n'a pas pu être préparé." }, 500);
  }

  // 4. LE PROFIL, POUR RENSEIGNER LE CLIENT CHEZ MONEROO
  const admin = createClient(urlSupabase, cleService);
  const { data: profil } = await admin
    .from('profiles')
    .select('full_name, email')
    .eq('auth_user_id', auth.user.id)
    .maybeSingle();

  const nomComplet = (profil?.full_name ?? '').trim().split(/\s+/);
  const prenom = nomComplet[0] || 'Client';
  const nom    = nomComplet.slice(1).join(' ') || 'Relais';

  // 5. MONEROO
  //    La référence interne voyage dans `metadata` : c'est elle qui nous
  //    permettra de rapprocher le webhook du paiement, sans dépendre d'un
  //    identifiant que nous ne maîtrisons pas.
  let reponseMoneroo: Response;
  try {
    reponseMoneroo = await fetch('https://api.moneroo.io/v1/payments/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cleMoneroo}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        amount: Number(paiement.montant),
        currency: 'XOF',              // le FCFA de l'UEMOA, code ISO 4217
        description: `Relais — ${paiement.libelle} (30 jours)`,
        customer: {
          email: profil?.email ?? auth.user.email,
          first_name: prenom,
          last_name: nom
        },
        return_url: `${siteUrl}/app.html?paiement=${encodeURIComponent(paiement.reference_interne)}`,
        metadata: { reference_interne: paiement.reference_interne }
      })
    });
  } catch (e) {
    console.error('[Relais] Moneroo injoignable :', (e as Error).message);
    return reponse({ erreur: 'Le service de paiement est momentanément injoignable.' }, 502);
  }

  const corpsMoneroo = await reponseMoneroo.json().catch(() => null);

  if (!reponseMoneroo.ok || !corpsMoneroo?.data?.checkout_url) {
    console.error('[Relais] Moneroo a refusé :', reponseMoneroo.status, JSON.stringify(corpsMoneroo));
    await admin.from('paiements')
      .update({
        statut: 'echoue',
        motif_echec: `Moneroo ${reponseMoneroo.status}`,
        provider_raw: corpsMoneroo,
        updated_at: new Date().toISOString()
      })
      .eq('reference_interne', paiement.reference_interne);
    return reponse({ erreur: "Le paiement n'a pas pu être ouvert. Réessayez dans un instant." }, 502);
  }

  // 6. ON GARDE LA TRACE, puis on renvoie l'adresse de paiement
  await admin.from('paiements')
    .update({
      reference_externe: corpsMoneroo.data.id,
      url_paiement: corpsMoneroo.data.checkout_url,
      operateur: 'moneroo',
      provider_raw: corpsMoneroo,
      updated_at: new Date().toISOString()
    })
    .eq('reference_interne', paiement.reference_interne);

  return reponse({
    reference: paiement.reference_interne,
    montant: Number(paiement.montant),
    devise: paiement.devise,
    libelle: paiement.libelle,
    url_paiement: corpsMoneroo.data.checkout_url
  });
});

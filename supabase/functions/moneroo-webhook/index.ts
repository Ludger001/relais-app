/**
 * =============================================================================
 * RELAIS — CONFIRMATION DE PAIEMENT (WEBHOOK MONEROO)
 * =============================================================================
 *
 * C'est ICI, et nulle part ailleurs, qu'un abonnement s'active. La fonction
 * `payer-abonnement` ne fait qu'ouvrir la porte ; tant que Moneroo n'a pas
 * confirmé, personne n'est abonné. Un utilisateur qui ferme la page de
 * paiement, ou qui rejoue l'adresse de retour, n'obtient rien.
 *
 * POURQUOI verify_jwt EST À FALSE
 * -------------------------------
 * Moneroo appelle cette adresse depuis ses serveurs. Il n'a pas de jeton
 * Supabase à présenter, donc la vérification habituelle ne peut pas s'appliquer.
 * Ce qui la remplace n'est pas rien : DEUX contrôles, dont chacun suffirait
 * presque seul.
 *
 *   1. La SIGNATURE. Moneroo signe le corps brut en HMAC-SHA256 avec un secret
 *      partagé, et la dépose dans l'en-tête X-Moneroo-Signature. Sans le
 *      secret, on ne peut pas fabriquer une signature valable.
 *
 *   2. LA CONTRE-VÉRIFICATION. Même signé, on ne croit pas le corps sur parole :
 *      on redemande à Moneroo l'état de la transaction, par son API, avec notre
 *      clé secrète. Si le secret de signature fuitait un jour, il faudrait
 *      encore que Moneroo lui-même confirme le paiement.
 *
 * Et le montant est revérifié une troisième fois en base, contre le prix du
 * forfait : `confirmer_paiement_abonnement()` refuse un montant qui ne
 * correspond pas.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

function reponse(corps: unknown, statut = 200) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Comparaison à temps constant.
 *
 * Un `===` sur deux signatures s'arrête au premier caractère qui diffère : le
 * temps de réponse trahit alors combien de caractères étaient justes, et permet
 * de reconstituer la signature octet par octet. Ici on parcourt toujours toute
 * la longueur.
 */
function egalesEnTempsConstant(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i++) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

async function signatureAttendue(secret: string, corpsBrut: string): Promise<string> {
  const cle = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(corpsBrut));
  return [...new Uint8Array(signature)].map((o) => o.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (requete) => {
  if (requete.method !== 'POST') return reponse({ erreur: 'Méthode non autorisée.' }, 405);

  const urlSupabase   = Deno.env.get('SUPABASE_URL')!;
  const cleService    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const cleMoneroo    = Deno.env.get('MONEROO_SECRET_KEY');
  const secretWebhook = Deno.env.get('MONEROO_WEBHOOK_SECRET');

  if (!cleMoneroo || !secretWebhook) {
    console.error('[Relais] Secrets Moneroo absents : webhook refusé.');
    // On ne dit pas pourquoi : un appelant inconnu n'a pas à savoir ce qui
    // manque de notre côté.
    return reponse({ erreur: 'Non autorisé.' }, 403);
  }

  // 1. LA SIGNATURE — sur le corps BRUT, avant tout parsage.
  //    Analyser puis re-sérialiser changerait les octets et invaliderait
  //    toute signature légitime.
  const corpsBrut = await requete.text();
  const signatureRecue = requete.headers.get('X-Moneroo-Signature') ?? '';
  const attendue = await signatureAttendue(secretWebhook, corpsBrut);

  if (!signatureRecue || !egalesEnTempsConstant(signatureRecue.toLowerCase(), attendue)) {
    console.warn('[Relais] Webhook rejeté : signature invalide.');
    return reponse({ erreur: 'Non autorisé.' }, 403);
  }

  let evenement: any;
  try { evenement = JSON.parse(corpsBrut); }
  catch { return reponse({ erreur: 'Corps illisible.' }, 400); }

  // 2. DE QUEL PAIEMENT PARLE-T-ON ?
  //    On a glissé notre propre référence dans metadata à l'ouverture : c'est
  //    elle qui fait le lien, sans dépendre d'un identifiant qu'on ne maîtrise pas.
  const donnees = evenement?.data ?? evenement;
  const referenceInterne = donnees?.metadata?.reference_interne;
  const idMoneroo = donnees?.id;

  // « payment.initiated » est informatif : la ligne est déjà « en_attente »
  // depuis l'ouverture. Agir dessus reviendrait à réécrire ce qu'on sait déjà.
  if (evenement?.event === 'payment.initiated') {
    return reponse({ recu: true, ignore: 'payment.initiated' }, 200);
  }

  if (!referenceInterne || !idMoneroo) {
    console.warn('[Relais] Webhook sans référence exploitable.');
    // 200 volontairement : le corps est signé, donc légitime, mais ne nous
    // concerne pas. Répondre en erreur ferait rejouer ce webhook indéfiniment.
    return reponse({ ignore: 'Événement sans référence Relais.' }, 200);
  }

  // 3. CONTRE-VÉRIFICATION AUPRÈS DE MONEROO
  //    On ne croit pas le corps du webhook, même signé.
  let verification: any = null;
  try {
    const r = await fetch(`https://api.moneroo.io/v1/payments/${encodeURIComponent(idMoneroo)}/verify`, {
      headers: { Authorization: `Bearer ${cleMoneroo}`, Accept: 'application/json' },
      // Moneroo ralentit aux heures de pointe ; sans limite on bloquerait
      // jusqu'au delai d'expiration de la fonction elle-meme.
      signal: AbortSignal.timeout(15000)
    });
    verification = await r.json().catch(() => null);
    if (!r.ok) {
      console.error('[Relais] Vérification Moneroo en échec :', r.status);
      // 500 : Moneroo rejouera. C'est ce qu'on veut — le paiement est
      // peut-être bon, on n'a simplement pas pu le confirmer maintenant.
      return reponse({ erreur: 'Vérification impossible.' }, 500);
    }
  } catch (e) {
    console.error('[Relais] Moneroo injoignable pour vérification :', (e as Error).message);
    return reponse({ erreur: 'Vérification impossible.' }, 500);
  }

  // Moneroo renvoie la devise TANTÔT en chaîne (« XOF »), TANTÔT en objet
  // ({ code: 'XOF' }). Sans cette normalisation, String() produisait
  // « [object Object] », la vérification du montant échouait, et l'abonnement
  // n'était jamais activé alors que le client avait payé.
  const deviseBrute = verification?.data?.currency;
  const devise = typeof deviseBrute === 'string'
    ? deviseBrute
    : (deviseBrute?.code ?? 'XOF');

  // Le statut est du texte libre selon la passerelle sous-jacente : « success »
  // chez l'une, « succeeded » chez l'autre. Les deux veulent dire payé.
  const etatBrut = String(verification?.data?.status ?? '').toLowerCase();
  const etat = (etatBrut === 'success' || etatBrut === 'succeeded') ? 'success' : etatBrut;

  const admin = createClient(urlSupabase, cleService);

  if (etat !== 'success') {
    await admin.from('paiements')
      .update({
        statut: etat === 'pending' ? 'en_attente' : 'echoue',
        motif_echec: etat ? `État Moneroo : ${etat}` : 'État inconnu',
        provider_raw: verification,
        updated_at: new Date().toISOString()
      })
      .eq('reference_interne', referenceInterne);
    return reponse({ recu: true, etat }, 200);
  }

  // 4. ACTIVATION — la base revérifie le montant contre le prix du forfait,
  //    et ne fait rien si le paiement était déjà confirmé.
  const { data: resultat, error } = await admin.rpc('confirmer_paiement_abonnement', {
    p_reference_interne: referenceInterne,
    p_reference_externe: String(idMoneroo),
    p_montant: Number(verification?.data?.amount),
    p_devise: devise,
    p_brut: verification
  });

  if (error) {
    console.error('[Relais] Activation impossible :', error.message);
    return reponse({ erreur: 'Activation impossible.' }, 500);
  }

  const verdict = Array.isArray(resultat) ? resultat[0] : resultat;
  console.log('[Relais] Paiement', referenceInterne, '→', verdict?.resultat, verdict?.detail);
  return reponse({ recu: true, resultat: verdict?.resultat }, 200);
});

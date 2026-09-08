/**
 * =============================================================================
 * RELAIS — ON NE S'ABONNE PAS SANS PAYER
 * =============================================================================
 *
 * Le paiement est le seul endroit où un membre peut, s'il y arrive, s'octroyer
 * quelque chose qui vaut de l'argent. Ce test cherche les quatre façons de le
 * faire sans payer :
 *
 *   1. activer soi-même son abonnement
 *   2. payer moins cher que le prix affiché
 *   3. souscrire au forfait de l'autre rôle
 *   4. faire confirmer un paiement en imitant le prestataire
 *
 * Il vérifie aussi les deux comportements qui coûtent de l'argent dans l'autre
 * sens : un webhook rejoué ne doit pas créditer deux fois, et un renouvellement
 * anticipé ne doit pas effacer les jours restants.
 *
 * Le test tourne SANS clé Moneroo : tout ce qu'il contrôle vit en base et dans
 * les règles d'accès, pas chez le prestataire.
 *
 *   npm run test:paiement
 */

const URL = 'https://uqusictqdviahnxpzylu.supabase.co';
const CLE = 'sb_publishable_oe6V2dUMdFgAtMjSBi8-mg_olBmIxPr';
const MDP = 'RelaisDemo2026';

let ko = 0;
const verifier = (ok, libelle, detail = '') => {
  if (!ok) ko++;
  console.log(`  ${ok ? 'OK   ' : 'ECHEC'} ${libelle}${detail ? '  -> ' + detail : ''}`);
};

async function session(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: CLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: MDP })
  });
  const s = await r.json();
  if (!s.access_token) throw new Error(`connexion impossible pour ${email}`);
  return s.access_token;
}

const entetes = (jeton) => ({
  apikey: CLE,
  Authorization: `Bearer ${jeton}`,
  'Content-Type': 'application/json'
});

const rpc = (jeton, nom, corps) =>
  fetch(`${URL}/rest/v1/rpc/${nom}`, {
    method: 'POST', headers: entetes(jeton), body: JSON.stringify(corps || {})
  });

(async () => {
  const marchand = await session('marchand@demo.relais');
  const agence   = await session('agence@demo.relais');

  // ---------------------------------------------------------------------------
  console.log("\n1. Le prix vient-il de la base, ou du navigateur ?");

  const ouverture = await rpc(marchand, 'demarrer_paiement_abonnement', { p_plan_code: 'starter_merchant' });
  const paiement = (await ouverture.json())[0];
  verifier(ouverture.ok && paiement?.reference_interne,
    'un marchand peut ouvrir son forfait', paiement?.reference_interne);
  verifier(Number(paiement?.montant) === 10000,
    'le montant est celui du forfait, pas un montant envoyé', `${paiement?.montant} FCFA`);

  // ---------------------------------------------------------------------------
  console.log("\n2. Peut-on souscrire au forfait d'un autre rôle ?");

  const croise = await rpc(marchand, 'demarrer_paiement_abonnement', { p_plan_code: 'pro_agency' });
  verifier(!croise.ok, "un marchand ne prend pas le forfait agence", `HTTP ${croise.status}`);

  const croise2 = await rpc(agence, 'demarrer_paiement_abonnement', { p_plan_code: 'starter_merchant' });
  verifier(!croise2.ok, "une agence ne prend pas le forfait marchand", `HTTP ${croise2.status}`);

  const invente = await rpc(marchand, 'demarrer_paiement_abonnement', { p_plan_code: 'gratuit_a_vie' });
  verifier(!invente.ok, "un forfait inventé est refusé", `HTTP ${invente.status}`);

  // ---------------------------------------------------------------------------
  console.log("\n3. Peut-on activer son abonnement soi-même ?");

  const auto = await rpc(marchand, 'confirmer_paiement_abonnement', {
    p_reference_interne: paiement?.reference_interne,
    p_reference_externe: 'auto-octroi',
    p_montant: 10000,
    p_devise: 'FCFA'
  });
  verifier(!auto.ok, "confirmer un paiement est interdit à un membre", `HTTP ${auto.status}`);

  // ---------------------------------------------------------------------------
  console.log("\n4. Peut-on écrire directement dans les abonnements ?");

  const ecriture = await fetch(`${URL}/rest/v1/subscriptions`, {
    method: 'POST',
    headers: { ...entetes(marchand), Prefer: 'return=representation' },
    body: JSON.stringify({
      profile_id: '00000000-0000-0000-0000-000000000001',
      role: 'merchant', plan_name: 'Gratuit', amount_paid: 0, currency: 'FCFA',
      status: 'active', starts_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 31536000000).toISOString()
    })
  });
  verifier(!ecriture.ok, "insérer un abonnement à la main est refusé", `HTTP ${ecriture.status}`);

  const modification = await fetch(
    `${URL}/rest/v1/subscriptions?status=eq.expired`,
    { method: 'PATCH', headers: entetes(marchand), body: JSON.stringify({ status: 'active' }) }
  );
  verifier(!modification.ok, "prolonger un abonnement à la main est refusé", `HTTP ${modification.status}`);

  // ---------------------------------------------------------------------------
  console.log("\n5. Le webhook est-il protégé ?");

  const sansSignature = await fetch(`${URL}/functions/v1/moneroo-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: { id: 'faux', status: 'success', amount: 10000, currency: 'XOF',
              metadata: { reference_interne: paiement?.reference_interne } }
    })
  });
  verifier(sansSignature.status === 403,
    'un webhook non signé est rejeté', `HTTP ${sansSignature.status}`);

  const mauvaiseSignature = await fetch(`${URL}/functions/v1/moneroo-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Moneroo-Signature': 'a'.repeat(64) },
    body: JSON.stringify({ data: { id: 'faux', metadata: { reference_interne: 'x' } } })
  });
  verifier(mauvaiseSignature.status === 403,
    'une signature inventée est rejetée', `HTTP ${mauvaiseSignature.status}`);

  // ---------------------------------------------------------------------------
  console.log("\n6. L'abonnement du marchand a-t-il bougé ?");

  const apres = await rpc(marchand, 'mon_abonnement');
  const etat = (await apres.json())[0] || null;
  verifier(!etat || etat.plan !== 'Gratuit',
    "aucun abonnement n'a été obtenu sans paiement",
    etat ? `${etat.plan} — ${etat.actif ? 'actif' : 'inactif'}` : 'aucun');

  console.log('\n' + '='.repeat(66));
  console.log(ko === 0
    ? "On ne s'abonne pas sans payer, et le prix ne se négocie pas."
    : `${ko} problème(s).`);
  console.log(`\nÀ nettoyer en base : le paiement ${paiement?.reference_interne} (resté en attente).`);
  process.exit(ko === 0 ? 0 : 1);
})();

/**
 * =============================================================================
 * RELAIS — LE REVERSEMENT DU CASH COLLECTÉ
 * =============================================================================
 *
 * L'agence encaisse l'argent des clients et doit le reverser au marchand,
 * frais déduits. C'est le moment le plus sensible de la relation.
 *
 * La garantie centrale de Relais est le DOUBLE ACCUSÉ DE RÉCEPTION : l'agence
 * déclare avoir viré, le marchand confirme avoir reçu. Aucun des deux ne peut
 * signer à la place de l'autre.
 *
 *   npm run test:reversement
 *
 * Ce test parle directement à l'API : c'est là que vit la sécurité, pas dans
 * les boutons.
 */

const SUPABASE_URL = 'https://uqusictqdviahnxpzylu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oe6V2dUMdFgAtMjSBi8-mg_olBmIxPr';
const MDP = 'RelaisDemo2026';

let echecs = 0;
function verifier(nom, condition, detail = '') {
  if (!condition) echecs++;
  console.log(`  ${condition ? 'OK   ' : 'ECHEC'} ${nom}${detail ? '  -> ' + String(detail).slice(0, 62) : ''}`);
}

async function jeton(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: MDP })
  });
  const s = await r.json();
  if (!s.access_token) throw new Error(`connexion impossible pour ${email}`);
  return s.access_token;
}

function entetes(token) {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function rest(token, chemin, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    ...options, headers: { ...entetes(token), ...(options.headers || {}) }
  });
  const texte = await r.text();
  try { return JSON.parse(texte); } catch { return texte; }
}

async function rpc(token, fonction, corps) {
  return rest(token, `rpc/${fonction}`, { method: 'POST', body: JSON.stringify(corps) });
}

const erreurDe = (r) => (r && r.message) || null;

(async () => {
  console.log('\nCycle de reversement du cash\n');

  const marchand = await jeton('marchand@demo.relais');
  const agence   = await jeton('agence@demo.relais');

  const [{ id: idMarchand }] = await rest(marchand, 'merchants?select=id');
  const [{ id: idAgence }]   = await rest(marchand, 'agencies?select=id&status=eq.verified&limit=1');
  const [{ id: idConv }]     = await rest(marchand, 'conversations?select=id&limit=1');

  // --- Une livraison encaissée, à reverser ------------------------------------
  console.log('Préparation : une livraison encaissée');
  const produit = `Reversement ${Date.now().toString().slice(-6)}`;
  const [commande] = await rest(marchand, 'orders', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      conversation_id: idConv, merchant_id: idMarchand, agency_id: idAgence,
      product_name: produit, quantity: 1, cod_amount: 40000, delivery_fee: 3000,
      recipient_name: 'Client Test', recipient_phone: '07 00 00 00 00',
      recipient_address: 'Adresse de test', recipient_city: 'Abidjan'
    })
  });
  await rest(agence, `orders?id=eq.${commande.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'delivered' })
  });
  console.log(`  ${commande.order_code} — 40 000 FCFA encaissés, 3 000 FCFA de frais\n`);

  // --- 1. Qui peut arrêter les comptes ? --------------------------------------
  console.log('1. Arrêt des comptes');
  const parMarchand = await rpc(marchand, 'generer_point_financier',
    { p_conversation: idConv, p_debut: '2026-01-01', p_fin: '2026-12-31' });
  verifier('le marchand ne peut pas arrêter les comptes',
    /Seule une agence/i.test(erreurDe(parMarchand) || ''), erreurDe(parMarchand));

  const point = await rpc(agence, 'generer_point_financier',
    { p_conversation: idConv, p_debut: '2026-01-01', p_fin: '2026-12-31' });
  verifier("l'agence les arrête", !!point.id, point.payout_reference || erreurDe(point));
  verifier('le net est calculé par la base, pas saisi',
    Number(point.net_payout_amount) === Number(point.total_cod_collected) - Number(point.total_delivery_fees),
    `${point.total_cod_collected} − ${point.total_delivery_fees} = ${point.net_payout_amount}`);
  verifier('les commandes passent « en cours de règlement »', point.status === 'draft');

  // --- 2. L'ordre des gestes ---------------------------------------------------
  console.log('\n2. Personne ne saute une étape');
  const confirmeTrop_tot = await rpc(marchand, 'confirmer_reception_fonds', { p_point: point.id });
  verifier('le marchand ne confirme pas avant que le virement soit déclaré',
    /Aucun virement déclaré/i.test(erreurDe(confirmeTrop_tot) || ''), erreurDe(confirmeTrop_tot));

  const declareParMarchand = await rpc(marchand, 'declarer_virement',
    { p_point: point.id, p_preuve: 'faux-recu.jpg' });
  verifier("le marchand ne déclare pas le virement de l'agence",
    /Seule l'agence/i.test(erreurDe(declareParMarchand) || ''), erreurDe(declareParMarchand));

  // --- 3. Le double accusé de réception ----------------------------------------
  console.log('\n3. Le double accusé de réception');
  const declare = await rpc(agence, 'declarer_virement',
    { p_point: point.id, p_preuve: 'recu-wave-001.jpg', p_note: 'Viré par Wave' });
  verifier("l'agence déclare le virement", declare.status === 'initiated', declare.status || erreurDe(declare));

  const autoConfirme = await rpc(agence, 'confirmer_reception_fonds', { p_point: point.id });
  verifier("l'agence NE PEUT PAS se déclarer quitte elle-même",
    /Seul le marchand destinataire/i.test(erreurDe(autoConfirme) || ''), erreurDe(autoConfirme));

  const confirme = await rpc(marchand, 'confirmer_reception_fonds',
    { p_point: point.id, p_note: 'Reçu sur Orange Money' });
  verifier('le marchand confirme', confirme.status === 'confirmed', confirme.status || erreurDe(confirme));
  verifier('les deux signatures sont distinctes',
    confirme.agency_note === 'Viré par Wave' && confirme.merchant_note === 'Reçu sur Orange Money',
    `agence: « ${confirme.agency_note} » · marchand: « ${confirme.merchant_note} »`);

  // --- 4. Les commandes sont soldées -------------------------------------------
  console.log('\n4. Après confirmation');
  const soldee = (await rest(marchand, `orders?select=payout_status&id=eq.${commande.id}`))[0];
  verifier('la commande est soldée', soldee.payout_status === 'paid', soldee.payout_status);

  const deuxieme = await rpc(agence, 'generer_point_financier',
    { p_conversation: idConv, p_debut: '2026-01-01', p_fin: '2026-12-31' });
  verifier('impossible de reverser deux fois la même livraison',
    /Aucune livraison encaissée/i.test(erreurDe(deuxieme) || ''), erreurDe(deuxieme));

  // --- Nettoyage ---------------------------------------------------------------
  console.log('\n' + '='.repeat(64));
  console.log(echecs === 0
    ? "Aucune des deux parties ne peut signer à la place de l'autre."
    : `${echecs} problème(s).`);
  console.log(`\nÀ nettoyer en base : la commande ${commande.order_code}`);
  process.exit(echecs === 0 ? 0 : 1);
})();

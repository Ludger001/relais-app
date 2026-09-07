/**
 * =============================================================================
 * RELAIS — LES PIÈCES JOINTES NE SORTENT PAS DE LEUR CONVERSATION
 * =============================================================================
 *
 * Le métier a besoin des photos : colis abîmé, preuve de livraison, capture du
 * virement. Mais une pièce jointe fait partie d'une conversation entre deux
 * parties, et de personne d'autre.
 *
 * Ce que ce test vérifie, sur la vraie base :
 *   1. un participant peut déposer un fichier dans SA conversation
 *   2. l'autre participant peut le lire
 *   3. un tiers ne peut ni le lire, ni en obtenir un lien signé
 *   4. personne ne peut déposer dans la conversation d'autrui
 *   5. le dépôt n'est pas public : aucune adresse permanente ne fonctionne
 *
 *   node tests/testPiecesJointes.js
 */

const URL = 'https://uqusictqdviahnxpzylu.supabase.co';
const CLE = 'sb_publishable_oe6V2dUMdFgAtMjSBi8-mg_olBmIxPr';
const MDP = 'RelaisDemo2026';
const DEPOT = 'pieces-chat';

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
  if (!s.access_token) throw new Error(`connexion impossible pour ${email} : ${s.msg || s.error_description}`);
  return s.access_token;
}

const entetes = (jeton, extra = {}) => ({ apikey: CLE, Authorization: `Bearer ${jeton}`, ...extra });

/** Une image PNG minuscule mais valide, sans dépendance. */
function imageDEssai() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

(async () => {
  console.log('\n1. Qui participe à quoi ?');

  const jetonMarchand = await session('marchand@demo.relais');
  const jetonAgence   = await session('agence@demo.relais');
  const jetonAdmin    = await session('admin@demo.relais');

  const r = await fetch(`${URL}/rest/v1/conversations?select=id&limit=1`, { headers: entetes(jetonMarchand) });
  const conversations = await r.json();
  if (!Array.isArray(conversations) || !conversations.length) {
    console.log('  Aucune conversation de démonstration : test ignoré.');
    process.exit(0);
  }
  const conversation = conversations[0].id;
  verifier(true, 'conversation de démonstration trouvée', conversation);

  // ---------------------------------------------------------------------------
  console.log('\n2. Le marchand dépose une photo dans sa conversation');

  const chemin = `${conversation}/test-${Date.now()}.png`;
  const depot = await fetch(`${URL}/storage/v1/object/${DEPOT}/${chemin}`, {
    method: 'POST',
    headers: entetes(jetonMarchand, { 'Content-Type': 'image/png' }),
    body: imageDEssai()
  });
  verifier(depot.ok, 'le dépôt est accepté pour un participant', `HTTP ${depot.status}`);
  if (!depot.ok) {
    console.log('   ', (await depot.text()).slice(0, 200));
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  console.log("\n3. L'agence, l'autre participante, peut la lire");

  const lienAgence = await fetch(`${URL}/storage/v1/object/sign/${DEPOT}/${chemin}`, {
    method: 'POST',
    headers: entetes(jetonAgence, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: 600 })
  });
  verifier(lienAgence.ok, "l'agence obtient un lien signé", `HTTP ${lienAgence.status}`);

  if (lienAgence.ok) {
    const { signedURL, signedUrl } = await lienAgence.json();
    const url = signedUrl || signedURL;
    const image = await fetch(`${URL}/storage/v1${url.startsWith('/') ? '' : '/'}${url}`);
    verifier(image.ok, 'le lien signé délivre réellement le fichier', `HTTP ${image.status}`);
  }

  // ---------------------------------------------------------------------------
  console.log("\n4. Un tiers n'obtient rien");

  // L'administrateur n'est participant d'aucune conversation : c'est le tiers
  // le mieux placé pour tenter, puisqu'il est par ailleurs le plus privilégié.
  const lienTiers = await fetch(`${URL}/storage/v1/object/sign/${DEPOT}/${chemin}`, {
    method: 'POST',
    headers: entetes(jetonAdmin, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: 600 })
  });
  verifier(!lienTiers.ok, "un non-participant n'obtient pas de lien signé", `HTTP ${lienTiers.status}`);

  const lectureTiers = await fetch(`${URL}/storage/v1/object/${DEPOT}/${chemin}`, {
    headers: entetes(jetonAdmin)
  });
  verifier(!lectureTiers.ok, 'il ne peut pas lire le fichier directement', `HTTP ${lectureTiers.status}`);

  // ---------------------------------------------------------------------------
  console.log("\n5. On ne dépose pas dans la conversation d'autrui");

  const conversationInventee = '00000000-0000-0000-0000-000000000001';
  const depotAilleurs = await fetch(`${URL}/storage/v1/object/${DEPOT}/${conversationInventee}/intrus.png`, {
    method: 'POST',
    headers: entetes(jetonMarchand, { 'Content-Type': 'image/png' }),
    body: imageDEssai()
  });
  verifier(!depotAilleurs.ok, 'dépôt refusé hors de ses conversations', `HTTP ${depotAilleurs.status}`);

  // ---------------------------------------------------------------------------
  console.log("\n6. Le dépôt n'est pas public");

  const sansSession = await fetch(`${URL}/storage/v1/object/public/${DEPOT}/${chemin}`);
  verifier(!sansSession.ok, 'aucune adresse permanente ne fonctionne', `HTTP ${sansSession.status}`);

  const anonyme = await fetch(`${URL}/storage/v1/object/${DEPOT}/${chemin}`, { headers: { apikey: CLE } });
  verifier(!anonyme.ok, 'un visiteur non connecté est refusé', `HTTP ${anonyme.status}`);

  // ---------------------------------------------------------------------------
  console.log('\n7. Personne ne retire une pièce jointe après coup');

  // Même règle que pour les commandes et les comptes : un historique commercial
  // engage deux parties, l'une ne peut pas en faire disparaître un morceau
  // seule. Le dépôt n'a donc ni règle de suppression ni règle de remplacement.
  const suppression = await fetch(`${URL}/storage/v1/object/${DEPOT}`, {
    method: 'DELETE',
    headers: entetes(jetonMarchand, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: [chemin] })
  });
  const retires = suppression.ok ? await suppression.json() : [];
  verifier(!Array.isArray(retires) || retires.length === 0,
    "celui qui l'a déposée ne peut pas la retirer",
    `${Array.isArray(retires) ? retires.length : '?'} objet(s) supprimé(s)`);

  const toujoursLa = await fetch(`${URL}/storage/v1/object/sign/${DEPOT}/${chemin}`, {
    method: 'POST',
    headers: entetes(jetonAgence, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: 60 })
  });
  verifier(toujoursLa.ok, "l'autre partie la voit toujours", `HTTP ${toujoursLa.status}`);

  console.log('\n' + '='.repeat(66));
  console.log(ko === 0
    ? "Une pièce jointe ne sort pas de la conversation qui la porte."
    : `${ko} problème(s).`);
  console.log(`\nÀ nettoyer en base : l'objet ${DEPOT}/${chemin}`);
  process.exit(ko === 0 ? 0 : 1);
})();

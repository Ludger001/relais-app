/**
 * =============================================================================
 * RELAIS — LE FILTRE EST-IL RÉELLEMENT INCONTOURNABLE ?
 * =============================================================================
 *
 * Ce test ouvre un vrai navigateur, se connecte comme un vrai marchand, et
 * tape un numéro de téléphone dans le chat. Puis il tente de contourner la
 * fonction serveur exactement comme le ferait quelqu'un de mal intentionné :
 * en écrivant directement dans la base depuis la console.
 *
 *   node tests/testChatServeur.js [url]
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:3000';
const SUPABASE_URL = 'https://uqusictqdviahnxpzylu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oe6V2dUMdFgAtMjSBi8-mg_olBmIxPr';
const REF = 'uqusictqdviahnxpzylu';

let echecs = 0;
function verifier(nom, condition, detail = '') {
  if (!condition) echecs++;
  console.log(`  ${condition ? 'OK   ' : 'ECHEC'} ${nom}${detail ? '  -> ' + detail : ''}`);
}

async function session(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'RelaisDemo2026' })
  });
  return r.json();
}

(async () => {
  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await contexte.newPage();

  const s = await session('marchand@demo.relais');
  if (!s.access_token) { console.log('Connexion impossible :', s.msg); process.exit(1); }

  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} },
    [`sb-${REF}-auth-token`, JSON.stringify(s)]);

  console.log(`\nChat sécurisé — ${BASE}\n`);

  await page.goto(`${BASE}/app.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // --- 1. La conversation existante est-elle chargée depuis la base ? ---
  console.log('1. Chargement depuis la base');
  await page.click('#tab-btn-chat');
  await page.waitForTimeout(800);

  // On ne regarde QUE les bulles de message. Les bons de commande affichent
  // volontairement le téléphone du client : ils ne passent pas par la
  // messagerie, donc pas par le filtre, et c'est tout l'intérêt du dispositif.
  const messagesAffiches = await page.evaluate(() =>
    [...document.querySelectorAll('#messages-stream .bubble:not(.order-card-bubble)')]
      .map(b => b.textContent.trim())
  );
  verifier('des messages sont chargés', messagesAffiches.length > 0, `${messagesAffiches.length} message(s)`);
  verifier('aucun numéro en clair dans les messages',
    !messagesAffiches.some(m => /\d{2}\s\d{2}\s\d{2}\s\d{2}/.test(m)));

  // --- 2. Envoyer un numéro depuis l'interface ---
  console.log('\n2. Un marchand tape un numéro dans le chat');
  const avant = messagesAffiches.length;
  await page.fill('#chat-input-field', 'Rappelle-moi vite au 07 45 12 89 00');
  await page.click('#btn-send-message');
  await page.waitForTimeout(5000);

  const apres = await page.evaluate(() =>
    [...document.querySelectorAll('#messages-stream .bubble')].map(b => b.textContent.trim())
  );
  const dernier = apres[apres.length - 1] || '';
  verifier('le message est bien parti', apres.length > avant);
  verifier('le numéro est masqué', /masqué/i.test(dernier), dernier.slice(0, 70));
  verifier('les chiffres ont disparu', !/07\s*45\s*12\s*89\s*00/.test(dernier));

  // --- 3. Contourner la fonction depuis la console du navigateur ---
  console.log('\n3. Tentative de contournement depuis la console');
  const contournement = await page.evaluate(async () => {
    const conv = Object.values(window.state.conversationIds)[0];
    const { error } = await window.db.from('messages').insert({
      conversation_id: conv,
      sender_id: window.state.profile.id,
      original_content: 'Mon vrai numero 07 00 11 22 33',
      filtered_content: 'Mon vrai numero 07 00 11 22 33'
    });
    return error ? error.message : 'INSERTION ACCEPTEE';
  });
  verifier('écriture directe refusée', /permission denied/i.test(contournement), contournement.slice(0, 60));

  // --- 4. Lire le contenu brut depuis la console ---
  console.log('\n4. Tentative de lecture du texte original');
  const lectureBrute = await page.evaluate(async () => {
    const { error } = await window.db.from('messages').select('original_content');
    return error ? error.message : 'LECTURE ACCEPTEE';
  });
  verifier('lecture du brut refusée', /permission denied/i.test(lectureBrute), lectureBrute.slice(0, 60));

  await navigateur.close();

  console.log('\n' + '='.repeat(62));
  console.log(echecs === 0
    ? 'Le filtre serveur est incontournable depuis le navigateur.'
    : `${echecs} problème(s).`);
  process.exit(echecs === 0 ? 0 : 1);
})();

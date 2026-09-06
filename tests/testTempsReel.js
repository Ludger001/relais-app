/**
 * =============================================================================
 * RELAIS — LES MESSAGES ARRIVENT-ILS SANS RECHARGER ?
 * =============================================================================
 *
 * Deux navigateurs ouverts en même temps, le marchand et l'agence. Le marchand
 * écrit ; l'agence doit voir le message apparaître sans avoir rien fait.
 *
 * Ce test vérifie aussi un point de sécurité : la diffusion en direct ne
 * transporte PAS le contenu des messages. Le navigateur n'a pas le droit de
 * lire la table, il reçoit seulement un signal et relit par le chemin normal.
 *
 *   npm run test:direct [url]
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:3000';
const SUPABASE_URL = 'https://uqusictqdviahnxpzylu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oe6V2dUMdFgAtMjSBi8-mg_olBmIxPr';
const REF = 'uqusictqdviahnxpzylu';

let echecs = 0;
function verifier(nom, condition, detail = '') {
  if (!condition) echecs++;
  console.log(`  ${condition ? 'OK   ' : 'ECHEC'} ${nom}${detail ? '  -> ' + String(detail).slice(0, 60) : ''}`);
}

async function ouvrir(navigateur, email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'RelaisDemo2026' })
  });
  const s = await r.json();
  if (!s.access_token) throw new Error(`connexion impossible pour ${email}`);

  const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await contexte.newPage();
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} },
    [`sb-${REF}-auth-token`, JSON.stringify(s)]);
  await page.goto(`${BASE}/app.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.click('#tab-btn-chat');
  await page.waitForTimeout(1500);
  return page;
}

const compterBulles = (page) =>
  page.evaluate(() => document.querySelectorAll('#messages-stream .bubble').length);

(async () => {
  const navigateur = await chromium.launch();
  const marqueur = `Direct ${Date.now().toString().slice(-6)}`;

  console.log(`\nChat en direct — ${BASE}\n`);

  console.log('1. Deux membres ouvrent la même conversation');
  const marchand = await ouvrir(navigateur, 'marchand@demo.relais');
  const agence = await ouvrir(navigateur, 'agence@demo.relais');

  const ecouteActive = await agence.evaluate(async () => {
    // Laisser le temps à l'abonnement de s'établir
    await new Promise(r => setTimeout(r, 2500));
    return !!window.state.canalDirect;
  });
  verifier("l'écoute en direct est établie", ecouteActive);

  const avant = await compterBulles(agence);
  console.log(`       l'agence affiche ${avant} élément(s)`);

  console.log("\n2. Le marchand écrit, l'agence ne touche à rien");
  await marchand.fill('#chat-input-field', marqueur);
  await marchand.click('#btn-send-message');

  let apparu = false;
  try {
    await agence.waitForFunction(
      (m) => [...document.querySelectorAll('#messages-stream .bubble')]
        .some(b => b.textContent.includes(m)),
      marqueur,
      { timeout: 15000 }
    );
    apparu = true;
  } catch (e) { apparu = false; }

  const apres = await compterBulles(agence);
  verifier("le message apparaît chez l'agence sans rechargement", apparu, `${avant} → ${apres}`);

  console.log('\n3. La diffusion transporte-t-elle du contenu interdit ?');
  const fuite = await agence.evaluate(async () => {
    // Ce que le canal permet de lire directement, hors du chemin normal
    const { data, error } = await window.db.from('messages').select('original_content').limit(1);
    return error ? error.message : JSON.stringify(data);
  });
  verifier('le texte d\'origine reste inaccessible', /permission denied/i.test(fuite), fuite.slice(0, 55));

  await navigateur.close();

  console.log('\n' + '='.repeat(62));
  console.log(echecs === 0
    ? 'Les messages arrivent en direct, sans exposer la table.'
    : `${echecs} problème(s).`);
  process.exit(echecs === 0 ? 0 : 1);
})();

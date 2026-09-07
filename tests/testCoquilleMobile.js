/**
 * =============================================================================
 * RELAIS — SE COMPORTE-T-ELLE COMME UNE APPLICATION ?
 * =============================================================================
 *
 * Pourquoi ce test existe : sur un vrai téléphone, la zone de saisie du chat
 * passait sous la barre du navigateur. Ni `testResponsive.js` (débordement
 * horizontal) ni `testTactile.js` (taille des cibles) ne pouvaient le voir —
 * un navigateur sans interface n'a ni barre d'adresse ni clavier.
 *
 * On simule ici ce que ces deux-là font à la fenêtre : ils la rétrécissent.
 * C'est exactement le comportement de Chrome Android avec
 * `interactive-widget=resizes-content`, et une approximation honnête de ce que
 * Safari iOS produit via `visualViewport`.
 *
 * Le test couvre deux choses :
 *
 *   A. La coquille — la zone de saisie reste-t-elle visible et atteignable,
 *      clavier ouvert, barres du navigateur déployées, après rotation ?
 *   B. L'installation — manifeste, icônes, service worker : ce qu'il faut pour
 *      poser l'application sur un écran d'accueil, puis l'emballer pour les
 *      magasins.
 *
 *   npm run test:mobile
 *   node tests/testCoquilleMobile.js https://relais-app-wwk4.vercel.app
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:3000';

const SUPABASE_URL = 'https://uqusictqdviahnxpzylu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oe6V2dUMdFgAtMjSBi8-mg_olBmIxPr';
const MOT_DE_PASSE = 'RelaisDemo2026';

// Hauteurs retranchées à la fenêtre pour imiter ce qui la mange
const SITUATIONS = [
  { nom: 'écran plein',                     retire: 0 },
  { nom: 'barres du navigateur déployées',  retire: 110 },
  { nom: 'clavier ouvert',                  retire: 336 },
  { nom: 'clavier ouvert, petit téléphone', retire: 300, hauteur: 640, largeur: 320 }
];

const FORMATS = [
  { nom: 'iPhone 13', largeur: 390, hauteur: 844 },
  { nom: 'Galaxy A',  largeur: 360, hauteur: 740 }
];

let ko = 0;
const verifier = (ok, libelle, detail = '') => {
  if (!ok) ko++;
  console.log(`  ${ok ? 'OK   ' : 'ECHEC'} ${libelle}${detail ? '  -> ' + detail : ''}`);
};

async function ouvrirSession(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: MOT_DE_PASSE })
  });
  const s = await r.json();
  if (!s.access_token) throw new Error(`connexion impossible pour ${email}`);
  return s;
}

(async () => {
  const navigateur = await chromium.launch();

  // ===========================================================================
  console.log('\nA. LA COQUILLE — la zone de saisie reste-t-elle atteignable ?');
  // ===========================================================================

  const session = await ouvrirSession('marchand@demo.relais');
  const ref = SUPABASE_URL.replace('https://', '').split('.')[0];

  for (const format of FORMATS) {
    console.log(`\n  ${format.nom} — ${format.largeur}×${format.hauteur}`);

    const contexte = await navigateur.newContext({
      viewport: { width: format.largeur, height: format.hauteur },
      isMobile: true, hasTouch: true, deviceScaleFactor: 2
    });
    const page = await contexte.newPage();
    await page.addInitScript(
      ([cle, valeur]) => { try { window.localStorage.setItem(cle, valeur); } catch (e) {} },
      [`sb-${ref}-auth-token`, JSON.stringify(session)]
    );
    await page.goto(BASE + '/app.html', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(900);
    await page.click('.tab-item[data-tab="chat"]');
    await page.waitForTimeout(600);
    const conv = await page.$('.conv-item');
    if (conv) { await conv.click(); await page.waitForTimeout(800); }

    for (const situation of SITUATIONS) {
      const largeur = situation.largeur || format.largeur;
      const hauteur = (situation.hauteur || format.hauteur) - situation.retire;
      await page.setViewportSize({ width: largeur, height: hauteur });
      await page.waitForTimeout(450);

      const m = await page.evaluate(() => {
        const barre = document.querySelector('.chat-input-bar');
        const flux = document.getElementById('messages-stream');
        const champ = document.getElementById('chat-input-field');
        if (!barre || !flux || !champ) return null;
        const b = barre.getBoundingClientRect();
        const f = flux.getBoundingClientRect();
        return {
          ecran: window.innerHeight,
          barreHaut: Math.round(b.top), barreBas: Math.round(b.bottom),
          filHauteur: Math.round(f.height),
          champHauteur: Math.round(champ.getBoundingClientRect().height),
          pageDefile: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
        };
      });

      if (!m) { verifier(false, situation.nom, 'écran de chat introuvable'); continue; }

      const visible = m.barreBas <= m.ecran + 1 && m.barreHaut >= 0;
      const filUtile = m.filHauteur >= 60;    // au moins un message reste lisible
      const champUtile = m.champHauteur >= 40;
      verifier(visible && filUtile && champUtile && !m.pageDefile,
        situation.nom.padEnd(32),
        `saisie ${m.barreHaut}–${m.barreBas} / écran ${m.ecran} · fil ${m.filHauteur}px`);
    }
    await contexte.close();
  }

  // ===========================================================================
  console.log("\nB. L'INSTALLATION — de quoi poser l'application sur un écran d'accueil");
  // ===========================================================================

  const contexte = await navigateur.newContext();
  const page = await contexte.newPage();
  await page.goto(BASE + '/app.html', { waitUntil: 'networkidle', timeout: 30000 });

  // Le manifeste
  const lienManifeste = await page.getAttribute('link[rel="manifest"]', 'href');
  verifier(!!lienManifeste, 'la page déclare un manifeste', lienManifeste || 'absent');

  if (lienManifeste) {
    const reponse = await page.request.get(new URL(lienManifeste, BASE + '/app.html').href);
    verifier(reponse.ok(), 'le manifeste est servi', `HTTP ${reponse.status()}`);

    if (reponse.ok()) {
      let manifeste = null;
      try { manifeste = JSON.parse(await reponse.text()); } catch (e) { /* signalé plus bas */ }
      verifier(!!manifeste, 'le manifeste est du JSON valide');

      if (manifeste) {
        // Ces membres sont ceux qu'un navigateur exige pour proposer
        // l'installation ; il en manque un et la proposition n'apparaît pas.
        for (const membre of ['name', 'short_name', 'start_url', 'display', 'icons']) {
          verifier(!!manifeste[membre], `le manifeste déclare « ${membre} »`,
            membre === 'display' ? String(manifeste[membre]) : '');
        }
        verifier(['standalone', 'fullscreen', 'minimal-ui'].includes(manifeste.display),
          'il s\'ouvre hors du navigateur', String(manifeste.display));

        const tailles = (manifeste.icons || []).map(i => i.sizes);
        verifier(tailles.includes('192x192'), 'icône 192×192 déclarée');
        verifier(tailles.includes('512x512'), 'icône 512×512 déclarée');
        verifier((manifeste.icons || []).some(i => (i.purpose || '').includes('maskable')),
          'icône « maskable » déclarée',
          'sans elle, Android rogne le logo n\'importe comment');

        // Les fichiers existent-ils vraiment ?
        for (const icone of manifeste.icons || []) {
          const r = await page.request.get(new URL(icone.src, BASE + '/').href);
          verifier(r.ok(), `l'icône ${icone.sizes} est servie`, `HTTP ${r.status()}`);
        }
      }
    }
  }

  // Le service worker
  const sw = await page.request.get(BASE + '/sw.js');
  verifier(sw.ok(), 'le service worker est servi', `HTTP ${sw.status()}`);

  const enregistre = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'non supporté';
    try {
      const r = await navigator.serviceWorker.getRegistration();
      return r ? 'enregistré' : 'aucun';
    } catch (e) { return 'erreur : ' + e.message; }
  });
  verifier(enregistre === 'enregistré', 'le service worker s\'enregistre', enregistre);

  // Le méta qui donne sa couleur à la barre système
  const couleur = await page.getAttribute('meta[name="theme-color"]', 'content');
  verifier(!!couleur, 'la couleur de la barre système est déclarée', couleur || 'absente');

  const viewport = await page.getAttribute('meta[name="viewport"]', 'content');
  verifier((viewport || '').includes('viewport-fit=cover'),
    'viewport-fit=cover est présent',
    'sans lui, env(safe-area-inset-*) vaut zéro sur les téléphones à encoche');

  await contexte.close();
  await navigateur.close();

  console.log('\n' + '='.repeat(70));
  console.log(ko === 0
    ? "L'application tient dans l'écran, clavier compris, et s'installe."
    : `${ko} problème(s).`);
  process.exit(ko === 0 ? 0 : 1);
})();

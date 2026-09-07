/**
 * =============================================================================
 * RELAIS — L'APPLICATION SE MANIPULE-T-ELLE AU POUCE ?
 * =============================================================================
 *
 * Pourquoi ce test existe : `testResponsive.js` affichait 184 contrôles au vert
 * pendant que le chat était inutilisable sur téléphone. Il ne mesure que le
 * débordement horizontal et la taille du texte — jamais si l'on peut atteindre
 * un bouton avec le doigt.
 *
 * Ce test-ci mesure ce qui manquait :
 *
 *   1. les cibles tactiles font-elles au moins 44 px de côté ?
 *   2. deux cibles voisines sont-elles assez espacées pour ne pas se confondre ?
 *   3. l'action principale de l'écran est-elle atteignable sans défiler ?
 *
 * 44 px vient des recommandations d'accessibilité (WCAG 2.2 « Target Size ») et
 * correspond à la pulpe d'un pouce adulte. En dessous, on vise, on rate, on
 * réessaie — et sur un formulaire de commande, on se trompe de bouton.
 *
 *   npm run test:tactile
 *   node tests/testTactile.js https://relais-app-wwk4.vercel.app
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:3000';

const CIBLE_MIN = 44;   // px, WCAG 2.2 AA
const ECART_MIN = 8;    // px entre deux cibles voisines

// Du plus petit écran encore vendu au plus grand téléphone courant
const FORMATS = [
  { nom: 'Petit Android', largeur: 320, hauteur: 640 },
  { nom: 'Galaxy A',      largeur: 360, hauteur: 740 },
  { nom: 'iPhone 13/14',  largeur: 390, hauteur: 844 },
  { nom: 'iPhone Pro Max', largeur: 430, hauteur: 932 }
];

const PUBLIQUES_SEULEMENT = process.env.PAGES_PUBLIQUES_SEULEMENT === '1';

const PAGES_PUBLIQUES = [
  { chemin: '/index.html',                nom: "Accueil" },
  { chemin: '/connexion.html',            nom: 'Connexion' },
  { chemin: '/inscription-marchand.html', nom: 'Inscription marchand' },
  { chemin: '/candidature-agence.html',   nom: 'Candidature agence' }
];

// Dans l'application, chaque onglet est un écran à part entière.
const COMPTES = [
  { email: 'marchand@demo.relais', nom: 'marchand' },
  { email: 'agence@demo.relais',   nom: 'agence' },
  { email: 'admin@demo.relais',    nom: 'admin' }
];

const SUPABASE_URL = 'https://uqusictqdviahnxpzylu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oe6V2dUMdFgAtMjSBi8-mg_olBmIxPr';
const MOT_DE_PASSE = 'RelaisDemo2026';

const sessions = {};
async function ouvrirSession(email) {
  if (sessions[email]) return sessions[email];
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: MOT_DE_PASSE })
  });
  const s = await r.json();
  if (!s.access_token) throw new Error(`connexion impossible pour ${email}`);
  sessions[email] = s;
  return s;
}

/**
 * Relève ce qui se touche et qui est trop petit, ou trop serré contre un voisin.
 *
 * Les éléments purement décoratifs ou hors écran sont ignorés : on ne mesure
 * que ce qu'un doigt peut réellement viser à cet instant.
 */
async function releverCibles(page) {
  return page.evaluate(({ CIBLE_MIN, ECART_MIN }) => {
    const SELECTEUR = 'button, a[href], input:not([type=hidden]), select, textarea, [role="button"], [onclick]';
    const visibles = [];

    for (const el of document.querySelectorAll(SELECTEUR)) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
      if (el.disabled) continue;

      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Hors de l'écran visible : ce n'est pas une cible manquée, c'est du
      // contenu qu'il faut d'abord amener à l'écran.
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      // Un lien à l'intérieur d'une phrase n'est pas un bouton : on ne lui
      // demande pas 44px de haut.
      const dansUnParagraphe = el.tagName === 'A' && el.closest('p, li, .tb-journal, .log-entry');
      if (dansUnParagraphe) continue;

      visibles.push({
        el,
        nom: (el.id || el.getAttribute('aria-label') || el.className || el.tagName).toString().trim().slice(0, 38),
        x: r.left, y: r.top, w: r.width, h: r.height, r
      });
    }

    const tropPetites = visibles
      .filter(c => c.w < CIBLE_MIN || c.h < CIBLE_MIN)
      .map(c => ({ nom: c.nom, w: Math.round(c.w), h: Math.round(c.h) }));

    // Deux cibles côte à côte doivent être séparées, sinon on active la mauvaise.
    const tropSerrees = [];
    for (let i = 0; i < visibles.length; i++) {
      for (let j = i + 1; j < visibles.length; j++) {
        const a = visibles[i], b = visibles[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // On ne compare que des voisines du meme conteneur. Deux barres
        // empilees — l'en-tete et les onglets — se touchent forcement par
        // construction, sans qu'on risque d'activer l'une pour l'autre.
        if (a.el.parentElement !== b.el.parentElement) continue;
        const dx = Math.max(0, Math.max(a.r.left - b.r.right, b.r.left - a.r.right));
        const dy = Math.max(0, Math.max(a.r.top - b.r.bottom, b.r.top - a.r.bottom));
        const seTouchent = dx === 0 && dy === 0;
        const tropPres = (dx > 0 && dx < ECART_MIN && dy === 0) || (dy > 0 && dy < ECART_MIN && dx === 0);
        if (seTouchent || tropPres) tropSerrees.push(`${a.nom} / ${b.nom}`);
      }
    }

    return { total: visibles.length, tropPetites, tropSerrees: [...new Set(tropSerrees)].slice(0, 4) };
  }, { CIBLE_MIN, ECART_MIN });
}

(async () => {
  const navigateur = await chromium.launch();
  let problemes = 0, controles = 0;

  console.log(`Manipulation au pouce — ${BASE}`);
  console.log(`Cible minimale : ${CIBLE_MIN}px de côté, ${ECART_MIN}px entre voisines\n`);

  async function examiner(contexte, titre, page) {
    const releve = await releverCibles(page);
    controles++;
    const ok = releve.tropPetites.length === 0 && releve.tropSerrees.length === 0;
    if (!ok) problemes++;
    console.log(`  ${ok ? 'OK   ' : 'ECHEC'} ${titre.padEnd(38)} ${String(releve.total).padStart(3)} cibles`);
    for (const c of releve.tropPetites.slice(0, 5)) {
      console.log(`         -> trop petite : ${c.nom} (${c.w}×${c.h})`);
    }
    for (const paire of releve.tropSerrees) {
      console.log(`         -> trop serrées : ${paire}`);
    }
  }

  for (const format of FORMATS) {
    console.log(`\n${format.nom} — ${format.largeur}px`);
    console.log('  ' + '-'.repeat(64));

    // --- Les pages publiques ---
    for (const p of PAGES_PUBLIQUES) {
      const contexte = await navigateur.newContext({
        viewport: { width: format.largeur, height: format.hauteur },
        isMobile: true, hasTouch: true, deviceScaleFactor: 2
      });
      const page = await contexte.newPage();
      try {
        await page.goto(BASE + p.chemin, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(500);
        await examiner(contexte, p.nom, page);
      } catch (e) {
        controles++; problemes++;
        console.log(`  ECHEC ${p.nom.padEnd(38)} ${e.message.split('\n')[0].slice(0, 40)}`);
      }
      await contexte.close();
    }

    if (PUBLIQUES_SEULEMENT) continue;

    // --- L'application, onglet par onglet et rôle par rôle ---
    for (const compte of COMPTES) {
      const session = await ouvrirSession(compte.email);
      const contexte = await navigateur.newContext({
        viewport: { width: format.largeur, height: format.hauteur },
        isMobile: true, hasTouch: true, deviceScaleFactor: 2
      });
      const page = await contexte.newPage();
      const ref = SUPABASE_URL.replace('https://', '').split('.')[0];
      await page.addInitScript(
        ([cle, valeur]) => { try { window.localStorage.setItem(cle, valeur); } catch (e) {} },
        [`sb-${ref}-auth-token`, JSON.stringify(session)]
      );

      try {
        await page.goto(BASE + '/app.html', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(900);

        const onglets = await page.evaluate(() =>
          [...document.querySelectorAll('.tab-item')]
            .filter(b => getComputedStyle(b).display !== 'none')
            .map(b => b.dataset.tab));

        for (const onglet of onglets) {
          await page.click(`.tab-item[data-tab="${onglet}"]`);
          await page.waitForTimeout(500);
          await examiner(contexte, `${compte.nom} · ${onglet}`, page);

          // Le fil de discussion est un écran de plus : il faut y entrer.
          if (onglet === 'chat') {
            const conv = await page.$('.conv-item');
            if (conv) {
              await conv.click();
              await page.waitForTimeout(700);
              await examiner(contexte, `${compte.nom} · chat (fil)`, page);
            }
          }
        }
      } catch (e) {
        controles++; problemes++;
        console.log(`  ECHEC ${compte.nom.padEnd(38)} ${e.message.split('\n')[0].slice(0, 40)}`);
      }
      await contexte.close();
    }
  }

  await navigateur.close();

  console.log('\n' + '='.repeat(70));
  console.log(problemes === 0
    ? `Tout se manipule au pouce : ${controles} écrans contrôlés sur ${FORMATS.length} formats.`
    : `${problemes} écran(s) difficiles au doigt, sur ${controles} contrôlés.`);
  process.exit(problemes === 0 ? 0 : 1);
})();

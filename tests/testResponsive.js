/**
 * =============================================================================
 * RELAIS — VÉRIFICATION D'AFFICHAGE SUR TÉLÉPHONES
 * =============================================================================
 *
 * Ouvre chaque page dans un vrai navigateur, à la taille exacte de plusieurs
 * modèles de téléphones, et cherche ce qui déborde horizontalement.
 *
 * Un site « qui zoome bizarrement » sur mobile, c'est presque toujours ça :
 * un élément plus large que l'écran force le navigateur à dézoomer la page
 * entière pour la faire tenir.
 *
 *   npm run test:responsive
 *
 * Le serveur local doit tourner (npm run dev) OU on passe une URL :
 *   node tests/testResponsive.js https://relais-app-wwk4.vercel.app
 */

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:3000';

// Formats réels, du plus petit au plus grand
const APPAREILS = [
  { nom: 'Petit Android (320px)',   largeur: 320, hauteur: 640, dpr: 2 },
  { nom: 'Galaxy S8 / A-series',    largeur: 360, hauteur: 740, dpr: 3 },
  { nom: 'iPhone SE',               largeur: 375, hauteur: 667, dpr: 2 },
  { nom: 'iPhone 13 / 14',          largeur: 390, hauteur: 844, dpr: 3 },
  { nom: 'Pixel 5',                 largeur: 393, hauteur: 851, dpr: 3 },
  { nom: 'Galaxy S20 Ultra',        largeur: 412, hauteur: 915, dpr: 3 },
  { nom: 'iPhone 14 Pro Max',       largeur: 430, hauteur: 932, dpr: 3 },
  { nom: 'iPad Mini (portrait)',    largeur: 768, hauteur: 1024, dpr: 2 }
];

const PAGES = [
  { chemin: '/index.html',                nom: "Page d'accueil" },
  { chemin: '/connexion.html',            nom: 'Connexion' },
  { chemin: '/inscription-marchand.html', nom: 'Inscription marchand' },
  { chemin: '/candidature-agence.html',   nom: 'Candidature agence' },
  { chemin: '/nouveau-mot-de-passe.html', nom: 'Nouveau mot de passe' },
  { chemin: '/conditions-generales.html', nom: 'Conditions générales' },
  { chemin: '/politique-confidentialite.html', nom: 'Confidentialité' },
  { chemin: '/charte-anti-fraude.html',   nom: 'Charte anti-fraude' },
  { chemin: '/app.html',                  nom: 'Application (marchand)',  compte: 'marchand@demo.relais' },
  { chemin: '/app.html',                  nom: 'Application (agence)',    compte: 'agence@demo.relais' }
];

// Comptes de démonstration : sans session, app.html redirige vers la connexion
// et on ne mesurerait jamais le vrai écran.
const SUPABASE_URL = 'https://uqusictqdviahnxpzylu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oe6V2dUMdFgAtMjSBi8-mg_olBmIxPr';
const MOT_DE_PASSE_DEMO = 'RelaisDemo2026';

const sessionsEnCache = {};

async function ouvrirSession(email) {
  if (sessionsEnCache[email]) return sessionsEnCache[email];
  const reponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: MOT_DE_PASSE_DEMO })
  });
  const session = await reponse.json();
  if (!session.access_token) {
    throw new Error(`connexion impossible pour ${email} : ${session.msg || session.error_description || 'inconnue'}`);
  }
  sessionsEnCache[email] = session;
  return session;
}

// Tolérance : 1px de sous-pixel n'est pas un débordement visible
const TOLERANCE = 2;

(async () => {
  const navigateur = await chromium.launch();
  let problemes = 0;
  let controles = 0;

  console.log(`Vérification de ${BASE}\n`);

  for (const page of PAGES) {
    console.log(`\n${page.nom}  (${page.chemin})`);
    console.log('  ' + '-'.repeat(66));

    for (const appareil of APPAREILS) {
      const contexte = await navigateur.newContext({
        viewport: { width: appareil.largeur, height: appareil.hauteur },
        deviceScaleFactor: appareil.dpr,
        isMobile: appareil.largeur < 768,
        hasTouch: true
      });
      const onglet = await contexte.newPage();

      const erreursJs = [];
      onglet.on('pageerror', (e) => erreursJs.push(e.message));

      try {
        // Injecter la session AVANT le chargement, sinon la page redirige
        if (page.compte) {
          const session = await ouvrirSession(page.compte);
          const ref = SUPABASE_URL.replace('https://', '').split('.')[0];
          await onglet.addInitScript(
            ([cle, valeur]) => { try { window.localStorage.setItem(cle, valeur); } catch (e) {} },
            [`sb-${ref}-auth-token`, JSON.stringify(session)]
          );
        }

        await onglet.goto(BASE + page.chemin, { waitUntil: 'networkidle', timeout: 30000 });
        await onglet.waitForTimeout(900);

        // Vérifier qu'on n'a pas été renvoyé vers la connexion
        if (page.compte && /connexion\.html/.test(onglet.url())) {
          throw new Error('session refusée : la page a redirigé vers la connexion');
        }

        const mesure = await onglet.evaluate((tolerance) => {
          const largeurEcran = document.documentElement.clientWidth;

          // Éléments réellement plus larges que l'écran
          const coupables = [];
          for (const el of document.querySelectorAll('body *')) {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;

            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;

            const deborde = r.right > largeurEcran + tolerance || r.left < -tolerance;
            if (!deborde) continue;

            // Un conteneur qui défile tout seul, c'est voulu, pas un défaut
            let parent = el.parentElement, gereParLuiMeme = false;
            while (parent && parent !== document.body) {
              const ps = getComputedStyle(parent);
              if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') { gereParLuiMeme = true; break; }
              parent = parent.parentElement;
            }
            const propre = getComputedStyle(el).overflowX;
            if (gereParLuiMeme || propre === 'auto' || propre === 'scroll') continue;

            coupables.push({
              balise: el.tagName.toLowerCase(),
              classe: (el.className || '').toString().split(' ').filter(Boolean).slice(0, 2).join('.'),
              largeur: Math.round(r.width),
              droite: Math.round(r.right)
            });
          }

          // Texte minuscule = illisible sur téléphone
          let texteTropPetit = 0;
          for (const el of document.querySelectorAll('p, span, li, label, td, a, div')) {
            if (!el.textContent.trim() || el.children.length) continue;
            const taille = parseFloat(getComputedStyle(el).fontSize);
            if (taille > 0 && taille < 11) texteTropPetit++;
          }

          return {
            largeurEcran,
            largeurDocument: document.documentElement.scrollWidth,
            debordement: document.documentElement.scrollWidth - largeurEcran,
            coupables: coupables.slice(0, 4),
            nbCoupables: coupables.length,
            texteTropPetit
          };
        }, TOLERANCE);

        controles++;
        const ok = mesure.debordement <= TOLERANCE && mesure.nbCoupables === 0 && erreursJs.length === 0;
        if (!ok) problemes++;

        let ligne = `  ${ok ? 'OK   ' : 'ECHEC'} ${appareil.nom.padEnd(24)} ${String(appareil.largeur).padStart(4)}px`;
        if (mesure.debordement > TOLERANCE) {
          ligne += `  deborde de ${mesure.debordement}px (${mesure.nbCoupables} element(s))`;
        }
        if (erreursJs.length) ligne += `  erreur JS`;
        if (mesure.texteTropPetit > 0) ligne += `  · ${mesure.texteTropPetit} texte(s) < 11px`;
        console.log(ligne);

        for (const c of mesure.coupables) {
          console.log(`         -> <${c.balise}${c.classe ? ' class="' + c.classe + '"' : ''}> large de ${c.largeur}px, bord droit a ${c.droite}px`);
        }
        for (const e of erreursJs.slice(0, 2)) {
          console.log(`         -> JS : ${e.split('\n')[0].slice(0, 90)}`);
        }

      } catch (err) {
        controles++; problemes++;
        console.log(`  ECHEC ${appareil.nom.padEnd(24)} ${String(appareil.largeur).padStart(4)}px  ${err.message.split('\n')[0].slice(0, 60)}`);
      } finally {
        await contexte.close();
      }
    }
  }

  await navigateur.close();

  console.log('\n' + '='.repeat(70));
  console.log(problemes === 0
    ? `Aucun débordement : ${controles} contrôles passés sur ${APPAREILS.length} formats.`
    : `${problemes} problème(s) sur ${controles} contrôles.`);
  process.exit(problemes === 0 ? 0 : 1);
})();

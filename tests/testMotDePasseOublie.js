/**
 * =============================================================================
 * RELAIS — LE PARCOURS « MOT DE PASSE OUBLIÉ »
 * =============================================================================
 *
 * Ce parcours était cassé : le lien envoyé par e-mail renvoyait vers la page de
 * connexion, où rien ne traitait le jeton de récupération. L'utilisateur
 * cliquait, arrivait sur un formulaire de connexion ordinaire, et n'avait
 * toujours pas de mot de passe.
 *
 *   npm run test:motdepasse [url]
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

(async () => {
  const navigateur = await chromium.launch();
  const suffixe = Date.now().toString().slice(-7);
  const email = `oubli.${suffixe}@gmail.com`;
  const ancienMdp = 'AncienMotDePasse2026';
  const nouveauMdp = 'NouveauMotDePasse2026';

  console.log(`\nMot de passe oublié — ${BASE}\n`);

  // --- Un compte jetable, pour ne pas toucher aux comptes de démonstration ---
  const inscription = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, password: ancienMdp,
      data: { full_name: 'Test Oubli', role: 'merchant', country: 'BJ', store_name: 'Boutique Oubli' }
    })
  }).then(r => r.json());

  if (!inscription.access_token) {
    console.log('Impossible de créer le compte de test :', inscription.msg);
    process.exit(1);
  }

  // --- 1. Un lien absent ou périmé -------------------------------------------
  console.log('1. Sans jeton valable');
  const ctx1 = await navigateur.newContext();
  const p1 = await ctx1.newPage();
  await p1.goto(`${BASE}/nouveau-mot-de-passe.html`, { waitUntil: 'networkidle' });
  await p1.waitForTimeout(1200);

  const sansJeton = await p1.evaluate(() => ({
    formulaireVisible: !document.getElementById('form-mot-de-passe').hidden,
    messageVisible: !document.getElementById('lien-invalide').hidden,
    texte: document.getElementById('sous-titre').textContent.trim()
  }));
  verifier('le formulaire reste fermé', !sansJeton.formulaireVisible);
  verifier("l'utilisateur est prévenu et renvoyé vers la connexion", sansJeton.messageVisible);
  await ctx1.close();

  // --- 2. Un lien expiré, tel que Supabase le renvoie ------------------------
  console.log('\n2. Avec un lien expiré');
  const ctx2 = await navigateur.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(
    `${BASE}/nouveau-mot-de-passe.html#error=access_denied&error_description=Email+link+is+invalid+or+has+expired`,
    { waitUntil: 'networkidle' }
  );
  await p2.waitForTimeout(1000);
  const expire = await p2.evaluate(() => !document.getElementById('lien-invalide').hidden);
  verifier('le lien expiré est reconnu comme tel', expire);
  await ctx2.close();

  // --- 3. Le vrai parcours ---------------------------------------------------
  console.log('\n3. Avec une session de récupération valable');
  const ctx3 = await navigateur.newContext();
  const p3 = await ctx3.newPage();
  await p3.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} },
    [`sb-${REF}-auth-token`, JSON.stringify(inscription)]);
  await p3.goto(`${BASE}/nouveau-mot-de-passe.html`, { waitUntil: 'networkidle' });
  await p3.waitForTimeout(1500);

  const avecSession = await p3.evaluate(() => ({
    formulaireVisible: !document.getElementById('form-mot-de-passe').hidden,
    texte: document.getElementById('sous-titre').textContent.trim()
  }));
  verifier('le formulaire s\'ouvre', avecSession.formulaireVisible);
  verifier("le compte concerné est nommé", avecSession.texte.includes(email), avecSession.texte);

  // Deux mots de passe différents
  await p3.fill('#mdp', nouveauMdp);
  await p3.fill('#mdp-confirm', 'PasLeMeme2026');
  await p3.click('#btn-valider');
  await p3.waitForTimeout(600);
  const discordance = await p3.evaluate(() => document.getElementById('retour').textContent);
  verifier('la discordance est signalée', /identiques/i.test(discordance), discordance);

  // Le vrai changement
  await p3.fill('#mdp', nouveauMdp);
  await p3.fill('#mdp-confirm', nouveauMdp);
  await p3.click('#btn-valider');

  // On attend le message lui-même, pas un délai arbitraire : la requête au
  // serveur peut prendre plus ou moins de temps selon la connexion.
  let succes = '';
  try {
    await p3.waitForFunction(
      () => /enregistré/i.test(document.getElementById('retour')?.textContent || ''),
      { timeout: 10000 }
    );
    succes = await p3.evaluate(() => document.getElementById('retour').textContent);
  } catch (e) {
    succes = await p3.evaluate(() => document.getElementById('retour')?.textContent || '(page déjà quittée)');
  }
  verifier('le mot de passe est enregistré', /enregistré/i.test(succes), succes.slice(0, 50));

  // Le serveur local sert app.html sous /app : on accepte les deux formes
  await p3.waitForTimeout(2500);
  const versApp = new RegExp('/app([.]html)?$').test(p3.url());
  verifier("l'espace membre s'ouvre ensuite", versApp, p3.url().split('/').pop());
  await ctx3.close();

  // --- 4. Le nouveau mot de passe fonctionne-t-il vraiment ? -----------------
  console.log('\n4. Vérification en conditions réelles');
  const connexion = async (mdp) => {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: mdp })
    });
    return (await r.json()).access_token ? 'accepté' : 'refusé';
  };

  verifier('le nouveau mot de passe ouvre le compte', await connexion(nouveauMdp) === 'accepté');
  verifier("l'ancien ne fonctionne plus", await connexion(ancienMdp) === 'refusé');

  await navigateur.close();

  console.log('\n' + '='.repeat(62));
  console.log(echecs === 0
    ? 'Un membre qui oublie son mot de passe peut réellement en changer.'
    : `${echecs} problème(s).`);
  console.log(`\nÀ nettoyer en base : le compte ${email}`);
  process.exit(echecs === 0 ? 0 : 1);
})();

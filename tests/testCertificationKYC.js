/**
 * =============================================================================
 * RELAIS — LE PARCOURS DE CERTIFICATION D'UNE AGENCE
 * =============================================================================
 *
 * C'est ce qui fait la valeur de l'annuaire : une agence n'y entre qu'après
 * qu'un humain a regardé ses papiers. Ce test vérifie la chaîne entière —
 * dépôt des pièces, examen par l'administrateur, entrée dans l'annuaire —
 * et surtout qu'aucune agence ne peut s'y inviter seule.
 *
 *   npm run test:kyc [url]
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = process.argv[2] || 'http://localhost:3000';
const SUPABASE_URL = 'https://uqusictqdviahnxpzylu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oe6V2dUMdFgAtMjSBi8-mg_olBmIxPr';
const REF = 'uqusictqdviahnxpzylu';
const MDP = 'RelaisDemo2026';

let echecs = 0;
function verifier(nom, condition, detail = '') {
  if (!condition) echecs++;
  console.log(`  ${condition ? 'OK   ' : 'ECHEC'} ${nom}${detail ? '  -> ' + detail : ''}`);
}

async function session(email, motDePasse = MDP) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: motDePasse })
  });
  return r.json();
}

async function ouvrir(navigateur, email, motDePasse) {
  const s = await session(email, motDePasse);
  if (!s.access_token) throw new Error(`connexion impossible pour ${email} : ${s.msg || ''}`);
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await contexte.newPage();
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} },
    [`sb-${REF}-auth-token`, JSON.stringify(s)]);
  await page.goto(`${BASE}/app.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  return page;
}

(async () => {
  const navigateur = await chromium.launch();
  const suffixe = Date.now().toString().slice(-7);
  const emailAgence = `agence.kyc.${suffixe}@gmail.com`;
  const nomAgence = `Agence Test KYC ${suffixe}`;

  console.log(`\nCertification d'une agence — ${BASE}\n`);

  // ---------------------------------------------------------------------------
  console.log('1. Une nouvelle agence candidate');
  const inscription = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: emailAgence, password: MDP,
      data: {
        full_name: 'Gérant Test', role: 'agency', country: 'SN',
        company_name: nomAgence, primary_city: 'Dakar',
        legal_registration_number: 'NINEA 0000000', fleet_size: 4
      }
    })
  }).then(r => r.json());
  verifier('le compte agence est créé', !!inscription.access_token);

  const page = await ouvrir(navigateur, emailAgence);

  const etatInitial = await page.evaluate(() => ({
    statut: window.state.profile?.agency?.status,
    ongletAgence: !document.getElementById('tab-btn-agence').style.display.includes('none'),
    ongletAnnuaire: document.getElementById('tab-btn-directory').style.display
  }));
  verifier("elle naît « en attente de vérification »", etatInitial.statut === 'pending_verification', etatInitial.statut);
  verifier("elle a bien un onglet « Mon Agence »", etatInitial.ongletAgence);
  verifier("elle n'a pas accès à l'annuaire", etatInitial.ongletAnnuaire === 'none');

  // ---------------------------------------------------------------------------
  console.log("\n2. Est-elle visible des e-commerçants avant validation ?");
  const marchand = await ouvrir(navigateur, 'marchand@demo.relais');
  const visibleAvant = await marchand.evaluate((n) =>
    window.state.agencies.some(a => a.name === n), nomAgence);
  verifier("invisible dans l'annuaire tant qu'elle n'est pas certifiée", visibleAvant === false);

  // ---------------------------------------------------------------------------
  console.log('3. Elle dépose une pièce justificative');
  await page.click('#tab-btn-agence');
  await page.waitForTimeout(700);

  const fichier = path.join(os.tmpdir(), `rccm-${suffixe}.pdf`);
  fs.writeFileSync(fichier, '%PDF-1.4\n% Document de test Relais\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  await page.setInputFiles('#kyc-fichier', fichier);
  await page.click('#btn-kyc-envoyer');
  await page.waitForTimeout(3000);

  const apresDepot = await page.evaluate(() =>
    document.getElementById('kyc-mes-pieces').textContent.includes('rccm-'));
  verifier('la pièce apparaît dans son dossier', apresDepot);

  // ---------------------------------------------------------------------------
  console.log("\n4. Peut-elle se certifier elle-même ?");
  const autoCertif = await page.evaluate(async () => {
    const { error } = await window.db.from('agencies')
      .update({ status: 'verified' })
      .eq('id', window.state.profile.agency.id);
    return error ? error.message : 'ACCEPTE';
  });
  verifier('auto-certification refusée', /administrateur/i.test(autoCertif), autoCertif.slice(0, 55));

  // ---------------------------------------------------------------------------
  console.log("\n5. L'administrateur examine le dossier");
  const admin = await ouvrir(navigateur, 'admin@demo.relais');
  await admin.click('#tab-btn-admin');
  await admin.waitForTimeout(2500);

  const vueAdmin = await admin.evaluate((n) => {
    const dossiers = [...document.querySelectorAll('.kyc-item')].map(d => d.textContent);
    const leNotre = dossiers.find(d => d.includes(n)) || '';
    return {
      present: !!leNotre,
      piecesVisibles: /rccm-/.test(leNotre),
      nbDossiers: dossiers.length
    };
  }, nomAgence);

  verifier('le dossier remonte dans la file', vueAdmin.present, `${vueAdmin.nbDossiers} dossier(s)`);
  verifier("l'administrateur voit la pièce déposée", vueAdmin.piecesVisibles);

  // ---------------------------------------------------------------------------
  console.log('\n6. Il certifie');
  admin.on('dialog', d => d.accept());
  const certifiee = await admin.evaluate(async (n) => {
    const agence = window.state.agencies.find(a => a.name === n);
    await window.approveAgencyKYC(agence.id);
    await new Promise(r => setTimeout(r, 1500));
    const apres = window.state.agencies.find(a => a.name === n);
    return apres?.statut;
  }, nomAgence);
  verifier("l'agence passe à « certifiée »", certifiee === 'verified', String(certifiee));

  // ---------------------------------------------------------------------------
  console.log("\n7. Le marchand la voit-il maintenant ?");
  await marchand.reload({ waitUntil: 'networkidle' });
  await marchand.waitForTimeout(2500);
  const visibleApres = await marchand.evaluate((n) =>
    window.state.agencies.some(a => a.name === n), nomAgence);
  verifier("elle entre dans l'annuaire après certification", visibleApres);

  await navigateur.close();
  try { fs.unlinkSync(fichier); } catch (e) {}

  console.log('\n' + '='.repeat(64));
  console.log(echecs === 0
    ? "Aucune agence n'entre dans l'annuaire sans qu'un humain ait vu ses papiers."
    : `${echecs} problème(s).`);
  console.log(`\nÀ nettoyer en base : le compte ${emailAgence}`);
  process.exit(echecs === 0 ? 0 : 1);
})();

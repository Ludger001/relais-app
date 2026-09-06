/**
 * =============================================================================
 * RELAIS — LE CYCLE COMPLET D'UNE COMMANDE, DANS UN VRAI NAVIGATEUR
 * =============================================================================
 *
 * C'est le produit lui-même qu'on vérifie ici : un e-commerçant passe un
 * ordre, l'agence reçoit les coordonnées du client, elle clôture sa tournée,
 * et le bilan financier se calcule tout seul — identique des deux côtés.
 *
 *   npm run test:commande [url]
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

async function ouvrirSession(navigateur, email) {
  const s = await session(email);
  if (!s.access_token) throw new Error(`connexion impossible pour ${email}`);
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await contexte.newPage();
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} },
    [`sb-${REF}-auth-token`, JSON.stringify(s)]);
  await page.goto(`${BASE}/app.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  return { contexte, page };
}

(async () => {
  const navigateur = await chromium.launch();
  const produit = `Test cycle ${Date.now().toString().slice(-6)}`;

  console.log(`\nCycle d'une commande — ${BASE}\n`);

  // ---------------------------------------------------------------------------
  console.log("1. L'e-commerçant passe un ordre de livraison");
  const marchand = await ouvrirSession(navigateur, 'marchand@demo.relais');

  await marchand.page.click('#tab-btn-chat');
  await marchand.page.waitForTimeout(600);
  await marchand.page.click('#btn-open-order-modal');
  await marchand.page.waitForTimeout(400);

  await marchand.page.fill('#order-product-name', produit);
  await marchand.page.fill('#order-product-qty', '2');
  await marchand.page.fill('#order-cod-amount', '30000');
  await marchand.page.fill('#order-delivery-fee', '2500');
  await marchand.page.fill('#order-recipient-name', 'M. Bamba Ibrahim');
  await marchand.page.fill('#order-recipient-phone', '05 91 44 22 07');
  await marchand.page.fill('#order-recipient-city', 'Marcory Zone 4');
  await marchand.page.fill('#order-recipient-address', 'Rue du Commerce, immeuble Sicogi');
  await marchand.page.click('#order-create-form button[type="submit"]');
  await marchand.page.waitForTimeout(3500);

  const vueMarchand = await marchand.page.evaluate((p) => {
    const cmd = window.state.orders.find(o => o.productName === p);
    return cmd ? { ref: cmd.id, statut: cmd.status, cod: cmd.codAmount, frais: cmd.deliveryFee } : null;
  }, produit);

  verifier('la commande est enregistrée', !!vueMarchand, vueMarchand?.ref);
  verifier('elle attend le ramassage', vueMarchand?.statut === 'pending');
  verifier('une référence a été attribuée par la base', /^REL-\d{4}-\d{5}$/.test(vueMarchand?.ref || ''));

  const carteVisible = await marchand.page.evaluate((p) =>
    [...document.querySelectorAll('.order-card-bubble')].some(c => c.textContent.includes(p)), produit);
  verifier('le bon de commande apparaît dans le fil', carteVisible);

  // ---------------------------------------------------------------------------
  console.log("\n2. L'agence reçoit-elle ce qu'il faut pour livrer ?");
  const agence = await ouvrirSession(navigateur, 'agence@demo.relais');
  await agence.page.click('#tab-btn-chat');
  await agence.page.waitForTimeout(1200);

  const vueAgence = await agence.page.evaluate((p) => {
    const cmd = window.state.orders.find(o => o.productName === p);
    const carte = [...document.querySelectorAll('.order-card-bubble')].find(c => c.textContent.includes(p));
    return {
      trouvee: !!cmd,
      telephone: cmd?.recipientPhone,
      adresse: cmd?.recipientAddress,
      telephoneAffiche: carte ? /05\s*91\s*44\s*22\s*07/.test(carte.textContent) : false,
      masque: carte ? /masqué/i.test(carte.textContent) : false
    };
  }, produit);

  verifier("l'agence voit la commande", vueAgence.trouvee);
  verifier('le téléphone du client lui parvient', vueAgence.telephone === '05 91 44 22 07', vueAgence.telephone);
  verifier("l'adresse lui parvient", !!vueAgence.adresse);
  verifier('le téléphone est affiché en clair dans le fil', vueAgence.telephoneAffiche);
  verifier("le filtre ne l'a pas masqué", !vueAgence.masque);

  // ---------------------------------------------------------------------------
  console.log('\n3. Le bilan avant clôture');
  await agence.page.click('#tab-btn-finance');
  await agence.page.waitForTimeout(900);
  await agence.page.selectOption('#finance-period-select', 'today');
  await agence.page.waitForTimeout(700);

  const bilanAvant = await agence.page.evaluate(() => ({
    encaisse: document.getElementById('kpi-total-collected').textContent,
    net: document.getElementById('kpi-net-payout').textContent
  }));
  console.log(`       encaissé ${bilanAvant.encaisse} · net ${bilanAvant.net}`);

  // ---------------------------------------------------------------------------
  console.log("\n4. L'agence clôture : « Livré & encaissé »");
  const clotureFaite = await agence.page.evaluate(async (p) => {
    const cmd = window.state.orders.find(o => o.productName === p);
    if (!cmd) return 'commande introuvable';
    await window.updateOrderStatus(cmd.id, 'delivered');
    const apres = window.state.orders.find(o => o.productName === p);
    return apres?.status;
  }, produit);
  await agence.page.waitForTimeout(1500);

  verifier('la commande passe à « livrée »', clotureFaite === 'delivered', String(clotureFaite));

  const bilanApres = await agence.page.evaluate(() => ({
    encaisse: document.getElementById('kpi-total-collected').textContent,
    frais: document.getElementById('kpi-total-fees').textContent,
    net: document.getElementById('kpi-net-payout').textContent
  }));
  console.log(`       encaissé ${bilanApres.encaisse} · frais ${bilanApres.frais} · net ${bilanApres.net}`);
  verifier('le bilan a bougé après la clôture', bilanApres.net !== bilanAvant.net);

  // ---------------------------------------------------------------------------
  console.log('\n5. Le marchand voit-il les mêmes chiffres ?');
  await marchand.page.reload({ waitUntil: 'networkidle' });
  await marchand.page.waitForTimeout(2000);
  await marchand.page.click('#tab-btn-finance');
  await marchand.page.waitForTimeout(900);
  await marchand.page.selectOption('#finance-period-select', 'today');
  await marchand.page.waitForTimeout(700);

  const bilanMarchand = await marchand.page.evaluate(() => ({
    encaisse: document.getElementById('kpi-total-collected').textContent,
    frais: document.getElementById('kpi-total-fees').textContent,
    net: document.getElementById('kpi-net-payout').textContent
  }));
  console.log(`       encaissé ${bilanMarchand.encaisse} · frais ${bilanMarchand.frais} · net ${bilanMarchand.net}`);

  verifier('même cash encaissé des deux côtés', bilanMarchand.encaisse === bilanApres.encaisse);
  verifier('même net à reverser des deux côtés', bilanMarchand.net === bilanApres.net);

  // ---------------------------------------------------------------------------
  console.log('\n6. Les chiffres sont-ils opposables une fois la livraison faite ?');
  const tentatives = await marchand.page.evaluate(async (p) => {
    const cmd = window.state.orders.find(o => o.productName === p);
    const essai = async (champs) => {
      const { error } = await window.db.from('orders').update(champs).eq('id', cmd.uuid);
      return error ? error.message : 'ACCEPTE';
    };
    return {
      montant:   await essai({ cod_amount: 300000 }),
      frais:     await essai({ delivery_fee: 0 }),
      reference: await essai({ order_code: 'REL-FAUX-0001' }),
      paiement:  await essai({ payout_status: 'paid' })
    };
  }, produit);

  verifier('le marchand ne peut pas gonfler le montant encaissé',
    /figées|figees/i.test(tentatives.montant), tentatives.montant.slice(0, 52));
  verifier('il ne peut pas annuler les frais de l\'agence',
    /figées|figees/i.test(tentatives.frais), tentatives.frais.slice(0, 52));
  verifier('il ne peut pas réécrire la référence',
    /référence|reference/i.test(tentatives.reference), tentatives.reference.slice(0, 52));
  verifier('il ne peut pas se déclarer payé',
    /reversement/i.test(tentatives.paiement), tentatives.paiement.slice(0, 52));

  // Le montant doit être resté celui d'origine
  const montantFinal = await marchand.page.evaluate(async (p) => {
    const cmd = window.state.orders.find(o => o.productName === p);
    const { data } = await window.db.from('orders').select('cod_amount').eq('id', cmd.uuid).single();
    return Number(data?.cod_amount);
  }, produit);
  verifier('le montant est resté intact', montantFinal === 30000, `${montantFinal} FCFA`);

  await navigateur.close();

  console.log('\n' + '='.repeat(64));
  console.log(echecs === 0
    ? 'Le cycle complet fonctionne, et les deux parties voient les mêmes chiffres.'
    : `${echecs} problème(s).`);
  process.exit(echecs === 0 ? 0 : 1);
})();

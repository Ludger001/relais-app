const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'app.js'), 'utf8');

// Faux element DOM : accepte tout ce que le code lui demande
function faireElement(id) {
  const el = {
    id, textContent: '', innerHTML: '', value: 'ALL', checked: false,
    style: {}, dataset: {}, classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){ return false; } },
    children: [], options: [], hidden: false, disabled: false, scrollTop: 0, scrollHeight: 0,
    addEventListener(){}, removeEventListener(){}, appendChild(){},
    setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    querySelectorAll(){ return []; }, querySelector(){ return null; },
    scrollIntoView(){}, focus(){}, reset(){}
  };
  return el;
}

const cache = {};
// switchTab bascule la messagerie en plein ecran via une classe sur body.
global.document = {
  body: faireElement('body'),
  addEventListener(){},
  getElementById(id) { return (cache[id] = cache[id] || faireElement(id)); },
  querySelectorAll(){ return []; },
  querySelector(){ return null; },
  createElement(){ return faireElement('tmp'); }
};
// La messagerie adapte son comportement au format de l'ecran ; hors navigateur,
// on repond « ce n'est pas un telephone ».
global.window = {
  location: { href: '' },
  matchMedia: () => ({ matches: false, addEventListener(){}, removeEventListener(){} })
};
global.alert = () => {};

// Supabase absent : on simule un client qui renvoie une liste vide
const requete = {
  select(){ return this; },
  eq(){ return this; },
  order(){ return Promise.resolve({ data: [], error: null }); },
  maybeSingle(){ return Promise.resolve({ data: null, error: null }); }
};
global.db = { from(){ return requete; }, auth: { getSession: async () => ({ data:{session:null}, error:null }) } };
global.inspectAndSanitizeMessage = (t) => ({ isBlocked:false, cleanText:t, violations:[] });
global.exigerConnexion = async () => null;
global.seDeconnecter = () => {};

const app = new Function(src + `
  return { state, chargerAgences, renderAgencies, renderConversationsSidebar,
           renderActiveChat, renderOrdersStrip, renderFinanceView,
           setupAdminPanel, setupChat, setupModals, setupTabNavigation,
           setupCountryFilters, setupOrdersAndFinance, appliquerProfil };
`)();

let echecs = 0;
async function essai(nom, fn) {
  try { await fn(); console.log('OK    ' + nom); }
  catch (e) { echecs++; console.log('PLANTE ' + nom + ' -> ' + e.message); }
}

(async () => {
  console.log('--- base vide, marchand connecte ---');
  await essai('appliquerProfil', () => app.appliquerProfil({ full_name:'Aya', role:'merchant', email:'a@b.c', merchant:{store_name:'Boutique'} }));
  await essai('chargerAgences', () => app.chargerAgences());
  await essai('renderAgencies', () => app.renderAgencies());
  await essai('renderConversationsSidebar', () => app.renderConversationsSidebar());
  await essai('renderActiveChat', () => app.renderActiveChat());
  await essai('renderOrdersStrip', () => app.renderOrdersStrip());
  await essai('renderFinanceView', () => app.renderFinanceView());
  await essai('setupChat', () => app.setupChat());
  await essai('setupAdminPanel', () => app.setupAdminPanel());
  await essai('setupModals', () => app.setupModals());
  await essai('setupTabNavigation', () => app.setupTabNavigation());
  await essai('setupCountryFilters', () => app.setupCountryFilters());
  await essai('setupOrdersAndFinance', () => app.setupOrdersAndFinance());

  console.log('\n--- role agence ---');
  await essai('appliquerProfil agence', () => app.appliquerProfil({ full_name:'Ibrahim', role:'agency', email:'x@y.z', agency:{status:'verified', company_name:'Ivoire Express'} }));
  await essai('renderFinanceView agence', () => app.renderFinanceView());

  console.log(echecs === 0 ? '\nAUCUN PLANTAGE' : `\n${echecs} PLANTAGE(S)`);
  process.exit(echecs === 0 ? 0 : 1);
})();

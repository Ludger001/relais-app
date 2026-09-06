const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'public', 'app.js'), 'utf8');

const ONGLETS = ['directory','chat','agence','finance','compte','admin'];
const boutons = {}, panneaux = {};
function el(extra={}) {
  return Object.assign({
    textContent:'', innerHTML:'', value:'ALL', style:{}, dataset:{}, hidden:false, disabled:false,
    classList:{ _s:new Set(), add(c){this._s.add(c);}, remove(c){this._s.delete(c);}, contains(c){return this._s.has(c);} },
    children:[], options:[], scrollTop:0, scrollHeight:0,
    addEventListener(){}, querySelectorAll(){return [];}, querySelector(){return null;},
    scrollIntoView(){}, focus(){}, reset(){}
  }, extra);
}
ONGLETS.forEach(t => { boutons[t] = el({ dataset:{tab:t} }); panneaux[t] = el({ id:'view-'+t }); });

const cache = {};
global.document = {
  addEventListener(){},
  getElementById(id){
    const m = id.match(/^view-(.+)$/); if (m && panneaux[m[1]]) return panneaux[m[1]];
    const b = id.match(/^tab-btn-(.+)$/); if (b && boutons[b[1]]) return boutons[b[1]];
    return (cache[id] = cache[id] || el());
  },
  querySelectorAll(sel){
    if (sel === '.tab-item') return Object.values(boutons);
    if (sel === '.tab-panel') return Object.values(panneaux);
    return [];
  },
  querySelector(sel){ const m = sel.match(/data-tab="([^"]+)"/); return m ? boutons[m[1]] : null; }
};
global.window = { location:{href:''} };
const req = { select(){return this;}, eq(){return this;}, order(){return Promise.resolve({data:[],error:null});}, maybeSingle(){return Promise.resolve({data:null,error:null});} };
global.db = { from(){return req;} };
global.inspectAndSanitizeMessage = t => ({isBlocked:false,cleanText:t,violations:[]});
global.exigerConnexion = async () => null;
global.seDeconnecter = () => {};

const app = new Function(src + 'return { state, appliquerProfil, switchTab, ONGLETS_PAR_ROLE };')();

let ko = 0;
function verifier(role, attendus) {
  app.appliquerProfil({ full_name:'X', email:'x@y.z', role, merchant:{}, agency:{status:'verified'} });
  console.log(`\n--- role : ${role} ---`);
  ONGLETS.forEach(t => {
    const visible = boutons[t].style.display !== 'none';
    const doitEtreVisible = attendus.includes(t);
    const ok = visible === doitEtreVisible;
    if (!ok) ko++;
    console.log(`  ${ok?'OK   ':'ECHEC'} onglet ${t.padEnd(10)} ${visible?'visible':'masque '} (attendu ${doitEtreVisible?'visible':'masque'})`);
  });
  // Tentative de forcage depuis la console
  ONGLETS.filter(t => !attendus.includes(t)).forEach(t => {
    Object.values(panneaux).forEach(p => p.classList.remove('active'));
    app.switchTab(t);
    const ouvert = panneaux[t].classList.contains('active');
    if (ouvert) ko++;
    console.log(`  ${ouvert?'ECHEC':'OK   '} forcage switchTab('${t}') -> ${ouvert?'OUVERT !':'refuse'}`);
  });
}

verifier('merchant', ['directory','chat','finance','compte']);
verifier('agency',   ['chat','agence','finance','compte']);
verifier('admin',    ['directory','chat','finance','admin']);

console.log(ko === 0 ? '\nTOUT EST CONFORME' : `\n${ko} PROBLEME(S)`);
process.exit(ko === 0 ? 0 : 1);

/**
 * =============================================================================
 * RELAIS — RIEN DE CE QU'ÉCRIT UN MEMBRE NE DEVIENT DU HTML
 * =============================================================================
 *
 * Le 2026-09-06, le journal de sécurité et les bulles de discussion inséraient
 * le texte d'un membre directement dans innerHTML. Un marchand pouvait donc
 * faire exécuter du code dans la session de l'agence, et surtout dans celle de
 * l'administrateur — la plus privilégiée de la plateforme.
 *
 * Deux vérifications, l'une statique, l'autre réelle :
 *
 *   1. echapperHtml() neutralise-t-il ce qu'on lui donne ?
 *   2. les champs remplis par un membre passent-ils tous par lui avant
 *      d'atteindre un gabarit HTML ?
 *
 * Le contrôle 2 relit le code source. C'est volontaire : une charge utile
 * d'attaque ne prouve que le cas qu'elle teste, alors qu'un oubli sur un champ
 * jamais testé rouvrirait la porte en silence.
 *
 *   node tests/testEchappement.js
 */

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', 'public');
const appJs = fs.readFileSync(path.join(RACINE, 'app.js'), 'utf8');
const tbJs = fs.readFileSync(path.join(RACINE, 'lib', 'tableauDeBord.js'), 'utf8');

let ko = 0;
const verifier = (ok, libelle, detail) => {
  if (!ok) ko++;
  console.log(`  ${ok ? 'OK   ' : 'ECHEC'} ${libelle}`);
  if (!ok && detail) console.log(`         -> ${detail}`);
};

// -----------------------------------------------------------------------------
// 1. La fonction elle-même
// -----------------------------------------------------------------------------
console.log('\n--- echapperHtml ---');

/** On extrait la fonction du fichier réel, pour tester ce qui tourne vraiment. */
function extraireFonction(source, nom) {
  const debut = source.indexOf(`function ${nom}`);
  if (debut < 0) throw new Error(`${nom} introuvable dans app.js`);
  // La fonction est déclarée au premier niveau : son accolade fermante est
  // la première ligne réduite à « } ».
  const reste = source.slice(debut);
  const fin = reste.indexOf('\n}\n');
  if (fin < 0) throw new Error(`fin de ${nom} introuvable`);
  return reste.slice(0, fin + 2);
}

const echapperHtml = new Function(
  extraireFonction(appJs, 'echapperHtml') + `\nreturn echapperHtml;`
)();

const charges = [
  ['<img src=x onerror="alert(1)">', '<img'],
  ["<script>alert('x')</script>", '<script'],
  ['" onmouseover="alert(1)', '"'],
  ["' onfocus='alert(1)", "'"],
  ['<a href="javascript:alert(1)">clic</a>', '<a ']
];

for (const [charge, interdit] of charges) {
  const sortie = echapperHtml(charge);
  verifier(!sortie.includes(interdit),
    `« ${charge.slice(0, 32)}… » ne ressort plus comme du balisage`,
    `sortie : ${sortie}`);
}

verifier(echapperHtml('Dupont & Fils') === 'Dupont &amp; Fils',
  'une esperluette légitime reste lisible');
verifier(echapperHtml(null) === '' && echapperHtml(undefined) === '',
  'une valeur absente ne produit pas « null »');

// -----------------------------------------------------------------------------
// 2. Les champs remplis par un membre, un par un
// -----------------------------------------------------------------------------
console.log('\n--- Les champs saisis par un membre atteignent-ils innerHTML en clair ? ---');

/**
 * Chaque entrée est une expression telle qu'elle apparaîtrait dans un gabarit
 * si personne ne l'avait échappée. Sa seule présence est le défaut.
 */
const CHAMPS = {
  'app.js': [
    // Le contenu d'un message, écrit par l'autre partie
    ['m.text', 'corps d\'un message'],
    ['lastMsg', 'aperçu du dernier message'],
    // Le journal de sécurité rejoue le texte intercepté
    ['log.tentative', 'texte intercepté par le filtre'],
    ['log.pattern', 'motif de détection'],
    ['log.user', 'adresse du membre signalé'],
    // Les fiches remplies à l'inscription
    ['agency.name', "nom de l'agence"],
    ['agency.city', "ville de l'agence"],
    ['agency.legalId', 'identifiant fiscal déclaré'],
    // Le bon de commande, saisi par le marchand
    ['order.recipientName', 'nom du destinataire'],
    ['order.recipientPhone', 'téléphone du destinataire'],
    ['order.recipientAddress', 'adresse du destinataire'],
    ['order.productName', 'désignation du produit'],
    // Le nom d'un fichier est choisi par celui qui le dépose
    ['f.name', 'nom de pièce déposée']
  ],
  'lib/tableauDeBord.js': [
    ['v.tentative', 'texte intercepté, tableau de bord'],
    ['v.user', 'adresse du membre, tableau de bord'],
    ['v.pattern', 'motif de détection, tableau de bord']
  ]
};

const SOURCES = { 'app.js': appJs, 'lib/tableauDeBord.js': tbJs };

/**
 * Le même champ peut apparaître dans un gabarit HTML — dangereux — ou dans un
 * confirm() et un textContent, où il ne sera jamais interprété. On ne signale
 * donc une occurrence que si le gabarit qui la contient produit du balisage.
 */
function dansUnGabaritHtml(source, position) {
  const ouvrant = source.lastIndexOf('`', position);
  if (ouvrant < 0) return false;
  const fermant = source.indexOf('`', position);
  if (fermant < 0) return false;
  return /<[a-zA-Z/]/.test(source.slice(ouvrant, fermant));
}

for (const [fichier, champs] of Object.entries(CHAMPS)) {
  const source = SOURCES[fichier];
  for (const [champ, quoi] of champs) {
    const motif = new RegExp('\\$\\{\\s*' + champ.replace('.', '\\.') + '\\s*[.}]', 'g');
    const brut = [];
    let m;
    while ((m = motif.exec(source)) !== null) {
      if (!dansUnGabaritHtml(source, m.index)) continue;
      brut.push(source.slice(0, m.index).split('\n').length);
    }
    verifier(brut.length === 0,
      `${fichier} — ${quoi}`,
      brut.length ? `« \${${champ}} » en clair, ligne(s) ${brut.join(', ')}` : '');
  }
}

// -----------------------------------------------------------------------------
// 3. Le motif technique du filtre ne doit plus s'afficher tel quel
// -----------------------------------------------------------------------------
console.log('\n--- Le journal parle-t-il français ? ---');

verifier(appJs.includes('traduireDetection(v.detected_pattern)'),
  'le motif est traduit à la source, au chargement du journal');
verifier(!tbJs.includes('function traduireDetection'),
  'la traduction n\'est pas dupliquée dans le tableau de bord');

console.log('\n' + '='.repeat(70));
console.log(ko === 0
  ? "Rien de ce qu'écrit un membre n'atteint innerHTML sans échappement."
  : `${ko} problème(s).`);
process.exit(ko === 0 ? 0 : 1);

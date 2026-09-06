/**
 * Le filtre existe en deux exemplaires : celui du navigateur, qui donne un
 * retour immédiat à l'utilisateur, et celui du serveur, qui fait foi.
 *
 * S'ils divergent, le retour affiché ment. Cette copie est donc GÉNÉRÉE,
 * jamais éditée à la main. Le test testFiltreSynchronise.js échoue si le
 * fichier serveur n'est plus le reflet exact du fichier navigateur.
 */
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'public', 'lib', 'antiBypassFilter.js');
const CIBLE  = path.join(__dirname, '..', 'supabase', 'functions', 'envoyer-message', 'filtre.js');

const ENTETE = `// ===========================================================================
// FICHIER GÉNÉRÉ — NE PAS MODIFIER À LA MAIN
// Source : public/lib/antiBypassFilter.js
// Régénérer avec : npm run filtre:generer
// ===========================================================================

`;

const PIED = `
export { inspectAndSanitizeMessage, normalizeText };
`;

function corpsSource() {
  const brut = fs.readFileSync(SOURCE, 'utf8');
  // On retire l'export CommonJS, inutile côté Deno
  return brut.replace(/if \(typeof module[\s\S]*$/m, '').trimEnd() + '\n';
}

function contenuAttendu() {
  return ENTETE + corpsSource() + PIED;
}

if (require.main === module) {
  fs.writeFileSync(CIBLE, contenuAttendu());
  console.log('filtre serveur regenere depuis ' + path.relative(process.cwd(), SOURCE));
}

module.exports = { contenuAttendu, CIBLE };

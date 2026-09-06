/**
 * =============================================================================
 * RELAIS — LES DEUX FILTRES DISENT-ILS LA MÊME CHOSE ?
 * =============================================================================
 *
 * Le filtre existe en deux exemplaires :
 *   - public/lib/antiBypassFilter.js          → prévient l'utilisateur
 *   - supabase/functions/envoyer-message/     → décide réellement
 *
 * S'ils divergent, l'avertissement affiché ment : l'utilisateur croit son
 * message accepté alors que le serveur le masquera, ou l'inverse.
 *
 * Ce test compare les règles elles-mêmes — mots-clés, formats de numéros,
 * chiffres en lettres, logique de masquage — en ignorant les commentaires.
 */

const fs = require('fs');
const path = require('path');

const NAVIGATEUR = path.join(__dirname, '..', 'public', 'lib', 'antiBypassFilter.js');
const SERVEUR    = path.join(__dirname, '..', 'supabase', 'functions', 'envoyer-message', 'filtre.js');

/**
 * Ne garde que ce qui change le comportement : on retire les commentaires,
 * les lignes vides, et les deux formes d'export qui diffèrent par nature
 * (CommonJS pour le navigateur, ESM pour Deno).
 */
function reglesSeules(chemin) {
  return fs.readFileSync(chemin, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')      // commentaires de bloc
    .replace(/^\s*\/\/.*$/gm, '')          // commentaires de ligne
    .replace(/if \(typeof module[\s\S]*$/m, '')  // export CommonJS
    .replace(/^export \{[\s\S]*$/m, '')          // export ESM
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n');
}

let echecs = 0;

console.log('\nSynchronisation des deux filtres\n');

if (!fs.existsSync(SERVEUR)) {
  console.log("  ECHEC le filtre serveur n'existe pas. Lancez : npm run filtre:generer");
  process.exit(1);
}

const regleNavigateur = reglesSeules(NAVIGATEUR);
const regleServeur    = reglesSeules(SERVEUR);

if (regleNavigateur === regleServeur) {
  console.log('  OK    les règles sont identiques des deux côtés');
} else {
  echecs++;
  console.log('  ECHEC les règles ont divergé');

  const a = regleNavigateur.split('\n');
  const b = regleServeur.split('\n');
  let montrees = 0;
  for (let i = 0; i < Math.max(a.length, b.length) && montrees < 6; i++) {
    if (a[i] !== b[i]) {
      montrees++;
      console.log(`\n        ligne ${i + 1}`);
      console.log(`        navigateur : ${a[i] ?? '(absente)'}`);
      console.log(`        serveur    : ${b[i] ?? '(absente)'}`);
    }
  }
  console.log('\n        Régénérez le filtre serveur : npm run filtre:generer');
  console.log('        puis redéployez la fonction envoyer-message.');
}

// Vérification complémentaire : le fichier serveur doit rester généré
const entete = fs.readFileSync(SERVEUR, 'utf8').slice(0, 200);
if (!entete.includes('FICHIER GÉNÉRÉ')) {
  echecs++;
  console.log("  ECHEC l'en-tête « FICHIER GÉNÉRÉ » a disparu : le fichier a été édité à la main");
} else {
  console.log('  OK    le fichier serveur porte bien son avertissement de génération');
}

console.log(echecs === 0 ? '\nLes deux filtres sont alignés.\n' : `\n${echecs} problème(s).\n`);
process.exit(echecs === 0 ? 0 : 1);

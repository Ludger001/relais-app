const { inspectAndSanitizeMessage } = require('../public/lib/antiBypassFilter');

const testCases = [
  {
    name: "Message légitime sans numéro",
    input: "Bonjour, j'ai 15 commandes de gel visage à livrer à Cotonou et Abidjan. Quels sont vos délais de reversement COD ?",
    shouldBlock: false
  },
  {
    name: "Bénin - Nouveau format 10 chiffres (ARCEP 30 nov 2024)",
    input: "Mon contact à Cotonou est le 229 01 67 53 57 41, appelle-moi",
    shouldBlock: true
  },
  {
    name: "Bénin - Format local 10 chiffres (01 XX XX XX XX)",
    input: "Contacte-moi sur le 01 97 88 12 34",
    shouldBlock: true
  },
  {
    name: "Côte d'Ivoire - 10 chiffres (ARTCI)",
    input: "Voici mon numéro : 07 45 12 89 00 pour convenir des colis",
    shouldBlock: true
  },
  {
    name: "Gabon - Nouveau format 9 chiffres (ARCEP 6 avril 2024)",
    input: "Joins mon responsable à Libreville au 062 44 55 66",
    shouldBlock: true
  },
  {
    name: "Sénégal - 9 chiffres (ARTP)",
    input: "Mon numéro Orange Money à Dakar : 77 654 32 10",
    shouldBlock: true
  },
  {
    name: "Togo - 8 chiffres (ARCEP Togo)",
    input: "Je suis joignable au 90 12 34 56 à Lomé",
    shouldBlock: true
  },
  {
    name: "Lien WhatsApp direct",
    input: "Rejoins mon groupe wa.me/2290167535741 pour discuter",
    shouldBlock: true
  },
  {
    name: "Numéro en lettres (obfuscation)",
    input: "mon contact c'est zero un soixante sept cinquante trois cinquante sept quarante un",
    shouldBlock: true
  }
];

console.log("=== VÉRIFICATION DU BOUCLIER ANTI-DÉSINTERMÉDIATION RELAIS ===");
console.log("=== (Plans de numérotation ARCEP Bénin, Togo, CI, Gabon, Sénégal) ===\n");

let passed = 0;
for (const tc of testCases) {
  const result = inspectAndSanitizeMessage(tc.input);
  const success = result.isBlocked === tc.shouldBlock;
  if (success) {
    passed++;
    console.log(`✅ [PASS] ${tc.name}`);
    if (result.isBlocked) {
      console.log(`   Texte assaini : "${result.cleanText}"`);
    }
  } else {
    console.log(`❌ [FAIL] ${tc.name}`);
    console.log(`   Attendu: isBlocked = ${tc.shouldBlock}, Obtenu: ${result.isBlocked}`);
  }
  console.log("---------------------------------------------------------------");
}

console.log(`\nBilan : ${passed}/${testCases.length} tests validés avec succès.`);

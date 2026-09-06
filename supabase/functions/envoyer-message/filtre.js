// ===========================================================================
// FICHIER GÉNÉRÉ — NE PAS MODIFIER À LA MAIN
// Source : public/lib/antiBypassFilter.js
// Régénérer avec : npm run filtre:generer
// ===========================================================================

/**
 * =============================================================================
 * SAAS RELAIS — MOTEUR DE DÉTECTION & BOUCLIER ANTI-DÉSINTERMÉDIATION
 * MIS À JOUR AVEC LES RÉCENTES RÉFORMES DE NUMÉROTATION EN AFRIQUE (2024-2026)
 * =============================================================================
 * 
 * Réalités réglementaires actuelles :
 * 1. BÉNIN (ARCEP Bénin - Réforme du 30 nov 2024) :
 *    - Passage à 10 chiffres avec préfixe '01' obligatoire (ex: 01 67 53 57 41).
 *    - Format international : +229 01 XX XX XX XX (ou 229 01...).
 * 
 * 2. CÔTE D'IVOIRE (ARTCI - Réforme 10 chiffres) :
 *    - 10 chiffres commençant par 01 (Moov), 05 (MTN), 07 (Orange), 21/25/27 (Fixe).
 *    - Format international : +225 0X XX XX XX XX.
 * 
 * 3. GABON (ARCEP Gabon - Réforme du 6 avril 2024) :
 *    - Format national à 9 chiffres : 062/066 (Moov), 074/077 (Airtel), 011 (Fixe).
 *    - Format international : +241 (0)6X XX XX XX / +241 (0)7X XX XX XX.
 * 
 * 4. SÉNÉGAL (ARTP) :
 *    - Format national à 9 chiffres : 77/78 (Orange), 76 (Free), 70 (Expresso), 75 (Promobile), 33 (Fixe).
 *    - Format international : +221 7X XXX XX XX.
 * 
 * 5. TOGO (ARCEP Togo) :
 *    - Format national maintenu à 8 chiffres : 90/91/92/93/96/97/98/99 (Togocel), 70/79 (Moov).
 *    - Format international : +228 XX XX XX XX.
 */

// 1. Remplacement des chiffres écrits en lettres (français) pour contrer l'obfuscation
const FRENCH_NUMBER_WORDS = {
  'zero': '0', 'zéro': '0',
  'un': '1', 'une': '1',
  'deux': '2',
  'trois': '3',
  'quatre': '4',
  'cinq': '5',
  'six': '6',
  'sept': '7',
  'huit': '8',
  'neuf': '9',
  'dix': '10',
  'onze': '11',
  'douze': '12',
  'treize': '13',
  'quatorze': '14',
  'quinze': '15',
  'seize': '16',
  'vingt': '20',
  'trente': '30',
  'quarante': '40',
  'cinquante': '50',
  'soixante': '60',
  'cent': '100'
};

// 2. Mots-clés et protocoles de redirection externe interdits
const EXTERNAL_REDIRECT_KEYWORDS = [
  /wa\.me\b/i,
  /api\.whatsapp\.com/i,
  /whatsapp/i,
  /whatsap/i,
  /watsap/i,
  /whatapp/i,
  /watshapp/i,
  /telegram/i,
  /t\.me\b/i,
  /viber/i,
  /signal/i,
  /appelle[\s\-_]*moi/i,
  /contacte[\s\-_]*moi\s+(sur|au|directement)/i,
  /mon\s+(numéro|numero|num|contact|tel|phone|cel)/i,
  /sur\s+mon\s+(tel|phone|portable|direct)/i
];

// 3. Patterns précis de numéros pour les 5 pays + filet de sécurité générique
const PHONE_PATTERNS = [
  // --- BÉNIN (10 CHIFFRES AVEC 01 + FORMAT INTERNATIONAL 229 01...) ---
  /(?:(?:\+|00)?\s*229)[\s.\-_/]*01[\s.\-_/]*(?:\d[\s.\-_/]*){8}\b/g,
  /\b01[\s.\-_/]*(?:9[0-9]|6[0-9]|5[0-9]|4[0-9]|7[0-9])[\s.\-_/]*(?:\d[\s.\-_/]*){6}\b/g,
  // Rétrocompatibilité : si un utilisateur écrit encore l'ancien format 8 chiffres Bénin
  /(?:(?:\+|00)?\s*229)[\s.\-_/]*(?:9[0-9]|6[0-9]|5[0-9]|4[0-9]|7[0-9])[\s.\-_/]*(?:\d[\s.\-_/]*){6}\b/g,

  // --- CÔTE D'IVOIRE (10 CHIFFRES DÉMARRANT PAR 01, 05, 07, 21, 25, 27) ---
  /(?:(?:\+|00)?\s*225)[\s.\-_/]*(?:01|05|07|21|25|27)[\s.\-_/]*(?:\d[\s.\-_/]*){8}\b/g,
  /\b(?:01|05|07|21|25|27)[\s.\-_/]*(?:\d[\s.\-_/]*){8}\b/g,

  // --- GABON (9 CHIFFRES NOUVEAU PLAN 2024 : 062, 066, 074, 077, 011...) ---
  /(?:(?:\+|00)?\s*241)[\s.\-_/]*(?:0)?(?:62|66|74|77|11)[\s.\-_/]*(?:\d[\s.\-_/]*){6}\b/g,
  /\b(?:062|066|074|077|011)[\s.\-_/]*(?:\d[\s.\-_/]*){6}\b/g,

  // --- SÉNÉGAL (9 CHIFFRES : 70, 75, 76, 77, 78, 33) ---
  /(?:(?:\+|00)?\s*221)[\s.\-_/]*(?:70|75|76|77|78|33)[\s.\-_/]*(?:\d[\s.\-_/]*){7}\b/g,
  /\b(?:70|75|76|77|78|33)[\s.\-_/]*(?:\d[\s.\-_/]*){7}\b/g,

  // --- TOGO (8 CHIFFRES : 90-93, 96-99, 70, 79) ---
  /(?:(?:\+|00)?\s*228)[\s.\-_/]*(?:9[0-3]|9[6-9]|70|79)[\s.\-_/]*(?:\d[\s.\-_/]*){6}\b/g,
  /\b(?:9[0-3]|9[6-9]|70|79)[\s.\-_/]*(?:\d[\s.\-_/]*){6}\b/g,

  // --- FILET DE SÉCURITÉ UNIVERSEL (TOUTE SUITE DE 7 À 12 CHIFFRES AVEC OU SANS SÉPARATEURS) ---
  /(?:\b\d[\s.\-_/]*){8,12}\b/g,

  // Obfuscation avec séparateurs répétés ou parenthèses
  /\(?\d\)?[\s.\-_/]*\(?\d\)?[\s.\-_/]*\(?\d\)?[\s.\-_/]*\(?\d\)?[\s.\-_/]*\(?\d\)?[\s.\-_/]*\(?\d\)?[\s.\-_/]*\(?\d\)?[\s.\-_/]*\(?\d\)?/g
];

const MASQUE_CONTACT = '[Information de contact masquée par sécurité Relais]';
const MASQUE_NUMERO  = '[Numéro masqué par sécurité Relais]';
const MASQUE_TOTAL   = '[Message masqué : les coordonnées directes sont interdites sur Relais]';

/**
 * Une expression régulière portant le drapeau /g retient sa position entre
 * deux appels à .test(). Réutiliser les objets définis plus haut rendait donc
 * le filtrage dépendant de ce qui avait été analysé avant : le même message
 * pouvait être masqué différemment d'un envoi à l'autre.
 *
 * On travaille sur une copie neuve à chaque usage : le filtre devient sans
 * mémoire, donc reproductible.
 */
function regexNeuve(modele) {
  return new RegExp(modele.source, modele.flags);
}

/**
 * Révèle l'obfuscation textuelle en convertissant les chiffres écrits en lettres.
 */
function normalizeText(text) {
  let normalized = text.toLowerCase();
  for (const [word, digit] of Object.entries(FRENCH_NUMBER_WORDS)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    normalized = normalized.replace(regex, ` ${digit} `);
  }
  return normalized;
}

/**
 * Assainit et contrôle les messages échangés.
 *
 * Règle métier : le contact du client final circule par le bon de commande,
 * jamais par la conversation. Tout ce qui ressemble à un numéro ou à une
 * redirection vers un canal externe est donc masqué ici.
 */
function inspectAndSanitizeMessage(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    return { isBlocked: false, originalText: '', cleanText: '', violations: [] };
  }

  const violations = [];
  let sanitized = messageText;

  // 1. Redirections vers un canal externe (WhatsApp, Telegram, « appelle-moi »…)
  for (const modele of EXTERNAL_REDIRECT_KEYWORDS) {
    const regex = regexNeuve(modele);
    if (regex.test(sanitized)) {
      violations.push(`Canal externe détecté : ${modele.source}`);
      sanitized = sanitized.replace(regexNeuve(modele), MASQUE_CONTACT);
    }
  }

  // 2. Numéros écrits en chiffres
  for (const modele of PHONE_PATTERNS) {
    const regex = regexNeuve(modele);
    if (regex.test(sanitized)) {
      violations.push('Numéro ou suite de chiffres détectée');
      sanitized = sanitized.replace(regexNeuve(modele), MASQUE_NUMERO);
    }
  }

  // 3. Numéros dissimulés en toutes lettres (« zéro un soixante-sept… »)
  //
  //    On ne peut pas remonter des positions du texte normalisé vers le texte
  //    d'origine : « soixante-sept » fait deux chiffres et treize caractères.
  //    Le message entier est donc masqué.
  //
  //    Ce masquage était auparavant conditionné à l'absence de toute autre
  //    violation. Conséquence : « mon contact c'est zéro un soixante sept… »
  //    ne masquait que « mon contact » et transmettait le numéro en clair,
  //    précisément le cas que ce filtre doit empêcher.
  //    On normalise le texte DÉJÀ assaini, pas l'original : sinon un numéro
  //    en chiffres, pourtant correctement masqué à l'étape 2, déclencherait
  //    encore cette étape et emporterait tout le message avec lui.
  const normalized = normalizeText(sanitized);
  for (const modele of PHONE_PATTERNS) {
    if (regexNeuve(modele).test(normalized)) {
      violations.push('Numéro dissimulé en lettres détecté');
      sanitized = MASQUE_TOTAL;
      break;
    }
  }

  return {
    isBlocked: violations.length > 0,
    originalText: messageText,
    cleanText: sanitized,
    violations: violations
  };
}

export { inspectAndSanitizeMessage, normalizeText };

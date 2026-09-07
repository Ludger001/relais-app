/**
 * =============================================================================
 * RELAIS — GÉNÉRATION DES ICÔNES D'APPLICATION
 * =============================================================================
 *
 * Une application installable — sur l'écran d'accueil d'un téléphone, puis dans
 * les magasins via un emballage Capacitor — doit fournir ses icônes en PNG.
 * Le logo du site est un SVG : il n'est pas accepté comme icône d'application.
 *
 * Ce script les dessine sans aucune dépendance : il encode le PNG lui-même.
 * Installer une bibliothèque d'images pour quatre carrés de couleur unie serait
 * disproportionné, et rendrait le dépôt dépendant d'un paquet de plus.
 *
 * Le dessin reprend la marque de l'en-tête : trois losanges empilés, blancs,
 * sur le vert Relais.
 *
 *   node scripts/genererIcones.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SORTIE = path.join(__dirname, '..', 'public', 'assets');

const VERT = [5, 150, 105];        // #059669, la couleur de marque
const BLANC = [255, 255, 255];

// -----------------------------------------------------------------------------
// Encodage PNG minimal (RVB, 8 bits)
// -----------------------------------------------------------------------------
const tableCrc = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const octet of buf) c = tableCrc[(c ^ octet) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function bloc(type, donnees) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);
  const typeEtDonnees = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const controle = Buffer.alloc(4);
  controle.writeUInt32BE(crc32(typeEtDonnees));
  return Buffer.concat([longueur, typeEtDonnees, controle]);
}

function encoderPng(largeur, hauteur, pixels) {
  const brut = Buffer.alloc((largeur * 3 + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) {
    brut[y * (largeur * 3 + 1)] = 0;               // filtre « aucun »
    for (let x = 0; x < largeur; x++) {
      const source = (y * largeur + x) * 3;
      const cible = y * (largeur * 3 + 1) + 1 + x * 3;
      brut[cible] = pixels[source];
      brut[cible + 1] = pixels[source + 1];
      brut[cible + 2] = pixels[source + 2];
    }
  }
  const enTete = Buffer.alloc(13);
  enTete.writeUInt32BE(largeur, 0);
  enTete.writeUInt32BE(hauteur, 4);
  enTete[8] = 8;   // 8 bits par canal
  enTete[9] = 2;   // couleur vraie, sans transparence
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloc('IHDR', enTete),
    bloc('IDAT', zlib.deflateSync(brut, { level: 9 })),
    bloc('IEND', Buffer.alloc(0))
  ]);
}

// -----------------------------------------------------------------------------
// Le dessin
// -----------------------------------------------------------------------------

/** Un losange est le lieu des points dont |dx| + |dy| est constant. */
function dansLosange(x, y, cx, cy, demiLargeur, demiHauteur) {
  return Math.abs(x - cx) / demiLargeur + Math.abs(y - cy) / demiHauteur <= 1;
}

/**
 * Dessine l'icône. `marge` réserve la zone que les systèmes rognent sur une
 * icône « maskable » : Android peut la découper en cercle, en goutte ou en
 * carré arrondi selon le constructeur, et ne garantit que les 80 % centraux.
 */
function dessiner(cote, marge = 0) {
  const pixels = Buffer.alloc(cote * cote * 3);
  const c = cote / 2;
  const echelle = (cote / 2) * (1 - marge);

  // Les trois losanges de la marque, du plus bas au plus haut
  const etages = [0.42, 0.10, -0.22].map(decalage => ({
    cy: c + decalage * echelle * 1.15,
    demiL: echelle * 0.78,
    demiH: echelle * 0.36
  }));
  const epaisseur = echelle * 0.13;

  for (let y = 0; y < cote; y++) {
    for (let x = 0; x < cote; x++) {
      let couleur = VERT;

      for (const e of etages) {
        const dedans = dansLosange(x, y, c, e.cy, e.demiL, e.demiH);
        const dedansPlusPetit = dansLosange(x, y, c, e.cy, e.demiL - epaisseur, e.demiH - epaisseur * 0.46);
        // Le losange du haut est plein, les deux autres ne sont qu'un contour :
        // c'est ce qui donne l'impression de couches empilees.
        const estLeHaut = e === etages[2];
        if (dedans && (estLeHaut || !dedansPlusPetit)) couleur = BLANC;
      }

      const i = (y * cote + x) * 3;
      pixels[i] = couleur[0];
      pixels[i + 1] = couleur[1];
      pixels[i + 2] = couleur[2];
    }
  }
  return encoderPng(cote, cote, pixels);
}

// -----------------------------------------------------------------------------

const ICONES = [
  { fichier: 'icone-192.png',           cote: 192, marge: 0 },
  { fichier: 'icone-512.png',           cote: 512, marge: 0 },
  // 20 % de marge : la zone que les lanceurs Android peuvent rogner
  { fichier: 'icone-maskable-512.png',  cote: 512, marge: 0.2 },
  // iOS n'arrondit pas lui-meme : l'icone doit deja etre pleine
  { fichier: 'apple-touch-icon.png',    cote: 180, marge: 0 }
];

if (!fs.existsSync(SORTIE)) fs.mkdirSync(SORTIE, { recursive: true });

for (const icone of ICONES) {
  const png = dessiner(icone.cote, icone.marge);
  fs.writeFileSync(path.join(SORTIE, icone.fichier), png);
  console.log(`  ${icone.fichier.padEnd(28)} ${icone.cote}×${icone.cote}  ${Math.round(png.length / 1024)} Ko`);
}
console.log('\nIcônes générées dans public/assets/.');

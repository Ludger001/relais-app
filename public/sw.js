/**
 * =============================================================================
 * RELAIS — SERVICE WORKER
 * =============================================================================
 *
 * Deux raisons d'exister :
 *
 * 1. Rendre l'application installable. Un navigateur ne propose « Ajouter à
 *    l'écran d'accueil » que si un service worker répond aux requêtes — c'est
 *    aussi la base sur laquelle un emballage Capacitor ira chercher le site
 *    pour le publier sur les magasins.
 *
 * 2. La connexion. Les marchands et les agences travaillent en 3G, dans un
 *    taxi ou sur un marché. Sans cache, une coupure de deux secondes affiche
 *    la page « Aucune connexion » du navigateur, et tout est à recharger.
 *
 * CE QU'IL NE FAIT JAMAIS
 * -----------------------
 * Il ne met en cache AUCUNE donnée métier : ni message, ni commande, ni
 * montant, ni pièce jointe. Tout ce qui passe par Supabase va au réseau, à
 * chaque fois. Un chiffre financier périmé servi depuis un cache serait pire
 * que pas de chiffre du tout — il est censé être opposable aux deux parties.
 *
 * Seule la coquille est mise en cache : le HTML, le CSS, le JavaScript, les
 * icônes. Ce sont des fichiers que nous versionnons, pas des données.
 */

const VERSION = 'relais-coquille-v1';

// La coquille : ce qu'il faut pour afficher quelque chose hors ligne.
const COQUILLE = [
  '/',
  '/index.html',
  '/app.html',
  '/connexion.html',
  '/style.css',
  '/dashboard.css',
  '/landing.css',
  '/app.js',
  '/lib/supabaseClient.js',
  '/lib/antiBypassFilter.js',
  '/lib/tableauDeBord.js',
  '/assets/icone-192.png',
  '/assets/icone-512.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(VERSION)
      // addAll échoue en bloc si un seul fichier manque : on tolère les absents
      // plutôt que de laisser l'installation entière échouer.
      .then((cache) => Promise.allSettled(COQUILLE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(
        noms.filter((n) => n !== VERSION).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);

  // Tout ce qui touche aux données part au réseau, sans exception et sans
  // repli : mieux vaut une erreur franche qu'un montant périmé.
  const estDonnee = url.origin !== self.location.origin
    || url.pathname.startsWith('/rest/')
    || url.pathname.startsWith('/auth/')
    || url.pathname.startsWith('/storage/')
    || url.pathname.startsWith('/functions/');
  if (estDonnee) return;

  // La coquille : le réseau d'abord — pour qu'un déploiement soit visible tout
  // de suite — et le cache seulement s'il ne répond pas.
  evenement.respondWith(
    fetch(requete)
      .then((reponse) => {
        if (reponse && reponse.ok) {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put(requete, copie));
        }
        return reponse;
      })
      .catch(() => caches.match(requete).then((enCache) => {
        if (enCache) return enCache;
        // Le repli sur app.html ne vaut que pour une NAVIGATION. Le servir a la
        // place d'une feuille de style ou d'un script manquant donnerait du HTML
        // la ou le navigateur attend autre chose : il l'ignorerait en silence,
        // et la page s'afficherait cassee sans qu'on sache pourquoi.
        if (requete.mode === 'navigate') return caches.match('/app.html');
        return Response.error();
      }))
  );
});

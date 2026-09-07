/**
 * =============================================================================
 * RELAIS — CONNEXION À SUPABASE
 * =============================================================================
 *
 * La clé ci-dessous est une clé PUBLIQUE (« publishable »). Elle est faite pour
 * vivre dans le navigateur et il est normal qu'elle soit visible : elle
 * n'autorise rien par elle-même.
 *
 * Ce qui protège réellement les données, ce sont les règles RLS de la base
 * (voir database/02_securite.sql). C'est pour ça qu'on les a écrites et
 * testées AVANT d'écrire cette ligne.
 *
 * La clé qu'il ne faut JAMAIS mettre ici est la clé « service_role » : celle-là
 * ignore toutes les règles de sécurité. Elle ne sert que côté serveur.
 */

const SUPABASE_URL = 'https://uqusictqdviahnxpzylu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_oe6V2dUMdFgAtMjSBi8-mg_olBmIxPr';

// La librairie est chargée par une balise <script> avant ce fichier.
// Elle expose un objet global `supabase` qui contient createClient.
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
window.db = db; // atteignable depuis la console : la sécurité ne repose pas sur son secret

/**
 * Renvoie la session en cours, ou null si personne n'est connecté.
 */
async function getSession() {
  const { data, error } = await db.auth.getSession();
  if (error) {
    console.error('[Relais] Lecture de session impossible :', error.message);
    return null;
  }
  return data.session;
}

/**
 * Renvoie le profil complet du membre connecté (rôle, pays, fiche métier),
 * ou null s'il n'est pas connecté ou si son profil n'existe pas encore.
 */
async function getMonProfil() {
  const session = await getSession();
  if (!session) return null;

  const { data: profil, error } = await db
    .from('profiles')
    .select('id, email, full_name, role, country, is_active')
    .eq('auth_user_id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('[Relais] Lecture du profil impossible :', error.message);
    return null;
  }
  if (!profil) return null;

  // On rattache la fiche métier correspondant au rôle
  if (profil.role === 'merchant') {
    const { data: fiche } = await db
      .from('merchants')
      .select('id, store_name, product_categories, primary_country')
      .eq('profile_id', profil.id)
      .maybeSingle();
    profil.merchant = fiche || null;
  } else if (profil.role === 'agency') {
    const { data: fiche } = await db
      .from('agencies')
      .select('id, company_name, primary_city, status, base_delivery_fee, cod_payout_frequency, fleet_size, rating_avg, rating_count')
      .eq('profile_id', profil.id)
      .maybeSingle();
    profil.agency = fiche || null;
  }

  return profil;
}

/**
 * Protège une page : renvoie le profil, ou redirige vers la connexion.
 */
async function exigerConnexion() {
  const profil = await getMonProfil();
  if (!profil) {
    window.location.href = 'connexion.html';
    return null;
  }
  return profil;
}

async function seDeconnecter() {
  await db.auth.signOut();
  window.location.href = 'connexion.html';
}

/**
 * Traduit les messages d'erreur de Supabase, qui arrivent en anglais.
 */
function messageErreur(error) {
  if (!error) return 'Une erreur inconnue est survenue.';
  const m = (error.message || '').toLowerCase();

  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'Cette adresse e-mail a déjà un compte Relais. Essayez de vous connecter.';
  }
  if (m.includes('invalid login credentials')) {
    return 'E-mail ou mot de passe incorrect.';
  }
  if (m.includes('email not confirmed')) {
    return 'Votre adresse e-mail n\'est pas encore confirmée. Consultez votre boîte de réception.';
  }
  if (m.includes('password should be at least')) {
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  }
  if (m.includes('rate limit') || m.includes('too many requests')) {
    return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
  }
  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return 'Cette adresse e-mail n\'est pas valide.';
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Connexion au serveur impossible. Vérifiez votre connexion internet.';
  }
  return error.message;
}


// =============================================================================
// Enregistrement du service worker
// =============================================================================
// Il rend l'application installable sur l'écran d'accueil — la base sur laquelle
// un emballage Capacitor ira la publier sur les magasins — et lui permet de
// s'ouvrir malgré une coupure de réseau. Il ne met en cache que la coquille :
// aucune donnée métier, jamais (voir public/sw.js).
//
// file:// n'autorise pas les service workers : l'échec y est normal, on ne
// l'affiche pas comme une erreur.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.info('[Relais] Service worker non enregistré :', e.message);
    });
  });
}

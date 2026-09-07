/**
 * =============================================================================
 * SAAS RELAIS — LOGIQUE APPLICATIVE INTERACTIVE (APP.JS)
 * =============================================================================
 * Gère l'annuaire multi-pays, le chat temps réel, le filtre anti-fuite,
 * la passation d'ordres de livraison COD, le point financier et le SuperAdmin.
 */

// 0. OUTILS DE DATE (le bilan doit pouvoir se calculer sur une journée précise)
function atDay(daysBack, hours, minutes) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatOrderDate(date) {
  const heure = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const jour = new Date(date);
  jour.setHours(0, 0, 0, 0);
  const ecart = Math.round((startOfToday() - jour) / 86400000);
  if (ecart === 0) return `Aujourd'hui ${heure}`;
  if (ecart === 1) return `Hier ${heure}`;
  return `${date.toLocaleDateString('fr-FR')} ${heure}`;
}

// Bornes de la période sélectionnée pour le point financier
function periodRange(period) {
  const debutJour = startOfToday();
  const finJour = new Date(debutJour);
  finJour.setDate(finJour.getDate() + 1);

  switch (period) {
    case 'today':
      return { from: debutJour, to: finJour };
    case 'yesterday': {
      const hier = new Date(debutJour);
      hier.setDate(hier.getDate() - 1);
      return { from: hier, to: debutJour };
    }
    case '7d': {
      const from = new Date(debutJour);
      from.setDate(from.getDate() - 6);
      return { from, to: finJour };
    }
    case '30d': {
      const from = new Date(debutJour);
      from.setDate(from.getDate() - 29);
      return { from, to: finJour };
    }
    default:
      return null; // 'all' : aucune borne
  }
}

function isInPeriod(date, period) {
  const range = periodRange(period);
  if (!range) return true;
  return date >= range.from && date < range.to;
}

function periodLabel(period) {
  switch (period) {
    case 'today': return "la journée d'aujourd'hui";
    case 'yesterday': return "la journée d'hier";
    case '7d': return 'les 7 derniers jours';
    case '30d': return 'les 30 derniers jours';
    default: return 'toute la période';
  }
}

// Correspondances entre les codes stockés en base et ce qu'on affiche
const PAYS = {
  BJ: { nom: 'Bénin',           drapeau: '🇧🇯' },
  TG: { nom: 'Togo',            drapeau: '🇹🇬' },
  SN: { nom: 'Sénégal',         drapeau: '🇸🇳' },
  CI: { nom: "Côte d'Ivoire",   drapeau: '🇨🇮' },
  GA: { nom: 'Gabon',           drapeau: '🇬🇦' }
};

const FREQUENCES_REVERSEMENT = {
  daily:        'Quotidien (J+1)',
  twice_weekly: 'Bi-hebdomadaire',
  weekly:       'Hebdomadaire',
  bi_weekly:    'Toutes les 2 semaines'
};

/**
 * Charge l'annuaire depuis Supabase.
 *
 * Aucun filtre « vérifiée » n'est écrit ici : les règles RLS ne renvoient
 * déjà que les agences certifiées (plus la sienne, si on est une agence).
 * Le tri se fait côté serveur, pas dans le navigateur.
 */
async function chargerAgences() {
  const { data, error } = await db
    .from('agencies')
    .select('id, profile_id, company_name, legal_registration_number, country, primary_city, covered_areas, base_delivery_fee, cod_payout_frequency, has_warehousing, fleet_size, status, rating_avg, rating_count')
    .order('rating_avg', { ascending: false });

  if (error) {
    console.error('[Relais] Annuaire indisponible :', error.message);
    state.agencesEnErreur = error.message;
    state.agencies = [];
    return;
  }

  state.agencesEnErreur = null;
  state.agencies = (data || []).map(a => ({
    id: a.id,
    profileId: a.profile_id,
    name: a.company_name,
    country: a.country,
    countryName: PAYS[a.country]?.nom || a.country,
    flag: PAYS[a.country]?.drapeau || '🏳️',
    city: a.primary_city,
    areas: a.covered_areas || [],
    baseFee: Number(a.base_delivery_fee) || 0,
    payoutFrequency: a.cod_payout_frequency,
    payoutText: FREQUENCES_REVERSEMENT[a.cod_payout_frequency] || a.cod_payout_frequency,
    hasStorage: a.has_warehousing,
    fleetSize: a.fleet_size,
    rating: Number(a.rating_avg) || 0,
    reviewCount: a.rating_count || 0,
    legalId: a.legal_registration_number || 'Non renseigné',
    statut: a.status,
    isVerified: a.status === 'verified'
  }));

  remplirFiltreVilles();
}

/**
 * Le filtre « ville » listait cinq villes écrites en dur. Il ne doit proposer
 * que des villes où une agence existe réellement.
 */
function remplirFiltreVilles() {
  const select = document.getElementById('filter-city');
  if (!select) return;

  const choixActuel = select.value;
  const villes = [...new Set(state.agencies.map(a => a.city).filter(Boolean))].sort();

  select.innerHTML =
    '<option value="ALL">Toutes les villes</option>' +
    villes.map(v => {
      const pays = state.agencies.find(a => a.city === v)?.countryName || '';
      return `<option value="${v}">${v}${pays ? ` (${pays})` : ''}</option>`;
    }).join('');

  if ([...select.options].some(o => o.value === choixActuel)) select.value = choixActuel;
}

// 1. ÉTAT GLOBAL DE L'APPLICATION
const state = {
  currentRole: 'merchant', // 'merchant', 'agency', 'admin'
  isSubscribed: true,
  currentCountryFilter: 'ALL',
  selectedAgencyId: null, // renseigné quand on ouvre une conversation
  currentPeriod: 'today', // 'today', 'yesterday', '7d', '30d', 'all'
  profile: null,          // profil Supabase du membre connecte
  
  // Annuaire chargé depuis Supabase par chargerAgences()
  agencies: [],
  agencesEnErreur: null,

  // Conversations chargées depuis Supabase : messages par agence,
  // et l'identifiant de conversation correspondant
  conversations: {},
  conversationIds: {},

  // Commandes COD chargées depuis Supabase (Bloc 5)
  orders: [],

  // Points financiers (reversements) chargés depuis Supabase
  payouts: [],

  // Agences que ce marchand peut noter (il a des livraisons réussies chez elles)
  notables: [],

  // Chiffres du tableau de bord du rôle connecté
  chiffres: null,

  // Canal d'écoute en direct (Supabase Realtime)
  canalDirect: null,

  // Abonnement du membre connecté (paywall bilatéral)
  abonnement: null,

  // Tentatives de contournement — table security_violations (Bloc 7)
  securityLogs: []
};

// Exposés volontairement : c'est exactement ce qu'un utilisateur curieux
// atteint en ouvrant la console. La sécurité ne repose pas sur leur secret,
// mais sur les privilèges retirés côté base.
window.state = state;

// 2. INITIALISATION AU CHARGEMENT DU DOM
document.addEventListener('DOMContentLoaded', async () => {
  // Aucune donnee ne s'affiche avant de savoir qui est connecte.
  // exigerConnexion() redirige vers connexion.html s'il n'y a pas de session.
  const profil = await exigerConnexion();
  if (!profil) return;

  appliquerProfil(profil);

  await chargerAgences();
  await chargerConversations();
  await chargerCommandes();
  await chargerPointsFinanciers();
  await chargerAbonnement();
  await chargerAgencesNotables();
  await chargerTableauDeBord();
  await chargerJournalSecurite();

  renderAgencies();
  setupTabNavigation();
  setupCountryFilters();
  setupChat();
  suivreClavierVirtuel();
  setupOrdersAndFinance();
  setupAdminPanel();
  setupDepotKYC();
  setupClotureCompte();
  setupModals();
  await renderEspaceAgence();
  renderAbonnement();
  renderMonCompte();
  renderTableauDeBord();
  renderFinanceView();
  ecouterEnDirect();
});

/**
 * Le role vient desormais du compte connecte, plus d'un bouton.
 */
function appliquerProfil(profil) {
  state.profile = profil;
  state.currentRole = profil.role;

  const nom = document.getElementById('session-name');
  const role = document.getElementById('session-role');
  const bloc = document.getElementById('session-identity');

  if (nom) nom.textContent = profil.full_name || profil.email;
  if (role) {
    role.textContent = {
      merchant: 'E-commerçant',
      agency: 'Agence de livraison',
      admin: 'Administrateur'
    }[profil.role] || profil.role;
  }
  if (bloc) bloc.hidden = false;

  const avatar = document.getElementById('session-avatar');
  if (avatar) {
    const source = profil.role === 'merchant' ? (profil.merchant?.store_name || profil.full_name)
                 : profil.role === 'agency'   ? (profil.agency?.company_name || profil.full_name)
                 : profil.full_name;
    // Deux initiales : « Glow Beauty Store » donne GB, pas G
    avatar.textContent = (source || '?')
      .split(/\s+/).filter(Boolean).slice(0, 2).map(m => m[0]).join('').toUpperCase();
    avatar.title = source || '';
  }

  appliquerOngletsAutorises(profil.role);

  // Les boutons « Tester le filtre anti-fuite » sont de l'outillage : ils
  // étaient livrés à tous les clients, sous la zone de saisie. Ils ne servent
  // qu'à l'administrateur, pour montrer le bouclier à l'œuvre.
  const outillage = document.getElementById('quick-test-prompts');
  if (outillage) outillage.hidden = profil.role !== 'admin';

  // Bandeau d'abonnement
  const pastille = document.getElementById('sub-status-text');
  if (pastille) {
    if (profil.role === 'merchant') {
      pastille.textContent = profil.merchant?.store_name || 'Espace marchand';
    } else if (profil.role === 'agency') {
      const statuts = {
        pending_verification: 'Dossier en cours de vérification',
        verified: 'Agence certifiée',
        rejected: 'Dossier refusé',
        suspended: 'Compte suspendu'
      };
      pastille.textContent = statuts[profil.agency?.status] || 'Espace agence';
    } else {
      pastille.textContent = 'SuperAdmin';
    }
  }

  const deconnexion = document.getElementById('btn-logout');
  if (deconnexion) deconnexion.addEventListener('click', seDeconnecter);
}

// =============================================================================
// GESTION DE L'ANNUAIRE & DES FILTRES
// =============================================================================

function renderAgencies() {
  const container = document.getElementById('agencies-grid-container');
  if (!container) return;

  const cityFilter = document.getElementById('filter-city').value;
  const payoutFilter = document.getElementById('filter-payout').value;
  const storageFilter = document.getElementById('filter-storage').value;

  const filtered = state.agencies.filter(agency => {
    // Seules les agences vérifiées s'affichent dans l'annuaire public
    if (!agency.isVerified) return false;

    if (state.currentCountryFilter !== 'ALL' && agency.country !== state.currentCountryFilter) {
      return false;
    }
    if (cityFilter !== 'ALL' && agency.city !== cityFilter) {
      return false;
    }
    if (payoutFilter !== 'ALL' && agency.payoutFrequency !== payoutFilter) {
      return false;
    }
    if (storageFilter === 'true' && !agency.hasStorage) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    // Trois situations très différentes, trois messages différents
    let titre, detail;

    if (state.agencesEnErreur) {
      titre = "L'annuaire n'a pas pu être chargé.";
      detail = "Vérifiez votre connexion internet puis rechargez la page.";
    } else if (state.agencies.length === 0) {
      titre = "Aucune agence certifiée pour le moment.";
      detail = "Les agences apparaissent ici une fois leur dossier vérifié par Relais.";
    } else {
      titre = "Aucune agence ne correspond à ces critères.";
      detail = "Élargissez vos filtres ou choisissez un autre pays.";
    }

    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-dim);">
        <p style="font-size: 1.2rem; margin-bottom: 0.5rem;">${titre}</p>
        <p style="font-size: 0.85rem;">${detail}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(agency => `
    <div class="agency-card">
      <div>
        <div class="agency-card-top">
          <div class="agency-flag-badge">${agency.flag}</div>
          <span class="verified-tag">✔ Vérifiée Relais</span>
        </div>
        
        <h3 class="agency-name">${echapperHtml(agency.name)}</h3>
        <div class="agency-location">📍 ${echapperHtml(agency.city)}, ${echapperHtml(agency.countryName)}</div>

        <div class="agency-stats-pills">
          <span class="stat-pill">⭐ <strong>${agency.rating}</strong> (${agency.reviewCount} avis)</span>
          <span class="stat-pill">⏱ Reversement : <strong>${echapperHtml(agency.payoutText)}</strong></span>
          <span class="stat-pill">🛵 Flotte : <strong>${agency.fleetSize} livreurs</strong></span>
        </div>

        <ul class="agency-features-list">
          <li>Zones : ${echapperHtml(agency.areas.slice(0, 3).join(', '))}...</li>
          <li>Entreposage sécurisé : ${agency.hasStorage ? 'Oui (Stock tampon disponible)' : 'Non'}</li>
          <li>Enregistrement : ${echapperHtml(agency.legalId)}</li>
        </ul>
      </div>

      <div class="agency-card-footer">
        <div class="agency-fee-wrap">
          <span class="fee-label">Tarif de base</span>
          <span class="fee-val">${agency.baseFee.toLocaleString()} FCFA</span>
        </div>
        <button class="btn btn-primary-sm" onclick="startChatWithAgency('${agency.id}')">
          Discuter & Commander
        </button>
        ${boutonNotation(agency)}
      </div>
    </div>
  `).join('');
}

function setupCountryFilters() {
  const pills = document.querySelectorAll('.country-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.currentCountryFilter = pill.dataset.country;
      renderAgencies();
    });
  });

  document.getElementById('filter-city')?.addEventListener('change', renderAgencies);
  document.getElementById('filter-payout')?.addEventListener('change', renderAgencies);
  document.getElementById('filter-storage')?.addEventListener('change', renderAgencies);
}

// =============================================================================
// GESTION DU CHAT SÉCURISÉ & FILTRE ANTI-FUITE
// =============================================================================

function setupChat() {
  renderConversationsSidebar();
  renderActiveChat();

  const sendBtn = document.getElementById('btn-send-message');
  const inputField = document.getElementById('chat-input-field');

  /**
   * L'envoi passe obligatoirement par la fonction serveur `envoyer-message`.
   * Le droit d'écrire dans la table `messages` a été retiré au navigateur :
   * ce que fait ici le filtre local n'est qu'un avertissement anticipé, il
   * n'a aucun pouvoir de décision.
   */
  async function handleSend(pieceJointe = null) {
    const rawText = inputField.value.trim();
    if (!rawText && !pieceJointe) return;

    const conversationId = state.conversationIds[state.selectedAgencyId];
    if (!conversationId) {
      alert("Ouvrez d'abord une conversation depuis l'annuaire.");
      return;
    }

    // Avertissement immédiat, avant même l'aller-retour réseau
    const apercu = inspectAndSanitizeMessage(rawText);
    if (apercu.isBlocked) {
      const toast = document.getElementById('filter-alert-toast');
      if (toast) {
        toast.style.display = 'block';
        clearTimeout(toast._minuterie);
        toast._minuterie = setTimeout(() => { toast.style.display = 'none'; }, 6000);
      }
    }

    inputField.disabled = true;
    sendBtn.disabled = true;

    try {
      const { error } = await db.functions.invoke('envoyer-message', {
        body: {
          conversation_id: conversationId,
          content: rawText,
          piece_jointe: pieceJointe || undefined
        }
      });

      if (error) {
        // Le serveur explique pourquoi il refuse — cadence dépassée, compte
        // désactivé, conversation bloquée. La version précédente jetait cette
        // explication et affichait « Réessayez dans un instant » : on ne
        // pouvait pas savoir qu'il fallait simplement patienter une minute.
        console.error('[Relais] Envoi refusé :', error);
        alert(await messageDErreurServeur(error));
        return;
      }

      inputField.value = '';
      // On relit depuis la base : c'est le texte réellement enregistré,
      // pas celui que le navigateur croyait envoyer.
      await chargerMessages(state.selectedAgencyId);
      renderActiveChat();
      renderConversationsSidebar();

    } finally {
      inputField.disabled = false;
      inputField.focus();
      ajusterHauteurSaisie();   // règle aussi l'état du bouton d'envoi
    }
  }

  /**
   * Dépose une photo ou un document, puis l'envoie comme message.
   *
   * Le chemin commence par l'identifiant de la conversation : c'est ce que
   * lisent les règles du dépôt pour vérifier que l'on en est bien participant,
   * et c'est ce que revérifie la fonction serveur avant d'attacher le fichier.
   */
  async function envoyerFichier(fichier) {
    const conversationId = state.conversationIds[state.selectedAgencyId];
    if (!conversationId) {
      alert("Ouvrez d'abord une conversation depuis l'annuaire.");
      return;
    }

    const TAILLE_MAX = 5 * 1024 * 1024;
    if (fichier.size > TAILLE_MAX) {
      alert(`Ce fichier pèse ${Math.round(fichier.size / 1024 / 1024)} Mo. La limite est de 5 Mo — prenez la photo en qualité normale plutôt qu'en haute définition.`);
      return;
    }

    const extension = (fichier.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const chemin = `${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

    const boutonJoindre = document.getElementById('btn-attach');
    if (boutonJoindre) boutonJoindre.disabled = true;

    try {
      const { error } = await db.storage.from('pieces-chat').upload(chemin, fichier, {
        contentType: fichier.type,
        upsert: false
      });

      if (error) {
        console.error('[Relais] Dépôt refusé :', error);
        alert("Ce fichier n'a pas pu être envoyé. Vérifiez qu'il s'agit d'une image ou d'un PDF de moins de 5 Mo.");
        return;
      }

      await handleSend(chemin);

    } finally {
      if (boutonJoindre) boutonJoindre.disabled = false;
    }
  }

  const champFichier = document.getElementById('chat-fichier');
  document.getElementById('btn-attach')?.addEventListener('click', () => champFichier?.click());
  champFichier?.addEventListener('change', async () => {
    const fichier = champFichier.files?.[0];
    if (fichier) await envoyerFichier(fichier);
    champFichier.value = '';   // sinon renvoyer le même fichier ne déclenche rien
  });

  sendBtn?.addEventListener('click', handleSend);

  /**
   * Entrée envoie, Maj+Entrée passe à la ligne — partout, téléphone compris.
   *
   * La version précédente ne l'appliquait pas sur téléphone, de peur de couper
   * les messages en morceaux. Le résultat était pire : on tapait, on appuyait
   * sur la touche du clavier, et rien ne partait. L'attribut enterkeyhint
   * demande au clavier virtuel d'étiqueter cette touche « Envoyer », ce qui
   * lève l'ambiguïté au lieu de la créer.
   */
  inputField?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  inputField?.addEventListener('input', ajusterHauteurSaisie);
  ajusterHauteurSaisie();

  // Revenir à la liste des conversations — n'a de sens que sur téléphone,
  // où les deux panneaux ne tiennent pas côte à côte.
  document.getElementById('btn-retour-liste')?.addEventListener('click', () => {
    document.querySelector('.chat-workspace-layout')?.classList.remove('voir-fil');
  });

  // Le bandeau des commandes se replie : sur téléphone il mangeait la moitié
  // de l'écran avant qu'on ait vu le premier message.
  const bascule = document.getElementById('strip-bascule');
  const bandeau = document.getElementById('chat-orders-strip');
  bascule?.addEventListener('click', () => {
    const replie = bandeau.dataset.replie !== 'non';
    bandeau.dataset.replie = replie ? 'non' : 'oui';
    bascule.setAttribute('aria-expanded', String(replie));
  });

  // Outillage de démonstration du filtre, réservé à l'administrateur.
  document.querySelectorAll('.btn-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      inputField.value = chip.dataset.test;
      ajusterHauteurSaisie();
      inputField.focus();
    });
  });
}

/**
 * Une fonction serveur qui refuse renvoie une explication utile. supabase-js
 * l'enveloppe dans une erreur dont le corps n'est lisible qu'en relisant la
 * réponse : sans ça, « Limite atteinte, patientez une minute » devenait
 * « Réessayez dans un instant », et l'utilisateur ne savait pas quoi corriger.
 */
async function messageDErreurServeur(erreur) {
  const repli = "Votre message n'a pas pu être envoyé. Réessayez dans un instant.";
  try {
    const corps = await erreur?.context?.json?.();
    return corps?.erreur || repli;
  } catch {
    return repli;
  }
}

/**
 * Fait suivre à la messagerie la hauteur RÉELLEMENT visible de l'écran.
 *
 * Quand le clavier virtuel s'ouvre, deux comportements existent selon le
 * navigateur : soit il redimensionne la page (Chrome Android, via le méta
 * interactive-widget), soit il la recouvre — c'est le cas de Safari iOS, où ce
 * méta n'existe pas. Dans le second cas, la zone de saisie se retrouvait sous
 * le clavier : on tapait sans voir, et le bouton d'envoi devenait inatteignable.
 *
 * visualViewport donne la hauteur effectivement visible dans les deux cas.
 * Disponible sur tous les navigateurs courants depuis 2021 ; s'il manque, le
 * CSS retombe sur 100dvh et le comportement reste celui d'avant.
 */
function suivreClavierVirtuel() {
  const vue = window.visualViewport;
  if (!vue) return;

  const appliquer = () => {
    document.documentElement.style.setProperty('--hauteur-visible', vue.height + 'px');
    // iOS fait glisser la page sous le clavier ; on la ramène en place.
    if (document.body.classList.contains('vue-chat')) window.scrollTo(0, 0);
  };

  vue.addEventListener('resize', () => {
    appliquer();
    // Le clavier vient de manger la moitié de l'écran : sans ça, le dernier
    // message se retrouve hors champ juste au moment où l'on répond.
    const flux = document.getElementById('messages-stream');
    if (flux) flux.scrollTop = flux.scrollHeight;
  });
  vue.addEventListener('scroll', appliquer);
  appliquer();
}

/**
 * La zone de saisie grandit avec le texte, jusqu'à la limite posée par le CSS.
 *
 * Elle vit hors de setupChat() parce qu'elle doit être rappelée quand l'onglet
 * redevient visible : mesurée pendant que le panneau est en display:none,
 * scrollHeight vaut 0 et la zone se figeait à zéro pixel de haut — le texte
 * saisi était alors invisible.
 */
function ajusterHauteurSaisie() {
  const champ = document.getElementById('chat-input-field');
  const envoi = document.getElementById('btn-send-message');
  if (!champ) return;

  if (envoi) envoi.disabled = champ.value.trim().length === 0;

  champ.style.height = 'auto';
  if (champ.scrollHeight > 0) champ.style.height = champ.scrollHeight + 'px';
}

function renderConversationsSidebar() {
  const container = document.getElementById('conversations-list-container');
  if (!container) return;

  const agencyList = state.agencies.filter(a => state.conversations[a.id]);

  // Compteurs : ils affichaient « 2 agences » et « 1 » en dur
  const compteur = document.getElementById('active-chats-count');
  if (compteur) {
    compteur.textContent = agencyList.length === 0
      ? 'Aucune'
      : `${agencyList.length} ${agencyList.length > 1 ? 'agences' : 'agence'}`;
  }

  const badgeOnglet = document.getElementById('chat-badge-count');
  if (badgeOnglet) {
    badgeOnglet.textContent = agencyList.length;
    badgeOnglet.hidden = agencyList.length === 0;
  }

  if (agencyList.length === 0) {
    // Une agence n'a pas accès à l'annuaire : lui dire d'y aller n'aurait aucun sens
    const message = state.currentRole === 'agency'
      ? `Aucun e-commerçant ne vous a encore contacté.<br>
         Les demandes arriveront ici dès qu'un marchand ouvrira une conversation.`
      : `Aucune conversation pour l'instant.<br>
         Contactez une agence depuis l'annuaire pour en ouvrir une.`;

    container.innerHTML = `
      <div style="padding:1.5rem; color: var(--text-dim); font-size:.85rem; line-height:1.6;">
        ${message}
      </div>`;
    return;
  }

  container.innerHTML = agencyList.map(agency => {
    const msgs = state.conversations[agency.id] || [];
    const lastMsg = msgs[msgs.length - 1]?.text || 'Nouvelle conversation';
    const isActive = agency.id === state.selectedAgencyId;

    return `
      <div class="conv-item ${isActive ? 'active' : ''}" onclick="selectConversation('${agency.id}')">
        <div class="conv-avatar">${agency.flag}</div>
        <div class="conv-info">
          <div class="conv-name-row">
            <span class="conv-name">${echapperHtml(agency.name)}</span>
            <span class="conv-time">10:18</span>
          </div>
          <div class="conv-last-msg">${echapperHtml(lastMsg)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function selectConversation(agencyId) {
  state.selectedAgencyId = agencyId;
  renderConversationsSidebar();
  renderActiveChat();
  renderOrdersStrip();
  renderFinanceView();

  // Sur téléphone, ouvrir une conversation fait glisser vers le fil ; sur
  // ordinateur la classe ne change rien, les deux panneaux restent côte à côte.
  document.querySelector('.chat-workspace-layout')?.classList.add('voir-fil');
  document.getElementById('chat-input-field')?.focus({ preventScroll: true });
}

/**
 * Ouvre — ou crée en base — la conversation avec une agence.
 * Seul un marchand peut en ouvrir une, et seulement vers une agence certifiée :
 * c'est la règle RLS conversations_insert_merchant qui l'impose.
 */
async function startChatWithAgency(agencyId) {
  state.selectedAgencyId = agencyId;
  switchTab('chat');

  if (!state.conversationIds[agencyId]) {
    if (!state.profile?.merchant?.id) {
      alert("Seul un compte e-commerçant peut ouvrir une conversation avec une agence.");
      return;
    }

    const { data, error } = await db
      .from('conversations')
      .insert({ merchant_id: state.profile.merchant.id, agency_id: agencyId })
      .select('id')
      .single();

    if (error) {
      // Code 23505 : la conversation existait déjà, on la récupère
      if (error.code === '23505') {
        await chargerConversations();
      } else {
        console.error('[Relais] Ouverture de conversation impossible :', error.message);
        alert("La conversation n'a pas pu être ouverte. Réessayez dans un instant.");
        return;
      }
    } else {
      state.conversationIds[agencyId] = data.id;
      state.conversations[agencyId] = [];
    }
  }

  await chargerMessages(agencyId);
  renderConversationsSidebar();
  renderActiveChat();
}

/**
 * Charge les conversations du membre connecté, puis leurs messages.
 * Les règles RLS ne renvoient que celles auxquelles il participe.
 */
async function chargerConversations() {
  const { data, error } = await db
    .from('conversations')
    .select('id, merchant_id, agency_id, last_message_at')
    .order('last_message_at', { ascending: false });

  if (error) {
    console.error('[Relais] Conversations indisponibles :', error.message);
    return;
  }

  state.conversationIds = {};
  state.conversations = {};

  for (const conv of data || []) {
    state.conversationIds[conv.agency_id] = conv.id;
    state.conversations[conv.agency_id] = [];
  }

  // Une agence ne voit pas l'annuaire : sans cet ajout, l'interlocuteur de
  // sa propre conversation serait introuvable dans state.agencies.
  await completerAgencesDesConversations(Object.keys(state.conversationIds));

  await Promise.all(Object.keys(state.conversationIds).map(chargerMessages));

  // Ouvrir la conversation la plus recente : sans selection, l ecran de chat
  // affiche son etat vide alors que des echanges existent deja.
  const premiere = (data || [])[0];
  if (premiere && !state.selectedAgencyId) {
    state.selectedAgencyId = premiere.agency_id;
  }
}

const STATUTS_BASE_VERS_ECRAN = {
  pending_pickup: 'pending',
  in_transit:     'in_transit',
  delivered:      'delivered',
  failed_attempt: 'failed',
  cancelled:      'cancelled',
  returned:       'returned'
};

const STATUTS_ECRAN_VERS_BASE = {
  pending:    'pending_pickup',
  in_transit: 'in_transit',
  delivered:  'delivered',
  failed:     'failed_attempt',
  cancelled:  'cancelled',
  returned:   'returned'
};

/**
 * Charge les commandes depuis la base.
 *
 * Le téléphone et l'adresse du client destinataire vivent ici, pas dans les
 * messages : la table `orders` est réservée aux deux participants par RLS, et
 * ces coordonnées ne traversent donc jamais le filtre du chat — qui les
 * masquerait, alors qu'elles sont précisément ce que l'agence doit recevoir.
 */
async function chargerCommandes() {
  const { data, error } = await db
    .from('orders')
    .select('id, order_code, conversation_id, merchant_id, agency_id, product_name, quantity, cod_amount, delivery_fee, recipient_name, recipient_phone, recipient_address, recipient_city, delivery_instructions, status, payout_status, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Relais] Commandes indisponibles :', error.message);
    state.orders = [];
    return;
  }

  state.orders = (data || []).map(o => ({
    id: o.order_code,
    uuid: o.id,
    conversationId: o.conversation_id,
    agencyId: o.agency_id,
    merchantId: o.merchant_id,
    productName: o.product_name,
    qty: o.quantity,
    codAmount: Number(o.cod_amount) || 0,
    deliveryFee: Number(o.delivery_fee) || 0,
    recipientName: o.recipient_name,
    recipientPhone: o.recipient_phone,
    recipientCity: o.recipient_city,
    recipientAddress: o.recipient_address,
    instructions: o.delivery_instructions,
    status: STATUTS_BASE_VERS_ECRAN[o.status] || o.status,
    payoutStatus: o.payout_status === 'paid' ? 'paid' : 'unpaid',
    createdAt: new Date(o.created_at)
  }));
}

async function completerAgencesDesConversations(agencyIds) {
  const manquantes = agencyIds.filter(id => !state.agencies.some(a => a.id === id));
  if (manquantes.length === 0) return;

  const { data } = await db
    .from('agencies')
    .select('id, profile_id, company_name, legal_registration_number, country, primary_city, covered_areas, base_delivery_fee, cod_payout_frequency, has_warehousing, fleet_size, status, rating_avg, rating_count')
    .in('id', manquantes);

  for (const a of data || []) {
    state.agencies.push({
      id: a.id,
      profileId: a.profile_id,
      name: a.company_name,
      country: a.country,
      countryName: PAYS[a.country]?.nom || a.country,
      flag: PAYS[a.country]?.drapeau || '🏳️',
      city: a.primary_city,
      areas: a.covered_areas || [],
      baseFee: Number(a.base_delivery_fee) || 0,
      payoutFrequency: a.cod_payout_frequency,
      payoutText: FREQUENCES_REVERSEMENT[a.cod_payout_frequency] || a.cod_payout_frequency,
      hasStorage: a.has_warehousing,
      fleetSize: a.fleet_size,
      rating: Number(a.rating_avg) || 0,
      reviewCount: a.rating_count || 0,
      legalId: a.legal_registration_number || 'Non renseigné',
      statut: a.status,
    isVerified: a.status === 'verified'
    });
  }
}

/**
 * Lit les messages via la vue messages_readable : le contenu brut n'y figure
 * pas, il reste réservé à l'instruction d'un litige.
 */
async function chargerMessages(agencyId) {
  const conversationId = state.conversationIds[agencyId];
  if (!conversationId) return;

  const { data, error } = await db
    .from('messages_readable')
    .select('id, sender_id, filtered_content, has_contact_leak_attempt, attachment_url, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Relais] Messages indisponibles :', error.message);
    return;
  }

  state.conversations[agencyId] = (data || []).map(m => ({
    id: m.id,
    sender: m.sender_id === state.profile.id ? state.currentRole : 'autre',
    time: formatOrderDate(new Date(m.created_at)),
    dateBrute: new Date(m.created_at),
    text: m.filtered_content,
    hasViolation: m.has_contact_leak_attempt,
    pieceJointe: m.attachment_url || null
  }));
}

function renderActiveChat() {
  const container = document.getElementById('messages-stream');

  // Pas de repli sur la première agence de la liste : une agence connectée
  // se serait vue elle-même comme interlocutrice.
  const agency = state.selectedAgencyId
    ? state.agencies.find(a => a.id === state.selectedAgencyId)
    : null;

  // Aucune agence disponible : on l'annonce au lieu de planter
  if (!agency) {
    const estAgence = state.currentRole === 'agency';

    document.getElementById('chat-partner-name').textContent = 'Aucune conversation';
    document.getElementById('chat-partner-flag').textContent = '💬';
    document.getElementById('chat-partner-meta').textContent = estAgence
      ? 'Les e-commerçants qui vous contactent apparaîtront ici.'
      : "Ouvrez l'annuaire et contactez une agence certifiée pour démarrer.";

    // Ces éléments décrivent un interlocuteur qui n'existe pas encore
    document.querySelectorAll('.verified-badge-sm').forEach(b => { b.hidden = true; });
    document.querySelectorAll('.chat-actions-group .btn').forEach(b => { b.disabled = true; });

    if (container) {
      container.innerHTML = estAgence
        ? `<div style="text-align:center; padding:3rem; color: var(--text-dim);">
             <p style="font-size:1.05rem; margin-bottom:.4rem;">Aucun e-commerçant ne vous a encore contacté.</p>
             <p style="font-size:.85rem;">Votre agence apparaît dans l'annuaire des marchands une fois certifiée.</p>
           </div>`
        : `<div style="text-align:center; padding:3rem; color: var(--text-dim);">
             <p style="font-size:1.05rem; margin-bottom:.4rem;">Vous n'avez encore aucune conversation.</p>
             <p style="font-size:.85rem;">Rendez-vous dans l'annuaire et cliquez sur « Discuter &amp; Commander ».</p>
           </div>`;
    }
    renderOrdersStrip();
    return;
  }

  // Un interlocuteur existe : on réactive ce qui le décrit
  document.querySelectorAll('.verified-badge-sm').forEach(b => { b.hidden = false; });
  document.querySelectorAll('.chat-actions-group .btn').forEach(b => { b.disabled = false; });

  // Header chat
  document.getElementById('chat-partner-name').textContent = agency.name;
  document.getElementById('chat-partner-flag').textContent = agency.flag;
  document.getElementById('chat-partner-meta').textContent = `${agency.city}, ${agency.countryName} • Reversement ${agency.payoutText}`;

  if (!container) return;

  // Le fil mélange deux natures d'éléments : les messages, filtrés, et les
  // bons de commande, qui ne passent pas par le filtre puisqu'ils voyagent
  // par la table `orders`. C'est ce qui permet au téléphone du client
  // d'arriver intact chez l'agence sans jamais transiter par la messagerie.
  const conversationId = state.conversationIds[agency.id];

  const elements = [
    ...(state.conversations[agency.id] || []).map(m => ({
      type: 'message',
      date: m.dateBrute || new Date(0),
      donnees: m
    })),
    ...state.orders
      .filter(o => o.conversationId === conversationId)
      .map(o => ({ type: 'commande', date: o.createdAt, donnees: o }))
  ].sort((a, b) => a.date - b.date);

  // Qui parle : on le calcule une fois pour pouvoir grouper.
  const estDeMoi = (m) =>
    (state.currentRole === 'merchant' && m.sender === 'merchant') ||
    (state.currentRole === 'agency' && m.sender === 'agency');

  container.innerHTML = elements.map((el, i) => {
    const separateur = separateurDeJour(el.date, elements[i - 1]?.date);

    if (el.type === 'commande') return separateur + carteCommande(el.donnees);

    const m = el.donnees;
    const moi = estDeMoi(m);

    // Un message ouvre un groupe s'il change d'auteur, s'il suit un bon de
    // commande, ou s'il commence une nouvelle journée. Il le ferme dans les
    // mêmes cas, vus depuis le message suivant. Deux messages d'affilée du même
    // auteur se collent : c'est ce qui distingue un fil lisible d'une colonne
    // de blocs identiques.
    const precedent = elements[i - 1];
    const suivant   = elements[i + 1];
    const debut = !!separateur || !precedent || precedent.type !== 'message'
                  || estDeMoi(precedent.donnees) !== moi;
    const fin   = !suivant || suivant.type !== 'message'
                  || estDeMoi(suivant.donnees) !== moi
                  || !!separateurDeJour(suivant.date, el.date);

    // Une pièce jointe est chargée après coup : la vignette porte le chemin,
    // et revelerPiecesJointes() ira chercher un lien signé de courte durée.
    const piece = m.pieceJointe
      ? `<div class="piece-jointe" data-piece="${echapperHtml(m.pieceJointe)}">
           <span class="piece-attente">Chargement de la pièce jointe…</span>
         </div>`
      : '';

    return separateur + `
      <div class="message-bubble-wrap ${moi ? 'sent' : 'received'}${debut ? ' debut-groupe' : ''}${fin ? ' fin-groupe' : ''}">
        <div class="bubble ${m.hasViolation ? 'violation' : ''}${m.pieceJointe ? ' avec-piece' : ''}">
          ${piece}${m.text ? echapperHtml(m.text) : ''}
        </div>
        <span class="msg-time">${echapperHtml(m.time)}</span>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
  renderOrdersStrip();
  ajusterHauteurSaisie();   // le panneau est visible : la mesure est enfin juste
  revelerPiecesJointes(container);
}

/**
 * Le dépôt des pièces jointes est privé : aucune adresse permanente n'existe.
 * On demande un lien signé, valable dix minutes, uniquement pour les fichiers
 * réellement affichés. Un participant qui n'appartient pas à la conversation
 * n'obtient rien — la règle vit dans le dépôt, pas ici.
 */
async function revelerPiecesJointes(conteneur) {
  const vignettes = [...conteneur.querySelectorAll('.piece-jointe[data-piece]')];
  if (!vignettes.length) return;

  const chemins = [...new Set(vignettes.map(v => v.dataset.piece))];
  const { data, error } = await db.storage.from('pieces-chat').createSignedUrls(chemins, 600);

  if (error) {
    console.error('[Relais] Pièces jointes indisponibles :', error.message);
    vignettes.forEach(v => { v.innerHTML = '<span class="piece-attente">Pièce jointe indisponible.</span>'; });
    return;
  }

  const liens = {};
  (data || []).forEach(d => { if (d.signedUrl) liens[d.path] = d.signedUrl; });

  vignettes.forEach(v => {
    const chemin = v.dataset.piece;
    const url = liens[chemin];
    if (!url) {
      v.innerHTML = '<span class="piece-attente">Pièce jointe indisponible.</span>';
      return;
    }
    const estPdf = /.pdf$/i.test(chemin);
    v.innerHTML = estPdf
      ? `<a class="piece-document" href="${echapperHtml(url)}" target="_blank" rel="noopener">
           📄 Ouvrir le document
         </a>`
      : `<a href="${echapperHtml(url)}" target="_blank" rel="noopener">
           <img src="${echapperHtml(url)}" alt="Pièce jointe" loading="lazy">
         </a>`;
  });
}

/**
 * « Aujourd'hui », « Hier », sinon la date en toutes lettres. Rendu seulement
 * quand on change de journée : un fil sans repère temporel oblige à lire les
 * heures une par une pour savoir de quand date un échange.
 */
function separateurDeJour(date, datePrecedente) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const jour = (d) => d.toDateString();
  if (datePrecedente instanceof Date && !isNaN(datePrecedente)
      && jour(datePrecedente) === jour(date)) return '';

  const aujourdhui = new Date();
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);

  let libelle;
  if (jour(date) === jour(aujourdhui))  libelle = "Aujourd'hui";
  else if (jour(date) === jour(hier))   libelle = 'Hier';
  else libelle = date.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
    year: date.getFullYear() === aujourdhui.getFullYear() ? undefined : 'numeric'
  });

  return `<div class="separateur-jour">${echapperHtml(libelle)}</div>`;
}

// =============================================================================
// MODULE DE COMMANDES & POINT FINANCIER COD
// =============================================================================

function renderOrdersStrip() {
  const container = document.getElementById('strip-cards-container');
  const countEl = document.getElementById('strip-order-count');
  const sumEl = document.getElementById('strip-cod-sum');

  // Sur téléphone, le bandeau déplié occupait un quart de l'écran avant qu'on
  // ait vu le premier message. Il s'ouvre d'un geste ; sur ordinateur, où la
  // place ne manque pas, il reste ouvert. On ne touche pas à un choix déjà
  // fait par l'utilisateur pendant sa session.
  const bandeau = document.getElementById('chat-orders-strip');
  const bascule = document.getElementById('strip-bascule');
  if (bandeau && !bandeau.dataset.replie) {
    const surTelephone = window.matchMedia('(max-width: 900px)').matches;
    bandeau.dataset.replie = surTelephone ? 'oui' : 'non';
    bascule?.setAttribute('aria-expanded', String(!surTelephone));
  }

  const agencyOrders = state.orders.filter(o => o.agencyId === state.selectedAgencyId);

  if (countEl) countEl.textContent = agencyOrders.length;

  const totalCod = agencyOrders.reduce((acc, curr) => acc + curr.codAmount, 0);
  if (sumEl) sumEl.textContent = `${totalCod.toLocaleString()} FCFA`;

  if (!container) return;

  container.innerHTML = agencyOrders.map(order => `
    <div class="mini-order-card">
      <div>
        <div class="mini-order-code">${echapperHtml(order.id)}</div>
        <div class="mini-order-prod">${echapperHtml(order.productName)} • ${echapperHtml(order.recipientCity)}</div>
      </div>
      <div style="text-align: right;">
        <span class="order-badge ${order.status}">${formatStatus(order.status)}</span>
        <div style="font-weight: 700; font-size: 0.8rem; color: var(--primary); margin-top: 3px;">
          ${order.codAmount.toLocaleString()} F
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Le bon de commande tel qu'il apparaît dans le fil de discussion.
 *
 * Les coordonnées du destinataire sont affichées en clair — c'est légitime
 * et c'est même le but : sans elles l'agence ne peut pas livrer. Elles
 * viennent de la table `orders`, que RLS réserve aux deux participants, et
 * non d'un message qui aurait été masqué par le filtre.
 */
function carteCommande(order) {
  const net = order.codAmount - order.deliveryFee;
  return `
    <div class="message-bubble-wrap order-card-wrap">
      <div class="bubble order-card-bubble">
        <div class="order-card-title">📦 Ordre de livraison COD — ${echapperHtml(order.id)}</div>
        <div class="order-card-line">${echapperHtml(order.productName)} <span style="opacity:.7">× ${echapperHtml(order.qty)}</span></div>
        <div class="order-card-line">
          Cash à encaisser : <strong>${order.codAmount.toLocaleString()} FCFA</strong>
          &nbsp;·&nbsp; Frais agence : ${order.deliveryFee.toLocaleString()} FCFA
        </div>
        <div class="order-card-line">Net à reverser : <strong>${net.toLocaleString()} FCFA</strong></div>

        <div class="order-card-recipient">
          <div class="order-card-subtitle">Destinataire</div>
          <div>${echapperHtml(order.recipientName)}</div>
          <div>📞 <strong>${echapperHtml(order.recipientPhone)}</strong></div>
          <div>📍 ${echapperHtml(order.recipientAddress)}, ${echapperHtml(order.recipientCity)}</div>
          <div class="order-card-note">Coordonnées transmises par Relais pour cette livraison uniquement.</div>
        </div>

        <div class="order-card-footer">
          <span class="order-badge ${order.status}">${formatStatus(order.status)}</span>
        </div>
      </div>
      <span class="msg-time">${formatOrderDate(order.createdAt)}</span>
    </div>
  `;
}

/**
 * Le bouton de notation n'apparaît que si ce marchand a réellement reçu des
 * livraisons de cette agence — c'est ce qui donne du poids à la note.
 */
function boutonNotation(agency) {
  if (state.currentRole !== 'merchant') return '';
  const notable = state.notables?.find(n => n.agency_id === agency.id);
  if (!notable) return '';

  return notable.deja_note
    ? `<button class="btn btn-outline-sm" onclick="noterAgence('${agency.id}')" title="Modifier votre avis">
         ★ Votre note : ${notable.ma_note}/5
       </button>`
    : `<button class="btn btn-outline-sm" onclick="noterAgence('${agency.id}')">
         ★ Noter cette agence
       </button>`;
}

function formatStatus(status) {
  switch (status) {
    case 'delivered': return 'Livré & Encaissé';
    case 'in_transit': return 'En livraison';
    case 'pending': return 'En attente';
    case 'failed': return 'Échec de livraison';
    case 'returned': return 'Retourné';
    default: return status;
  }
}

function setupOrdersAndFinance() {
  const orderForm = document.getElementById('order-create-form');
  const boutonValider = orderForm?.querySelector('button[type="submit"]');

  orderForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const conversationId = state.conversationIds[state.selectedAgencyId];
    if (!conversationId || !state.profile?.merchant?.id) {
      alert("Ouvrez d'abord une conversation avec une agence depuis l'annuaire.");
      return;
    }

    const libelleInitial = boutonValider?.textContent;
    if (boutonValider) {
      boutonValider.disabled = true;
      boutonValider.textContent = 'Enregistrement…';
    }

    // La référence est posée par la base (défaut reference_commande) : deux
    // marchands qui commandent au même instant ne peuvent pas se télescoper.
    const { error } = await db.from('orders').insert({
      conversation_id: conversationId,
      merchant_id: state.profile.merchant.id,
      agency_id: state.selectedAgencyId,
      product_name: document.getElementById('order-product-name').value.trim(),
      quantity: parseInt(document.getElementById('order-product-qty').value, 10) || 1,
      cod_amount: parseFloat(document.getElementById('order-cod-amount').value) || 0,
      delivery_fee: parseFloat(document.getElementById('order-delivery-fee').value) || 0,
      recipient_name: document.getElementById('order-recipient-name').value.trim(),
      recipient_phone: document.getElementById('order-recipient-phone').value.trim(),
      recipient_address: document.getElementById('order-recipient-address').value.trim(),
      recipient_city: document.getElementById('order-recipient-city').value.trim()
    });

    if (boutonValider) {
      boutonValider.disabled = false;
      boutonValider.textContent = libelleInitial;
    }

    if (error) {
      console.error('[Relais] Commande refusée :', error.message);
      alert("La commande n'a pas pu être enregistrée. Vérifiez les champs et réessayez.");
      return;
    }

    document.getElementById('modal-order-create').style.display = 'none';
    orderForm.reset();

    await chargerCommandes();
    renderActiveChat();
    renderOrdersStrip();
    renderFinanceView();
  });

  document.getElementById('btn-quick-view-payout')?.addEventListener('click', () => {
    switchTab('finance');
  });

  document.getElementById('btn-agency-make-payout')?.addEventListener('click', actionAgenceReversement);
  document.getElementById('btn-merchant-confirm-payout')?.addEventListener('click', actionMarchandReversement);
}

// =============================================================================
// LE REVERSEMENT DU CASH — LE MOMENT OÙ NAISSENT LES LITIGES
// =============================================================================

const ETATS_REVERSEMENT = {
  draft:     '🟡 Comptes arrêtés, en attente du virement de l\'agence',
  initiated: '🟠 Virement déclaré par l\'agence, en attente de votre confirmation',
  confirmed: '🟢 Reversement confirmé par les deux parties',
  disputed:  '🔴 Reversement contesté'
};

// =============================================================================
// ABONNEMENT — LE PAYWALL BILATÉRAL
// =============================================================================

/**
 * L'accès se décide en base, jamais ici : cette lecture sert à informer
 * l'utilisateur. Même si quelqu'un neutralisait ce code, les règles RLS et
 * les fonctions serveur continueraient de le tenir à l'écart des données.
 */
async function chargerAbonnement() {
  const { data, error } = await db.rpc('mon_abonnement');
  if (error) {
    console.error('[Relais] Abonnement illisible :', error.message);
    return;
  }
  state.abonnement = (data && data[0]) || null;
}

function renderAbonnement() {
  const pastille = document.getElementById('sub-status-text');
  const bandeau = document.getElementById('bandeau-abonnement');
  const texte = document.getElementById('bandeau-abonnement-texte');
  const ab = state.abonnement;

  if (state.currentRole === 'admin') {
    if (bandeau) bandeau.hidden = true;
    return;
  }

  if (!ab || !ab.actif) {
    if (pastille) pastille.textContent = '🔴 Abonnement inactif';
    if (bandeau) bandeau.hidden = false;
    if (texte) {
      texte.innerHTML = !ab
        ? "Votre abonnement Relais n'est pas encore activé. <strong>Aucun prélèvement n'a lieu pour l'instant</strong> — le paiement en ligne arrive prochainement."
        : `Votre abonnement a expiré le ${new Date(ab.expire_le).toLocaleDateString('fr-FR')}. Renouvelez-le pour continuer à utiliser Relais.`;
    }
    return;
  }

  if (bandeau) bandeau.hidden = ab.jours_restants > 7;
  if (texte && ab.jours_restants <= 7) {
    texte.innerHTML = `Votre abonnement expire dans <strong>${ab.jours_restants} jour(s)</strong>.`;
  }

  if (pastille) {
    pastille.textContent = state.currentRole === 'merchant'
      ? (state.profile.merchant?.store_name || 'Espace marchand')
      : (state.profile.agency?.company_name || 'Espace agence');
  }
}

/**
 * Les agences que ce marchand a le droit de noter : celles qui ont réellement
 * livré pour lui. La règle est appliquée en base, pas ici.
 */
async function chargerAgencesNotables() {
  if (state.currentRole !== 'merchant') return;
  const { data, error } = await db.rpc('agences_notables');
  if (error) {
    console.error('[Relais] Agences notables indisponibles :', error.message);
    return;
  }
  state.notables = data || [];
}

/**
 * Dépose ou met à jour l'avis d'un marchand sur une agence.
 * La moyenne affichée dans l'annuaire est recalculée par la base.
 */
async function noterAgence(agencyId) {
  const agence = state.agencies.find(a => a.id === agencyId);
  const existant = state.notables?.find(n => n.agency_id === agencyId);
  if (!agence) return;

  const saisie = prompt(
    [
      `Votre note sur ${agence.name}, de 1 à 5 :`,
      '',
      '5 — livraisons rapides, reversements sans accroc',
      '1 — retards répétés ou difficultés de reversement'
    ].join(String.fromCharCode(10)),
    existant?.ma_note ? String(existant.ma_note) : '5'
  );
  if (saisie === null) return;

  const note = parseInt(saisie, 10);
  if (!(note >= 1 && note <= 5)) {
    alert('La note doit être un chiffre entre 1 et 5.');
    return;
  }

  const commentaire = prompt(
    ['Un commentaire ? Il sera visible des autres e-commerçants.', '(facultatif)']
      .join(String.fromCharCode(10)),
    existant?.mon_commentaire || ''
  );

  const avis = {
    agency_id: agencyId,
    merchant_id: state.profile.merchant.id,
    overall_rating: note,
    comment: (commentaire || '').trim() || null
  };

  // Un marchand ne note une agence qu'une fois : on écrase son avis précédent
  const { error } = await db.from('reviews').upsert(avis, { onConflict: 'agency_id,merchant_id' });

  if (error) {
    console.error('[Relais] Avis refusé :', error.message);
    alert(
      /row-level security/i.test(error.message)
        ? "Vous ne pouvez noter qu'une agence ayant réellement livré pour vous."
        : "Votre avis n'a pas pu être enregistré : " + error.message
    );
    return;
  }

  await chargerAgences();
  await chargerAgencesNotables();
  renderAgencies();
}


// =============================================================================
// TEMPS RÉEL — LE SIGNAL, PAS LE CONTENU
// =============================================================================

/**
 * Le navigateur n'a pas le droit de lire la table `messages` : la diffusion
 * en direct ne lui transporte donc AUCUN contenu. Elle sert uniquement de
 * signal — « quelque chose a bougé » — après quoi on relit la conversation
 * par le chemin normal, soumis aux règles de sécurité.
 *
 * Ce détour n'est pas une précaution de style : sans lui, il faudrait rendre
 * la table lisible au client, et le texte d'origine des messages redeviendrait
 * accessible.
 */
function ecouterEnDirect() {
  if (state.canalDirect) return;

  state.canalDirect = db
    .channel('relais-activite')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (signal) => rafraichirSurSignal(signal.new?.conversation_id))
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      (signal) => rafraichirSurSignal(signal.new?.conversation_id || signal.old?.conversation_id, true))
    .subscribe((etat) => {
      if (etat === 'SUBSCRIBED') console.log('[Relais] Écoute en direct active.');
      if (etat === 'CHANNEL_ERROR') console.warn('[Relais] Écoute en direct indisponible.');
    });
}

let rafraichissementEnCours = false;

async function rafraichirSurSignal(conversationId, toucheCommandes = false) {
  if (!conversationId || rafraichissementEnCours) return;

  // Le signal ne dit pas si la conversation nous concerne : on ne relit que
  // les nôtres, et les règles RLS écarteraient de toute façon les autres.
  const agencyId = Object.keys(state.conversationIds)
    .find(id => state.conversationIds[id] === conversationId);
  if (!agencyId) return;

  rafraichissementEnCours = true;
  try {
    await chargerMessages(agencyId);
    if (toucheCommandes) await chargerCommandes();

    if (agencyId === state.selectedAgencyId) {
      renderActiveChat();
      renderOrdersStrip();
    }
    renderConversationsSidebar();
    if (toucheCommandes) renderFinanceView();
  } finally {
    rafraichissementEnCours = false;
  }
}

async function chargerPointsFinanciers() {
  const { data, error } = await db
    .from('financial_payouts')
    .select('id, payout_reference, conversation_id, agency_id, merchant_id, period_start_date, period_end_date, total_delivered_orders, total_cod_collected, total_delivery_fees, net_payout_amount, status, proof_document_url, agency_note, merchant_note, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Relais] Points financiers indisponibles :', error.message);
    state.payouts = [];
    return;
  }
  state.payouts = data || [];
}

/** Le point financier en cours pour la conversation ouverte, s'il y en a un. */
function pointEnCours() {
  const conversationId = state.conversationIds[state.selectedAgencyId];
  return state.payouts.find(p =>
    p.conversation_id === conversationId && p.status !== 'confirmed');
}

/**
 * L'agence a deux gestes selon l'étape : arrêter les comptes, puis déclarer
 * le virement fait. Un seul bouton, dont le sens dépend de l'état.
 */
async function actionAgenceReversement() {
  const bouton = document.getElementById('btn-agency-make-payout');
  const point = pointEnCours();

  if (!point) {
    const conversationId = state.conversationIds[state.selectedAgencyId];
    if (!conversationId) return alert('Sélectionnez une conversation.');

    const bornes = periodRange(state.currentPeriod) || {
      from: new Date('2000-01-01'), to: new Date('2100-01-01')
    };
    const jour = (d) => new Date(d).toISOString().slice(0, 10);
    const veille = new Date(bornes.to.getTime() - 86400000);

    if (!confirm(
      `Arrêter les comptes pour ${periodLabel(state.currentPeriod)} ?\n\n` +
      `Les totaux seront calculés par Relais à partir des livraisons réellement ` +
      `encaissées, et figés. Le marchand verra exactement les mêmes chiffres.`
    )) return;

    bouton.disabled = true;
    const { error } = await db.rpc('generer_point_financier', {
      p_conversation: conversationId,
      p_debut: jour(bornes.from),
      p_fin: jour(veille)
    });
    bouton.disabled = false;

    if (error) return alert(error.message);
    await rafraichirFinance();
    return;
  }

  if (point.status === 'draft') {
    const preuve = prompt(
      'Référence ou nom du reçu de votre virement Mobile Money :\n' +
      '(Wave, Orange Money, MTN MoMo, Moov…)'
    );
    if (!preuve) return;

    bouton.disabled = true;
    const { error } = await db.rpc('declarer_virement', {
      p_point: point.id,
      p_preuve: preuve,
      p_note: `Virement de ${Number(point.net_payout_amount).toLocaleString()} FCFA`
    });
    bouton.disabled = false;

    if (error) return alert(error.message);
    await rafraichirFinance();
    return;
  }

  alert("Le virement est déclaré. C'est au marchand de confirmer qu'il a reçu les fonds.");
}

/**
 * Le marchand confirme, ou conteste. Sa confirmation est ce qui solde les
 * commandes : personne ne peut la donner à sa place.
 */
async function actionMarchandReversement() {
  const point = pointEnCours();
  if (!point) return alert("Aucun reversement en cours. L'agence doit d'abord arrêter les comptes.");

  if (point.status === 'draft') {
    return alert("L'agence n'a pas encore déclaré le virement. Patientez.");
  }

  const recu = confirm(
    `Reversement ${point.payout_reference}\n\n` +
    `Montant annoncé : ${Number(point.net_payout_amount).toLocaleString()} FCFA\n` +
    `Justificatif de l'agence : ${point.proof_document_url || '—'}\n\n` +
    `Cliquez sur OK si vous avez bien reçu cette somme.\n` +
    `Cliquez sur Annuler pour la contester.`
  );

  if (recu) {
    const { error } = await db.rpc('confirmer_reception_fonds', {
      p_point: point.id, p_note: 'Fonds reçus et vérifiés'
    });
    if (error) return alert(error.message);
  } else {
    const motif = prompt('Que constatez-vous ? (montant reçu, somme manquante, rien reçu…)');
    if (!motif) return;
    const { error } = await db.rpc('contester_point_financier', {
      p_point: point.id, p_motif: motif
    });
    if (error) return alert(error.message);
  }

  await rafraichirFinance();
}

async function rafraichirFinance() {
  await chargerCommandes();
  await chargerPointsFinanciers();
  renderFinanceView();
  renderOrdersStrip();
}

function renderFinanceView() {
  const agencySelect = document.getElementById('finance-agency-select');
  if (agencySelect && agencySelect.children.length === 0) {
    agencySelect.innerHTML = state.agencies.filter(a => a.isVerified).map(a => `
      <option value="${echapperHtml(a.id)}" ${a.id === state.selectedAgencyId ? 'selected' : ''}>
        ${a.flag} ${echapperHtml(a.name)} (${echapperHtml(a.city)})
      </option>
    `).join('');

    agencySelect.addEventListener('change', (e) => {
      state.selectedAgencyId = e.target.value;
      renderFinanceView();
    });
  }

  // Sélecteur de période : le bilan se calcule sur une journée, pas sur l'éternité
  const periodSelect = document.getElementById('finance-period-select');
  if (periodSelect && !periodSelect.dataset.bound) {
    periodSelect.value = state.currentPeriod;
    periodSelect.addEventListener('change', (e) => {
      state.currentPeriod = e.target.value;
      renderFinanceView();
    });
    periodSelect.dataset.bound = '1';
  }

  // Filtrer les commandes pour cette agence ET sur la période choisie
  const agencyOrders = state.orders
    .filter(o => o.agencyId === state.selectedAgencyId)
    .filter(o => isInPeriod(o.createdAt, state.currentPeriod));
  const deliveredOrders = agencyOrders.filter(o => o.status === 'delivered');

  const totalCollected = deliveredOrders.reduce((acc, curr) => acc + curr.codAmount, 0);
  const totalFees = deliveredOrders.reduce((acc, curr) => acc + curr.deliveryFee, 0);
  const netPayout = totalCollected - totalFees;

  document.getElementById('kpi-total-collected').textContent = `${totalCollected.toLocaleString()} FCFA`;
  document.getElementById('kpi-total-fees').textContent = `- ${totalFees.toLocaleString()} FCFA`;
  document.getElementById('kpi-net-payout').textContent = `${netPayout.toLocaleString()} FCFA`;

  // Les deux boutons de reversement n'appartiennent pas au meme acteur
  const point = pointEnCours();
  const badge = document.getElementById('kpi-payout-status-badge');
  if (badge) {
    badge.textContent = point
      ? ETATS_REVERSEMENT[point.status] || point.status
      : '🟡 Aucun reversement en cours';
  }

  const boutonAgence = document.getElementById('btn-agency-make-payout');
  const boutonMarchand = document.getElementById('btn-merchant-confirm-payout');
  if (boutonAgence) {
    boutonAgence.hidden = state.currentRole !== 'agency';
    boutonAgence.textContent = !point
      ? '🧮 Arrêter les comptes de la période'
      : point.status === 'draft'
        ? '📤 Déclarer le virement effectué'
        : '⏳ En attente du marchand';
    boutonAgence.disabled = point && point.status !== 'draft';
  }
  if (boutonMarchand) {
    boutonMarchand.hidden = state.currentRole !== 'merchant';
    boutonMarchand.disabled = !point || point.status !== 'initiated';
    boutonMarchand.textContent = point && point.status === 'initiated'
      ? "✅ J'ai bien reçu les fonds"
      : '✅ Confirmer la réception des fonds';
  }

  const periodEcho = document.getElementById('finance-period-echo');
  if (periodEcho) {
    periodEcho.textContent =
      `${deliveredOrders.length} livraison(s) réussie(s) sur ${agencyOrders.length} commande(s), pour ${periodLabel(state.currentPeriod)}.`;
  }

  // Tableau détaillé
  const tbody = document.getElementById('finance-orders-tbody');
  if (!tbody) return;

  if (agencyOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 2rem;">Aucune commande pour ${periodLabel(state.currentPeriod)}.</td></tr>`;
    return;
  }

  const isAgency = state.currentRole === 'agency';

  tbody.innerHTML = agencyOrders.map(order => {
    const net = order.status === 'delivered' ? (order.codAmount - order.deliveryFee) : 0;
    const enCours = order.status === 'pending' || order.status === 'in_transit';

    // Seule l'agence clôture une livraison : c'est elle qui a le colis et encaisse le cash
    const actions = isAgency && enCours
      ? `<button class="btn-status-action btn-status-ok" data-order="${echapperHtml(order.id)}" data-next="delivered">✅ Livré &amp; encaissé</button>
         <button class="btn-status-action btn-status-ko" data-order="${echapperHtml(order.id)}" data-next="failed">✖ Échec</button>`
      : `<span style="opacity:.5">—</span>`;

    return `
      <tr>
        <td><strong>${echapperHtml(order.id)}</strong><br><span style="opacity:.6; font-size:.75rem;">${formatOrderDate(order.createdAt)}</span></td>
        <td>${echapperHtml(order.productName)}</td>
        <td>${echapperHtml(order.recipientName)}<br><span style="opacity:.6; font-size:.75rem;">${echapperHtml(order.recipientPhone || '—')}</span></td>
        <td>${echapperHtml(order.recipientCity)}</td>
        <td style="color: #fff; font-weight: 600;">${order.codAmount.toLocaleString()} F</td>
        <td style="color: var(--warning);">${order.deliveryFee.toLocaleString()} F</td>
        <td style="color: var(--primary); font-weight: 700;">${net.toLocaleString()} F</td>
        <td><span class="order-badge ${order.status}">${formatStatus(order.status)}</span></td>
        <td>${order.payoutStatus === 'paid' ? '🟢 Réglé' : '🟡 En attente'}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join('');

  // Brancher les boutons de clôture fraîchement injectés
  tbody.querySelectorAll('.btn-status-action').forEach(btn => {
    btn.addEventListener('click', () => {
      updateOrderStatus(btn.dataset.order, btn.dataset.next);
    });
  });
}

/**
 * L'agence clôture sa tournée : c'est ce geste qui alimente tout le bilan.
 *
 * L'écriture part en base. Un déclencheur y vérifie que seule l'agence en
 * charge peut faire évoluer la livraison, pose `delivered_at`, et consigne
 * le changement dans order_status_logs — la trace qui tranchera un litige.
 */
async function updateOrderStatus(orderCode, nouveauStatutEcran) {
  const order = state.orders.find(o => o.id === orderCode);
  if (!order) return;

  const statutBase = STATUTS_ECRAN_VERS_BASE[nouveauStatutEcran];
  if (!statutBase) return;

  const { error } = await db
    .from('orders')
    .update({ status: statutBase })
    .eq('id', order.uuid);

  if (error) {
    console.error('[Relais] Clôture refusée :', error.message);
    alert(
      error.message.includes('agence en charge')
        ? "Seule l'agence en charge de cette livraison peut la clôturer."
        : "Le statut n'a pas pu être mis à jour. Réessayez dans un instant."
    );
    return;
  }

  await chargerCommandes();
  renderOrdersStrip();
  renderFinanceView();
  renderActiveChat();
}

// =============================================================================
// ESPACE SUPERADMIN (LUDGER)
// =============================================================================

function setupAdminPanel() {
  renderKYCQueue();
  renderSecurityLogs();
}

function renderKYCQueue() {
  const container = document.getElementById('kyc-queue-list');
  if (!container) return;

  // Un dossier rejete n'est plus du travail en attente : il ressort si l'agence
  // redepose des pieces, ce qui la remet en pending_verification.
  const pending = state.agencies.filter(a => a.statut === 'pending_verification');
  const badgeTitre = document.getElementById('admin-pending-badge');
  const badgeOnglet = document.getElementById('admin-pending-count');
  if (badgeTitre) badgeTitre.textContent = pending.length;
  // Un badge rouge affichant « 0 » alerte pour rien : on le masque.
  if (badgeOnglet) {
    badgeOnglet.textContent = pending.length;
    badgeOnglet.hidden = pending.length === 0;
  }

  if (pending.length === 0) {
    container.innerHTML = `<p style="color: var(--text-dim); font-size: 0.85rem;">Aucun dossier en attente de vérification.</p>`;
    return;
  }

  container.innerHTML = pending.map(agency => `
    <div class="kyc-item">
      <div class="kyc-header">
        <span class="kyc-name">${agency.flag} ${echapperHtml(agency.name)}</span>
        <span class="kyc-country">${echapperHtml(agency.city)}, ${echapperHtml(agency.countryName)}</span>
      </div>
      <div style="font-size: 0.78rem; color: var(--text-muted);">
        Identifiant fiscal déclaré : <strong>${echapperHtml(agency.legalId)}</strong> • Flotte : ${echapperHtml(agency.fleetSize)} livreurs
      </div>
      <div class="kyc-docs-list" id="kyc-docs-${agency.id}">
        <span style="opacity:.7">Chargement des pièces…</span>
      </div>
      <div class="kyc-actions">
        <button class="btn btn-primary-sm" onclick="approveAgencyKYC('${agency.id}')">
          ✅ Valider &amp; Certifier l'Agence
        </button>
        <button class="btn btn-secondary-sm" onclick="rejectAgencyKYC('${agency.id}')">
          ❌ Rejeter le dossier
        </button>
      </div>
    </div>
  `).join('');

  // Les pièces se chargent après coup : elles demandent un aller-retour au dépôt
  pending.forEach(agency => chargerPiecesDuDossier(agency));
}

/**
 * Les documents d'une agence, vus par l'administrateur.
 *
 * Le dépôt est privé : on ne construit pas d'URL permanente, on demande un
 * lien signé valable deux minutes au moment où l'admin clique.
 */
async function chargerPiecesDuDossier(agency) {
  const cible = document.getElementById(`kyc-docs-${agency.id}`);
  if (!cible) return;

  // Le chemin de dépôt est indexé sur le compte d'authentification de l'agence
  const { data: profil } = await db
    .from('profiles')
    .select('auth_user_id')
    .eq('id', agency.profileId)
    .maybeSingle();

  if (!profil?.auth_user_id) {
    cible.innerHTML = `<span style="color: var(--danger)">Profil introuvable.</span>`;
    return;
  }

  const { data: fichiers, error } = await db.storage
    .from('pieces-kyc')
    .list(profil.auth_user_id, { limit: 50 });

  if (error) {
    cible.innerHTML = `<span style="color: var(--danger)">Pièces illisibles : ${error.message}</span>`;
    return;
  }

  if (!fichiers || fichiers.length === 0) {
    cible.innerHTML = `
      <span style="color: var(--warning); font-weight: 600;">
        ⚠️ Aucune pièce déposée — ne certifiez pas ce dossier en l'état.
      </span>`;
    return;
  }

  cible.innerHTML = fichiers.map(f => `
    <button class="btn btn-outline-sm" data-doc-agence="${echapperHtml(profil.auth_user_id)}" data-doc-nom="${echapperHtml(f.name)}">
      📄 ${echapperHtml(f.name.replace(/^\d+-/, ''))} (${Math.round((f.metadata?.size || 0) / 1024)} Ko)
    </button>
  `).join('');

  cible.querySelectorAll('[data-doc-nom]').forEach(b =>
    b.addEventListener('click', () => ouvrirPiece(b.dataset.docAgence, b.dataset.docNom)));
}

/**
 * La certification est le geste le plus lourd de conséquence de Relais :
 * elle rend une agence visible auprès de tous les marchands. Seul un
 * administrateur peut la poser — le trigger protect_agency_verification
 * refuse toute autre origine.
 */
async function approveAgencyKYC(agencyId) {
  const agency = state.agencies.find(a => a.id === agencyId);
  if (!agency) return;

  if (!confirm(
    `Certifier « ${agency.name} » ?\n\n` +
    `Elle deviendra immédiatement visible dans l'annuaire de tous les e-commerçants ` +
    `des 5 pays, et pourra recevoir des commandes.`
  )) return;

  const { error } = await db
    .from('agencies')
    .update({
      status: 'verified',
      verified_at: new Date().toISOString(),
      verified_by: state.profile.id
    })
    .eq('id', agencyId);

  if (error) {
    console.error('[Relais] Certification refusée :', error.message);
    alert("La certification n'a pas pu être enregistrée : " + error.message);
    return;
  }

  await chargerAgences();
  renderKYCQueue();
  renderAgencies();
}

async function rejectAgencyKYC(agencyId) {
  const agency = state.agencies.find(a => a.id === agencyId);
  if (!agency) return;

  if (!confirm(
    `Rejeter le dossier de « ${agency.name} » ?\n\n` +
    `Elle restera invisible dans l'annuaire et devra redéposer ses pièces.`
  )) return;

  const { error } = await db
    .from('agencies')
    .update({ status: 'rejected', verified_by: state.profile.id })
    .eq('id', agencyId);

  if (error) {
    alert("Le rejet n'a pas pu être enregistré : " + error.message);
    return;
  }

  await chargerAgences();
  renderKYCQueue();
  renderAgencies();
}

// =============================================================================
// ESPACE DE L'AGENCE — CERTIFICATION ET PIÈCES JUSTIFICATIVES
// =============================================================================

const ETATS_CERTIFICATION = {
  pending_verification: {
    libelle: '🟡 Dossier en attente de vérification',
    explication: "Votre agence n'apparaît pas encore dans l'annuaire des e-commerçants. " +
                 "Déposez vos pièces justificatives ci-dessous : l'équipe Relais les examine " +
                 "et vous certifie manuellement.",
    alerte: true
  },
  verified: {
    libelle: '🟢 Agence certifiée Relais',
    explication: "Vous êtes visible dans l'annuaire des e-commerçants des 5 pays et pouvez " +
                 "recevoir des commandes.",
    alerte: false
  },
  rejected: {
    libelle: '🔴 Dossier refusé',
    explication: "Vos pièces n'ont pas permis de vous certifier. Déposez des documents " +
                 "lisibles et à jour, puis contactez le support.",
    alerte: true
  },
  suspended: {
    libelle: '⛔ Compte suspendu',
    explication: "Votre agence a été retirée de l'annuaire. Contactez le support Relais.",
    alerte: true
  }
};


// =============================================================================
// MON COMPTE — INFORMATIONS, ABONNEMENT, CLÔTURE
// =============================================================================

function renderMonCompte() {
  const infos = document.getElementById('compte-infos');
  const abo = document.getElementById('compte-abonnement');
  const p = state.profile;
  if (!infos || !p) return;

  // Tout ce qui s'affiche ici a ete saisi par le membre : on echappe au
  // seul endroit ou ces valeurs deviennent du HTML.
  const ligne = (cle, valeur) =>
    `<div class="paire-compte"><dt>${cle}</dt><dd>${echapperHtml(valeur ?? '—')}</dd></div>`;

  const roles = { merchant: 'E-commerçant', agency: 'Agence de livraison', admin: 'Administrateur' };

  let metier = '';
  if (p.role === 'merchant' && p.merchant) {
    metier = ligne('Boutique', p.merchant.store_name) +
             ligne('Catégories', (p.merchant.product_categories || []).join(', ') || '—');
  } else if (p.role === 'agency' && p.agency) {
    metier = ligne('Agence', p.agency.company_name) +
             ligne('Ville', p.agency.primary_city) +
             ligne('Certification', ETATS_CERTIFICATION[p.agency.status]?.libelle || p.agency.status);
  }

  infos.innerHTML =
    ligne('Nom', p.full_name) +
    ligne('E-mail', p.email) +
    ligne('Rôle', roles[p.role] || p.role) +
    ligne('Pays', PAYS[p.country]?.nom || p.country) +
    metier;

  const a = state.abonnement;
  abo.innerHTML = !a
    ? ligne('État', 'Aucun abonnement actif') +
      ligne('Note', "Aucun prélèvement n'a lieu pour l'instant. Le paiement en ligne arrive prochainement.")
    : ligne('État', a.actif ? '🟢 Actif' : '🔴 Expiré') +
      ligne('Formule', a.plan) +
      ligne('Échéance', new Date(a.expire_le).toLocaleDateString('fr-FR')) +
      ligne('Jours restants', a.jours_restants);
}

/**
 * La clôture efface l'identité mais conserve les opérations : un historique
 * commercial engage deux parties, l'une ne peut pas le faire disparaître seule.
 */
function setupClotureCompte() {
  const bouton = document.getElementById('btn-cloturer-compte');
  const retour = document.getElementById('cloture-retour');
  if (!bouton) return;

  bouton.addEventListener('click', async () => {
    const saisie = prompt(
      [
        'Cette action est définitive.',
        '',
        'Vos coordonnées et celles de vos clients seront effacées.',
        'Vos commandes passées resteront, sans plus vous identifier.',
        '',
        'Pour confirmer, tapez : CLOTURER'
      ].join('\n')
    );
    if (saisie === null) return;

    if (saisie.trim().toUpperCase() !== 'CLOTURER') {
      retour.hidden = false;
      retour.className = 'form-feedback form-feedback-erreur';
      retour.textContent = "Clôture annulée : le mot de confirmation ne correspond pas.";
      return;
    }

    bouton.disabled = true;
    bouton.textContent = 'Clôture en cours…';

    const { data, error } = await db.rpc('cloturer_mon_compte', { p_confirmation: 'CLOTURER' });

    if (error) {
      retour.hidden = false;
      retour.className = 'form-feedback form-feedback-erreur';
      retour.textContent = error.message;
      bouton.disabled = false;
      bouton.textContent = 'Clôturer définitivement mon compte';
      return;
    }

    retour.hidden = false;
    retour.className = 'form-feedback form-feedback-succes';
    retour.textContent = (data && data[0]?.message) || 'Compte clôturé.';
    setTimeout(() => seDeconnecter(), 2500);
  });
}

async function renderEspaceAgence() {
  if (state.currentRole !== 'agency') return;

  const fiche = state.profile?.agency;
  const etat = ETATS_CERTIFICATION[fiche?.status] || ETATS_CERTIFICATION.pending_verification;

  const bloc = document.getElementById('certification-etat');
  const texte = document.getElementById('certification-explication');
  const carte = document.getElementById('carte-certification');
  const badge = document.getElementById('agence-alerte-badge');

  if (bloc) bloc.textContent = etat.libelle;
  if (texte) texte.textContent = etat.explication;
  if (carte) carte.className = `certification-card ${etat.alerte ? 'en-attente' : 'certifiee'}`;
  if (badge) badge.hidden = !etat.alerte;

  await renderMesPieces();
}

/**
 * Les pièces déposées. Le dépôt n'est pas public : on génère un lien
 * temporaire à chaque affichage plutôt qu'une URL permanente.
 */
async function renderMesPieces() {
  const liste = document.getElementById('kyc-mes-pieces');
  if (!liste) return;

  const dossier = (await getSession())?.user?.id;
  if (!dossier) return;

  const { data, error } = await db.storage.from('pieces-kyc').list(dossier, { limit: 50 });

  if (error) {
    liste.innerHTML = `<p style="padding:1.1rem; color: var(--text-dim); font-size:.85rem;">Impossible de lister vos pièces : ${error.message}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    liste.innerHTML = `<p style="padding:1.1rem; color: var(--text-dim); font-size:.85rem;">Aucune pièce déposée pour l'instant.</p>`;
    return;
  }

  const modifiable = state.profile?.agency?.status !== 'verified';

  liste.innerHTML = data.map(f => `
    <div class="kyc-item">
      <div class="kyc-header">
        <span class="kyc-name">📄 ${echapperHtml(f.name.replace(/^\d+-/, ''))}</span>
        <span class="kyc-country">${Math.round((f.metadata?.size || 0) / 1024)} Ko</span>
      </div>
      <div class="btn-row" style="margin-top:.6rem; display:flex; gap:.5rem; flex-wrap:wrap;">
        <button class="btn btn-outline-sm" data-piece-voir="${echapperHtml(f.name)}">Consulter</button>
        ${modifiable ? `<button class="btn-status-action btn-status-ko" data-piece-suppr="${echapperHtml(f.name)}">Retirer</button>` : ''}
      </div>
    </div>
  `).join('');

  liste.querySelectorAll('[data-piece-voir]').forEach(b =>
    b.addEventListener('click', () => ouvrirPiece(dossier, b.dataset.pieceVoir)));
  liste.querySelectorAll('[data-piece-suppr]').forEach(b =>
    b.addEventListener('click', () => retirerPiece(dossier, b.dataset.pieceSuppr)));
}

async function ouvrirPiece(dossier, nom) {
  const { data, error } = await db.storage
    .from('pieces-kyc')
    .createSignedUrl(`${dossier}/${nom}`, 120); // lien valable 2 minutes

  if (error) {
    alert("Ce document n'a pas pu être ouvert : " + error.message);
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener');
}

async function retirerPiece(dossier, nom) {
  if (!confirm('Retirer ce document de votre dossier ?')) return;

  const { error } = await db.storage.from('pieces-kyc').remove([`${dossier}/${nom}`]);
  if (error) {
    alert("Le document n'a pas pu être retiré : " + error.message);
    return;
  }
  await renderMesPieces();
}

function setupDepotKYC() {
  const bouton = document.getElementById('btn-kyc-envoyer');
  const champ = document.getElementById('kyc-fichier');
  const retour = document.getElementById('kyc-retour');
  if (!bouton || !champ) return;

  const afficher = (message, type) => {
    if (!retour) return;
    retour.hidden = false;
    retour.className = `form-feedback form-feedback-${type}`;
    retour.innerHTML = message;
  };

  bouton.addEventListener('click', async () => {
    const fichier = champ.files?.[0];
    if (!fichier) {
      afficher('Choisissez d\'abord un document.', 'erreur');
      return;
    }
    if (fichier.size > 5 * 1024 * 1024) {
      afficher('Ce document dépasse 5 Mo. Réduisez-le ou scannez-le en qualité moindre.', 'erreur');
      return;
    }

    const session = await getSession();
    if (!session) return;

    bouton.disabled = true;
    bouton.textContent = 'Dépôt en cours…';

    // Le nom est horodaté : deux dépôts du même fichier ne s'écrasent pas
    const nomSur = `${Date.now()}-${fichier.name.replace(/[^\w.\-]/g, '_')}`;
    const { error } = await db.storage
      .from('pieces-kyc')
      .upload(`${session.user.id}/${nomSur}`, fichier, { contentType: fichier.type });

    bouton.disabled = false;
    bouton.textContent = 'Déposer ce document';

    if (error) {
      console.error('[Relais] Dépôt refusé :', error.message);
      afficher('Le dépôt a échoué : ' + error.message, 'erreur');
      return;
    }

    champ.value = '';
    afficher('Document déposé. Il sera examiné par l\'équipe Relais.', 'succes');
    await renderMesPieces();
  });
}

/**
 * Le journal de sécurité rejoue le texte qu'un membre a tenté d'envoyer. Ce
 * texte est écrit par lui, pas par nous : l'insérer tel quel dans la page de
 * l'administrateur reviendrait à lui laisser exécuter du code dans la session
 * la plus privilégiée de la plateforme. Tout ce qui vient d'un membre passe
 * donc par ici avant d'atteindre innerHTML.
 */
function echapperHtml(valeur) {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Le filtre enregistre l'expression régulière qui a déclenché. Utile pour
 * déboguer, illisible pour un humain : « appelle[\s\-_]*moi » ne dit rien à
 * personne. On traduit avant d'afficher, et on garde le motif technique en
 * infobulle.
 */
function traduireDetection(motif) {
  const m = (motif || '').toLowerCase();
  if (m.includes('whatsapp') || m.includes('wa\\.me')) return 'Lien WhatsApp';
  if (m.includes('telegram') || m.includes('t\\.me'))  return 'Lien Telegram';
  if (m.includes('viber') || m.includes('signal'))     return 'Autre messagerie';
  if (m.includes('lettres'))                           return 'Numéro écrit en toutes lettres';
  if (m.includes('appelle'))                           return 'Invitation à appeler directement';
  if (m.includes('contacte'))                          return 'Invitation à un contact direct';
  if (m.includes('num') || m.includes('contact') || m.includes('tel')) return 'Partage de coordonnées';
  if (m.includes('chiffres'))                          return 'Numéro de téléphone';
  return 'Coordonnées détectées';
}

/**
 * Journal des tentatives de contournement. La table security_violations n'est
 * lisible que par un administrateur (policy violations_select_admin), et seule
 * la fonction serveur y écrit.
 */
async function chargerJournalSecurite() {
  if (state.currentRole !== 'admin') return;

  const { data, error } = await db
    .from('security_violations')
    .select('id, detected_pattern, attempted_content, action_taken, created_at, profiles(email, country)')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[Relais] Journal de sécurité indisponible :', error.message);
    return;
  }

  // La traduction se fait ici, à la source : les deux écrans qui lisent ce
  // journal (le tableau de bord et le panneau SuperAdmin) affichent alors le
  // même libellé, et aucun des deux ne peut oublier de traduire.
  state.securityLogs = (data || []).map(v => ({
    time: formatOrderDate(new Date(v.created_at)),
    user: v.profiles?.email || 'Compte supprimé',
    country: PAYS[v.profiles?.country]?.nom || v.profiles?.country || '—',
    pattern: traduireDetection(v.detected_pattern),
    motifTechnique: v.detected_pattern || '',
    action: v.action_taken === 'masked_and_warned' ? 'Masqué et signalé' : v.action_taken,
    tentative: v.attempted_content
  }));
}

function renderSecurityLogs() {
  const feed = document.getElementById('security-logs-feed');
  if (!feed) return;

  if (state.securityLogs.length === 0) {
    feed.innerHTML = `<p style="color: var(--text-dim); font-size: 0.85rem;">Aucune tentative de contournement enregistrée.</p>`;
    return;
  }

  // Tout ce qui suit vient de la base ; le texte intercepté vient d'un membre.
  // Rien n'est concaténé sans passer par echapperHtml().
  feed.innerHTML = state.securityLogs.map(log => `
    <div class="log-entry">
      <div class="log-motif" title="Motif technique : ${echapperHtml(log.motifTechnique)}">
        ${echapperHtml(log.pattern)}
      </div>
      <div class="log-meta">${echapperHtml(log.time)} • ${echapperHtml(log.country)} • ${echapperHtml(log.user)}</div>
      ${log.tentative
        ? `<div class="log-content">« ${echapperHtml(log.tentative)} »</div>`
        : ''}
      <div class="log-action">${echapperHtml(log.action)}</div>
    </div>
  `).join('');
}

// =============================================================================
// NAVIGATION & MODALS
// =============================================================================

function setupTabNavigation() {
  const tabBtns = document.querySelectorAll('.tab-item');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });
}

/**
 * Chaque rôle n'a accès qu'à ses propres écrans.
 *
 * L'annuaire est l'outil du marchand : c'est lui qui cherche une agence.
 * Une agence n'a rien à y faire — ni pour observer ses concurrentes, ni
 * pour approcher des marchands. Elle voit qui l'a contactée, ses livraisons
 * et son bilan, rien d'autre.
 */
const ONGLETS_PAR_ROLE = {
  merchant: ['tableau', 'directory', 'chat', 'finance', 'compte'],
  agency:   ['tableau', 'chat', 'agence', 'finance', 'compte'],
  admin:    ['tableau', 'directory', 'chat', 'finance', 'admin']
};

function ongletsAutorises() {
  return ONGLETS_PAR_ROLE[state.currentRole] || [];
}

function appliquerOngletsAutorises(role) {
  const autorises = ONGLETS_PAR_ROLE[role] || [];

  document.querySelectorAll('.tab-item').forEach(btn => {
    const permis = autorises.includes(btn.dataset.tab);
    btn.style.display = permis ? '' : 'none';
    btn.disabled = !permis;
  });

  // Un onglet interdit ne doit pas rester affiché s'il était actif
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const nom = panel.id.replace(/^view-/, '');
    if (!autorises.includes(nom)) panel.classList.remove('active');
  });

  // On ouvre le premier écran auquel ce rôle a droit
  if (autorises.length) switchTab(autorises[0]);
}

/**
 * Les chiffres du tableau de bord vieillissent dès qu'on agit ailleurs :
 * on les relit en revenant dessus plutôt que d'afficher un état périmé.
 */
async function rafraichirTableauDeBord() {
  await chargerTableauDeBord();
  renderTableauDeBord();
}

function switchTab(tabName) {
  // Garde-fou : même appelé depuis la console, un onglet interdit reste fermé
  if (!ongletsAutorises().includes(tabName)) {
    console.warn(`[Relais] Onglet « ${tabName} » non autorisé pour le rôle ${state.currentRole}.`);
    return;
  }

  document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

  const activeBtn = document.querySelector(`.tab-item[data-tab="${tabName}"]`);
  const activePanel = document.getElementById(`view-${tabName}`);

  if (activeBtn) activeBtn.classList.add('active');
  if (activePanel) activePanel.classList.add('active');

  // Seul l'onglet de discussion se comporte en application plein écran : la
  // page ne défile pas, c'est le fil de messages qui défile à l'intérieur.
  // Les autres écrans restent des pages ordinaires.
  document.body.classList.toggle('vue-chat', tabName === 'chat');

  if (tabName === 'finance') renderFinanceView();
  if (tabName === 'chat') renderActiveChat();
  if (tabName === 'agence') renderEspaceAgence();
  if (tabName === 'compte') renderMonCompte();
  if (tabName === 'tableau') rafraichirTableauDeBord();
  if (tabName === 'admin') renderKYCQueue();
}


function setupModals() {
  // Modal Commande
  const orderModal = document.getElementById('modal-order-create');
  document.getElementById('btn-open-order-modal')?.addEventListener('click', () => {
    orderModal.style.display = 'flex';
  });
  document.getElementById('btn-close-order-modal')?.addEventListener('click', () => {
    orderModal.style.display = 'none';
  });
  document.getElementById('btn-cancel-order')?.addEventListener('click', () => {
    orderModal.style.display = 'none';
  });

  // Modal Pricing
  const pricingModal = document.getElementById('modal-pricing');
  document.getElementById('btn-open-pricing')?.addEventListener('click', () => {
    pricingModal.style.display = 'flex';
  });
  document.getElementById('btn-close-pricing-modal')?.addEventListener('click', () => {
    pricingModal.style.display = 'none';
  });

  document.getElementById('btn-subscribe-merchant')?.addEventListener('click', () => {
    alert('Simulation : Paiement Mobile Money de 10 000 FCFA validé via Wave / MTN MoMo. Votre accès Marchand est actif pour 30 jours.');
    pricingModal.style.display = 'none';
  });

  document.getElementById('btn-subscribe-agency')?.addEventListener('click', () => {
    alert('Simulation : Abonnement Agence Certifiée de 25 000 FCFA activé. Votre profil est mis en avant dans l\'annuaire.');
    pricingModal.style.display = 'none';
  });
}

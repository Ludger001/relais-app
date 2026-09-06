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
    .select('id, company_name, legal_registration_number, country, primary_city, covered_areas, base_delivery_fee, cod_payout_frequency, has_warehousing, fleet_size, status, rating_avg, rating_count')
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

  // Conversations chargées depuis Supabase (Bloc 5)
  conversations: {},

  // Commandes COD chargées depuis Supabase (Bloc 5)
  orders: [],

  // Tentatives de contournement — table security_violations (Bloc 7)
  securityLogs: []
};

// 2. INITIALISATION AU CHARGEMENT DU DOM
document.addEventListener('DOMContentLoaded', async () => {
  // Aucune donnee ne s'affiche avant de savoir qui est connecte.
  // exigerConnexion() redirige vers connexion.html s'il n'y a pas de session.
  const profil = await exigerConnexion();
  if (!profil) return;

  appliquerProfil(profil);

  await chargerAgences();

  renderAgencies();
  setupRoleSwitcher();
  setupTabNavigation();
  setupCountryFilters();
  setupChat();
  setupOrdersAndFinance();
  setupAdminPanel();
  setupModals();
  renderFinanceView();
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

  // L'onglet SuperAdmin n'existe que pour un administrateur
  const ongletAdmin = document.getElementById('tab-btn-admin');
  if (ongletAdmin) ongletAdmin.style.display = profil.role === 'admin' ? 'flex' : 'none';

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
        
        <h3 class="agency-name">${agency.name}</h3>
        <div class="agency-location">📍 ${agency.city}, ${agency.countryName}</div>

        <div class="agency-stats-pills">
          <span class="stat-pill">⭐ <strong>${agency.rating}</strong> (${agency.reviewCount} avis)</span>
          <span class="stat-pill">⏱ Reversement : <strong>${agency.payoutText}</strong></span>
          <span class="stat-pill">🛵 Flotte : <strong>${agency.fleetSize} livreurs</strong></span>
        </div>

        <ul class="agency-features-list">
          <li>Zones : ${agency.areas.slice(0, 3).join(', ')}...</li>
          <li>Entreposage sécurisé : ${agency.hasStorage ? 'Oui (Stock tampon disponible)' : 'Non'}</li>
          <li>Enregistrement : ${agency.legalId}</li>
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

  function handleSend() {
    const rawText = inputField.value.trim();
    if (!rawText) return;

    // 1. Passage par le filtre anti-contournement Relais
    const inspection = inspectAndSanitizeMessage(rawText);

    if (inspection.isBlocked) {
      // Déclencher l'alerte visuelle
      const toast = document.getElementById('filter-alert-toast');
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 6000);

      // Enregistrer l'incident dans les logs admin
      state.securityLogs.unshift({
        time: 'À l\'instant',
        user: state.currentRole === 'merchant' ? 'E-commerçant Actif' : 'Agence Connectée',
        country: 'Côte d\'Ivoire',
        pattern: inspection.violations[0] || 'Coordonnées détectées',
        action: 'Masqué côté serveur & Signalé'
      });
      renderSecurityLogs();
    }

    // 2. Ajouter le message (texte assaini pour distribution)
    const activeMessages = state.conversations[state.selectedAgencyId] || [];
    activeMessages.push({
      id: Date.now(),
      sender: state.currentRole,
      time: 'À l\'instant',
      text: inspection.cleanText,
      hasViolation: inspection.isBlocked
    });

    inputField.value = '';
    renderActiveChat();

    // 3. Réponse simulée de l'agence après 1,5 seconde
    if (state.currentRole === 'merchant') {
      setTimeout(() => {
        activeMessages.push({
          id: Date.now() + 1,
          sender: 'agency',
          time: 'À l\'instant',
          text: 'Bien reçu ! Nous prenons en charge la livraison. Les fonds COD seront comptabilisés dès encaissement chez votre client.'
        });
        renderActiveChat();
      }, 1500);
    }
  }

  sendBtn?.addEventListener('click', handleSend);
  inputField?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
  });

  // Boutons d'essais rapides pour tester les filtres
  document.querySelectorAll('.btn-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      inputField.value = chip.dataset.test;
      inputField.focus();
    });
  });
}

function renderConversationsSidebar() {
  const container = document.getElementById('conversations-list-container');
  if (!container) return;

  const agencyList = state.agencies.filter(a => state.conversations[a.id]);

  if (agencyList.length === 0) {
    container.innerHTML = `
      <div style="padding:1.5rem; color: var(--text-dim); font-size:.85rem; line-height:1.6;">
        Aucune conversation pour l'instant.<br>
        Contactez une agence depuis l'annuaire pour en ouvrir une.
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
            <span class="conv-name">${agency.name}</span>
            <span class="conv-time">10:18</span>
          </div>
          <div class="conv-last-msg">${lastMsg}</div>
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
}

function startChatWithAgency(agencyId) {
  state.selectedAgencyId = agencyId;
  if (!state.conversations[agencyId]) {
    state.conversations[agencyId] = [
      {
        id: Date.now(),
        sender: 'agency',
        time: 'À l\'instant',
        text: 'Bonjour ! Heureux de collaborer avec vous sur Relais. Vous pouvez nous transmettre vos commandes directement ici.'
      }
    ];
  }
  switchTab('chat');
  renderConversationsSidebar();
  renderActiveChat();
}

function renderActiveChat() {
  const container = document.getElementById('messages-stream');
  const agency = state.agencies.find(a => a.id === state.selectedAgencyId) || state.agencies[0];

  // Aucune agence disponible : on l'annonce au lieu de planter
  if (!agency) {
    document.getElementById('chat-partner-name').textContent = 'Aucune conversation';
    document.getElementById('chat-partner-flag').textContent = '💬';
    document.getElementById('chat-partner-meta').textContent =
      "Ouvrez l'annuaire et contactez une agence certifiée pour démarrer.";
    if (container) {
      container.innerHTML = `
        <div style="text-align:center; padding:3rem; color: var(--text-dim);">
          <p style="font-size:1.05rem; margin-bottom:.4rem;">Vous n'avez encore aucune conversation.</p>
          <p style="font-size:.85rem;">Rendez-vous dans l'annuaire et cliquez sur « Discuter &amp; Commander ».</p>
        </div>`;
    }
    renderOrdersStrip();
    return;
  }

  // Header chat
  document.getElementById('chat-partner-name').textContent = agency.name;
  document.getElementById('chat-partner-flag').textContent = agency.flag;
  document.getElementById('chat-partner-meta').textContent = `${agency.city}, ${agency.countryName} • Reversement ${agency.payoutText}`;

  if (!container) return;

  const msgs = state.conversations[agency.id] || [];

  container.innerHTML = msgs.map(m => {
    const isSent = (state.currentRole === 'merchant' && m.sender === 'merchant') || 
                   (state.currentRole === 'agency' && m.sender === 'agency');
    return `
      <div class="message-bubble-wrap ${isSent ? 'sent' : 'received'}">
        <div class="bubble ${m.hasViolation ? 'violation' : ''}">
          ${m.text}
        </div>
        <span class="msg-time">${m.time}</span>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
  renderOrdersStrip();
}

// =============================================================================
// MODULE DE COMMANDES & POINT FINANCIER COD
// =============================================================================

function renderOrdersStrip() {
  const container = document.getElementById('strip-cards-container');
  const countEl = document.getElementById('strip-order-count');
  const sumEl = document.getElementById('strip-cod-sum');

  const agencyOrders = state.orders.filter(o => o.agencyId === state.selectedAgencyId);
  
  if (countEl) countEl.textContent = agencyOrders.length;

  const totalCod = agencyOrders.reduce((acc, curr) => acc + curr.codAmount, 0);
  if (sumEl) sumEl.textContent = `${totalCod.toLocaleString()} FCFA`;

  if (!container) return;

  container.innerHTML = agencyOrders.map(order => `
    <div class="mini-order-card">
      <div>
        <div class="mini-order-code">${order.id}</div>
        <div class="mini-order-prod">${order.productName} • ${order.recipientCity}</div>
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
  orderForm?.addEventListener('submit', (e) => {
    e.preventDefault();

    const newOrder = {
      id: `REL-CMD-${Math.floor(1000 + Math.random() * 9000)}`,
      agencyId: state.selectedAgencyId,
      productName: document.getElementById('order-product-name').value,
      qty: parseInt(document.getElementById('order-product-qty').value, 10),
      codAmount: parseFloat(document.getElementById('order-cod-amount').value),
      deliveryFee: parseFloat(document.getElementById('order-delivery-fee').value),
      recipientName: document.getElementById('order-recipient-name').value,
      recipientPhone: document.getElementById('order-recipient-phone').value,
      recipientCity: document.getElementById('order-recipient-city').value,
      recipientAddress: document.getElementById('order-recipient-address').value,
      status: 'pending',
      payoutStatus: 'unpaid',
      createdAt: new Date()
    };

    // Ajouter la commande
    state.orders.unshift(newOrder);

    // Injecter une carte de confirmation de commande dans le chat
    const activeMessages = state.conversations[state.selectedAgencyId] || [];
    activeMessages.push({
      id: Date.now(),
      sender: 'merchant',
      time: 'À l\'instant',
      text: `📦 <strong>NOUVEL ORDRE DE LIVRAISON COD [${newOrder.id}]</strong><br>` +
            `Produit : ${newOrder.productName} (x${newOrder.qty})<br>` +
            `Montant cash à encaisser : <strong>${newOrder.codAmount.toLocaleString()} FCFA</strong><br>` +
            `Frais agence : ${newOrder.deliveryFee.toLocaleString()} FCFA<br>` +
            `<br><strong>Destinataire</strong><br>` +
            `${newOrder.recipientName}<br>` +
            `📞 <strong>${newOrder.recipientPhone}</strong><br>` +
            `📍 ${newOrder.recipientAddress}, ${newOrder.recipientCity}<br>` +
            `<em style="opacity:.75">Coordonnées transmises par Relais pour cette livraison uniquement.</em>`,
      isOrderCard: true
    });

    // Fermer modal et rafraîchir
    document.getElementById('modal-order-create').style.display = 'none';
    renderActiveChat();
    renderOrdersStrip();
    renderFinanceView();
  });

  // Boutons du point financier
  document.getElementById('btn-quick-view-payout')?.addEventListener('click', () => {
    switchTab('finance');
  });

  document.getElementById('btn-agency-make-payout')?.addEventListener('click', () => {
    alert('Simulation : L\'agence a généré le reçu de virement Mobile Money (Wave / Orange Money). Statut passé à "En attente de confirmation marchand".');
    document.getElementById('kpi-payout-status-badge').textContent = '🟠 Virement envoyé par l\'agence (Justificatif joint)';
  });

  document.getElementById('btn-merchant-confirm-payout')?.addEventListener('click', () => {
    alert('Simulation : Le marchand confirme la bonne réception des fonds COD sur son compte Mobile Money. Le cycle est clôturé sans litige !');
    document.getElementById('kpi-payout-status-badge').textContent = '🟢 Reversement 100% Réglé & Confirmé';
    
    // Marquer les commandes comme payées
    state.orders.forEach(o => {
      if (o.agencyId === state.selectedAgencyId && o.status === 'delivered') {
        o.payoutStatus = 'paid';
      }
    });
    renderFinanceView();
  });
}

function renderFinanceView() {
  const agencySelect = document.getElementById('finance-agency-select');
  if (agencySelect && agencySelect.children.length === 0) {
    agencySelect.innerHTML = state.agencies.filter(a => a.isVerified).map(a => `
      <option value="${a.id}" ${a.id === state.selectedAgencyId ? 'selected' : ''}>
        ${a.flag} ${a.name} (${a.city})
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
      ? `<button class="btn-status-action btn-status-ok" data-order="${order.id}" data-next="delivered">✅ Livré &amp; encaissé</button>
         <button class="btn-status-action btn-status-ko" data-order="${order.id}" data-next="failed">✖ Échec</button>`
      : `<span style="opacity:.5">—</span>`;

    return `
      <tr>
        <td><strong>${order.id}</strong><br><span style="opacity:.6; font-size:.75rem;">${formatOrderDate(order.createdAt)}</span></td>
        <td>${order.productName}</td>
        <td>${order.recipientName}<br><span style="opacity:.6; font-size:.75rem;">${order.recipientPhone || '—'}</span></td>
        <td>${order.recipientCity}</td>
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

// L'agence clôture sa tournée : c'est ce geste qui alimente tout le bilan financier
function updateOrderStatus(orderId, newStatus) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;

  const previous = order.status;
  order.status = newStatus;

  // Trace pour l'audit (table order_status_logs côté base)
  state.securityLogs = state.securityLogs || [];

  const messages = state.conversations[order.agencyId] || [];
  messages.push({
    id: Date.now(),
    sender: 'agency',
    time: 'À l\'instant',
    text: newStatus === 'delivered'
      ? `✅ <strong>[${order.id}] Livrée et encaissée.</strong><br>` +
        `${order.codAmount.toLocaleString()} FCFA collectés chez ${order.recipientName}.<br>` +
        `Net à reverser sur cette commande : <strong>${(order.codAmount - order.deliveryFee).toLocaleString()} FCFA</strong>.`
      : `✖ <strong>[${order.id}] Tentative de livraison échouée.</strong><br>` +
        `Client injoignable ou refus. Aucun encaissement. Le colis reste en attente d'instruction.`
  });
  state.conversations[order.agencyId] = messages;

  console.log(`[Relais] Commande ${orderId} : ${previous} → ${newStatus}`);

  renderActiveChat();
  renderOrdersStrip();
  renderFinanceView();
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

  const pending = state.agencies.filter(a => !a.isVerified);
  document.getElementById('admin-pending-badge').textContent = pending.length;
  document.getElementById('admin-pending-count').textContent = pending.length;

  if (pending.length === 0) {
    container.innerHTML = `<p style="color: var(--text-dim); font-size: 0.85rem;">Aucun dossier en attente de vérification.</p>`;
    return;
  }

  container.innerHTML = pending.map(agency => `
    <div class="kyc-item">
      <div class="kyc-header">
        <span class="kyc-name">${agency.flag} ${agency.name}</span>
        <span class="kyc-country">${agency.city}, ${agency.countryName}</span>
      </div>
      <div style="font-size: 0.78rem; color: var(--text-muted);">
        Identifiant fiscal déclaré : <strong>${agency.legalId}</strong> • Flotte : ${agency.fleetSize} livreurs
      </div>
      <div class="kyc-docs-list">
        <span>📄 Registre RCCM/NINEA vérifié</span>
        <span>📸 Photos du local inspectées</span>
      </div>
      <div class="kyc-actions">
        <button class="btn btn-primary-sm" onclick="approveAgencyKYC('${agency.id}')">
          ✅ Valider & Certifier l'Agence
        </button>
        <button class="btn btn-secondary-sm" onclick="rejectAgencyKYC('${agency.id}')">
          ❌ Demander Complément
        </button>
      </div>
    </div>
  `).join('');
}

function approveAgencyKYC(agencyId) {
  const agency = state.agencies.find(a => a.id === agencyId);
  if (agency) {
    agency.isVerified = true;
    agency.rating = 5.0;
    agency.reviewCount = 1;
    alert(`L'agence ${agency.name} est désormais certifiée et visible dans l'annuaire des 5 pays.`);
    renderKYCQueue();
    renderAgencies();
  }
}

function rejectAgencyKYC(agencyId) {
  alert('Demande de pièces justificatives complémentaires envoyée à l\'agence.');
}

function renderSecurityLogs() {
  const feed = document.getElementById('security-logs-feed');
  if (!feed) return;

  feed.innerHTML = state.securityLogs.map(log => `
    <div class="log-entry">
      <div class="log-meta">${log.time} • ${log.country} • ${log.user}</div>
      <div class="log-content">Détection : ${log.pattern} ➔ Action : ${log.action}</div>
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

function switchTab(tabName) {
  document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

  const activeBtn = document.querySelector(`.tab-item[data-tab="${tabName}"]`);
  const activePanel = document.getElementById(`view-${tabName}`);

  if (activeBtn) activeBtn.classList.add('active');
  if (activePanel) activePanel.classList.add('active');

  if (tabName === 'finance') renderFinanceView();
  if (tabName === 'chat') renderActiveChat();
}

function setupRoleSwitcher() {
  const roleBtns = document.querySelectorAll('.role-btn');
  roleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      roleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentRole = btn.dataset.role;

      // Afficher / masquer l'onglet admin selon le rôle
      const adminTab = document.getElementById('tab-btn-admin');
      if (state.currentRole === 'admin') {
        adminTab.style.display = 'flex';
        switchTab('admin');
      } else {
        adminTab.style.display = 'none';
        if (document.getElementById('view-admin').classList.contains('active')) {
          switchTab('directory');
        }
      }

      // Mise à jour de l'indicateur d'abonnement
      const subPill = document.getElementById('sub-status-text');
      if (state.currentRole === 'merchant') {
        subPill.textContent = 'Pass Marchand Multi-Pays Actif';
      } else if (state.currentRole === 'agency') {
        subPill.textContent = 'Pack Agence Certifiée Actif';
      } else {
        subPill.textContent = 'SuperAdmin Root';
      }

      renderActiveChat();
      // Les actions de clôture n'appartiennent qu'à l'agence : il faut redessiner le bilan
      renderFinanceView();
    });
  });
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

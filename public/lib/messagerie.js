/**
 * =============================================================================
 * RELAIS — LA MESSAGERIE
 * =============================================================================
 *
 * Ce que faisait la version précédente : afficher une liste de messages. Rien
 * d'autre. Pas d'accusé de lecture, pas de présence, pas de « en train
 * d'écrire », pas de compteur de non-lus. L'aperçu d'une conversation affichait
 * « Nouvelle conversation » alors qu'elle contenait dix messages, et l'heure
 * « 10:18 » était écrite en dur dans le code.
 *
 * LA FAUTE DE FOND
 * ----------------
 * Tout était indexé par AGENCE. C'est acceptable vu du marchand — une
 * conversation par agence — mais faux vu de l'agence, dont les interlocuteurs
 * sont des marchands. Une agence se retrouvait donc listée à côté d'elle-même.
 *
 * Ici tout est indexé par CONVERSATION. C'est la seule clé qui ait le même sens
 * des deux côtés.
 *
 * CE QUI REND UNE MESSAGERIE VIVANTE
 * ----------------------------------
 * Trois choses, et aucune n'est cosmétique :
 *
 *   1. Le message part TOUT DE SUITE. Il s'affiche avant l'aller-retour réseau,
 *      avec une horloge, puis un ✓ quand le serveur confirme. Attendre deux
 *      secondes devant un écran figé donne l'impression que rien ne marche.
 *   2. On sait si l'autre a lu. ✓ envoyé, ✓✓ lu.
 *   3. On sait si l'autre est là. « en ligne », « en train d'écrire… ».
 *
 * Les deux dernières passent par Realtime, sur un canal privé par conversation
 * dont l'accès est verrouillé par une règle sur realtime.messages : seuls les
 * deux participants peuvent s'y abonner.
 */

/* =============================================================================
   PETITS OUTILS
   ============================================================================= */

/** « 14:32 » aujourd'hui, « Hier », « lun. 2 sept. » au-delà. */
function heureCourte(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const jour = (d) => d.toDateString();
  const maintenant = new Date();
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);

  if (jour(date) === jour(maintenant)) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  if (jour(date) === jour(hier)) return 'Hier';
  if (maintenant - date < 7 * 24 * 3600 * 1000) {
    return date.toLocaleDateString('fr-FR', { weekday: 'short' });
  }
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** L'heure seule, sous une bulle. */
function heureDuMessage(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * « Vu à l'instant », « vu il y a 12 min »… Une date brute sous un nom
 * n'apprend rien : ce qu'on veut savoir, c'est si la personne est joignable.
 */
function depuisQuand(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const minutes = Math.floor((Date.now() - date) / 60000);
  if (minutes < 1)  return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24)  return `il y a ${heures} h`;
  const jours = Math.floor(heures / 24);
  if (jours === 1)  return 'hier';
  return `il y a ${jours} jours`;
}

/** « Ivoire Express COD » donne IE. Deux lettres, jamais une. */
function initiales(nom) {
  return (nom || '?')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((m) => m[0]).join('').toUpperCase();
}

/**
 * Une couleur d'avatar stable, tirée du nom. Deux interlocuteurs différents
 * n'ont pas la même pastille, et la même personne garde la sienne d'une session
 * à l'autre — c'est ce qui permet de reconnaître une conversation du coin de
 * l'œil, sans lire.
 */
const TEINTES = ['#059669', '#4f46e5', '#b45309', '#be123c', '#0891b2', '#7c3aed', '#c2410c'];
function couleurDe(nom) {
  let somme = 0;
  for (const c of (nom || '?')) somme = (somme * 31 + c.charCodeAt(0)) % 100000;
  return TEINTES[somme % TEINTES.length];
}

/** « Aujourd'hui », « Hier », sinon la date en toutes lettres. */
function separateurDeJour(date, datePrecedente) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const jour = (d) => d.toDateString();
  if (datePrecedente instanceof Date && !isNaN(datePrecedente)
      && jour(datePrecedente) === jour(date)) return '';

  const maintenant = new Date();
  const hier = new Date();
  hier.setDate(hier.getDate() - 1);

  let libelle;
  if (jour(date) === jour(maintenant)) libelle = "Aujourd'hui";
  else if (jour(date) === jour(hier))  libelle = 'Hier';
  else libelle = date.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
    year: date.getFullYear() === maintenant.getFullYear() ? undefined : 'numeric'
  });

  return `<div class="separateur-jour">${echapperHtml(libelle)}</div>`;
}

/* =============================================================================
   L'ÉTAT DE LA MESSAGERIE
   ============================================================================= */

const messagerie = {
  fils: [],              // la liste, telle que la base la calcule
  actif: null,           // conversation_id ouverte
  messages: {},          // { [conversation_id]: [...] }
  canal: null,           // l'abonnement Realtime de la conversation ouverte
  enLigne: false,        // l'autre est-il connecté ?
  vuA: null,             // sinon, quand l'a-t-on vu ?
  ecritDepuis: 0,        // horodatage du dernier « il tape »
  brouillons: {},        // ce qu'on avait commencé à écrire, par conversation
  aLaFin: true           // le fil est-il collé en bas ?
};

/** Le fil ouvert, tel que la base le décrit. */
function filActif() {
  return messagerie.fils.find((f) => f.conversation_id === messagerie.actif) || null;
}

/* =============================================================================
   CHARGEMENT
   ============================================================================= */

/**
 * La liste des conversations vient d'une seule fonction en base, qui sait déjà
 * qui est en face, quel est le dernier message et combien restent à lire. Le
 * navigateur n'a plus rien à deviner — c'est ce qui a fait disparaître les
 * « Nouvelle conversation » et les heures inventées.
 */
async function chargerFils() {
  const { data, error } = await db.rpc('mes_conversations');
  if (error) {
    console.error('[Relais] Conversations indisponibles :', error.message);
    return;
  }
  messagerie.fils = (data || []).map((f) => ({
    ...f,
    dernier_le: f.dernier_a ? new Date(f.dernier_a) : null
  }));

  // Garder la compatibilité avec le reste de l'application, qui raisonne
  // encore par agence pour l'annuaire et le bilan financier.
  state.conversationIds = {};
  for (const f of messagerie.fils) state.conversationIds[f.agence_id] = f.conversation_id;

  if (!messagerie.actif && messagerie.fils.length) {
    await ouvrirFil(messagerie.fils[0].conversation_id, { silencieux: true });
  }
}

async function chargerMessagesDuFil(conversationId) {
  if (!conversationId) return;
  const { data, error } = await db
    .from('messages_readable')
    .select('id, sender_id, filtered_content, has_contact_leak_attempt, attachment_url, is_read, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Relais] Messages indisponibles :', error.message);
    return;
  }

  messagerie.messages[conversationId] = (data || []).map((m) => ({
    id: m.id,
    deMoi: m.sender_id === state.profile.id,
    date: new Date(m.created_at),
    texte: m.filtered_content,
    violation: m.has_contact_leak_attempt,
    piece: m.attachment_url || null,
    lu: m.is_read,
    etat: 'envoye'          // 'enCours' | 'envoye' | 'echec'
  }));
}

/* =============================================================================
   OUVRIR UNE CONVERSATION
   ============================================================================= */

async function ouvrirFil(conversationId, options = {}) {
  if (!conversationId) return;

  // Ce qu'on avait commencé à écrire ne doit pas se perdre en changeant de fil.
  const champ = document.getElementById('chat-input-field');
  if (messagerie.actif && champ) messagerie.brouillons[messagerie.actif] = champ.value;

  messagerie.actif = conversationId;
  messagerie.aLaFin = true;

  const fil = filActif();
  if (fil) state.selectedAgencyId = fil.agence_id;

  await chargerMessagesDuFil(conversationId);
  rejoindreCanal(conversationId);

  if (champ) {
    champ.value = messagerie.brouillons[conversationId] || '';
    ajusterHauteurSaisie();
  }

  renderListeFils();
  renderFil();
  if (typeof renderOrdersStrip === 'function') renderOrdersStrip();
  if (typeof renderFinanceView === 'function') renderFinanceView();

  // Sur téléphone, ouvrir une conversation fait glisser vers le fil — mais
  // seulement si l'utilisateur l'a demandé. Au chargement, on présélectionne la
  // conversation la plus récente pour que l'ordinateur ait quelque chose à
  // afficher ; sur téléphone, cela projetait dans un fil sans être passé par la
  // liste, et le bouton retour était le seul moyen de la voir. Toute messagerie
  // ouvre sur la liste.
  if (!options.silencieux) {
    document.querySelector('.chat-workspace-layout')?.classList.add('voir-fil');
    champ?.focus({ preventScroll: true });
  }

  await marquerLu(conversationId);
}

/**
 * Marquer lu passe par une fonction en base : le navigateur n'a pas le droit
 * d'écrire dans `messages`, et c'est ce qui rend le bouclier réel. La fonction
 * ne touche que les messages REÇUS — on ne peut pas marquer lu ce qu'on a
 * soi-même envoyé, ni toucher la conversation d'autrui.
 */
async function marquerLu(conversationId) {
  const fil = messagerie.fils.find((f) => f.conversation_id === conversationId);
  if (!fil || !fil.non_lus) return;

  const { error } = await db.rpc('marquer_conversation_lue', { p_conversation: conversationId });
  if (error) { console.error('[Relais] Marquage impossible :', error.message); return; }

  fil.non_lus = 0;
  renderListeFils();
  majBadgeOnglet();
}

function majBadgeOnglet() {
  const badge = document.getElementById('chat-badge-count');
  if (!badge) return;
  const total = messagerie.fils.reduce((s, f) => s + (f.non_lus || 0), 0);
  badge.textContent = total;
  badge.hidden = total === 0;
  badge.classList.toggle('alert', total > 0);
}

/* =============================================================================
   TEMPS RÉEL — PRÉSENCE ET FRAPPE
   ============================================================================= */

/**
 * Un canal par conversation, privé : la règle posée sur realtime.messages
 * n'autorise l'abonnement qu'aux deux participants. Sans elle, n'importe quel
 * membre connecté verrait passer la présence et la frappe de deux autres.
 *
 * Ce canal ne transporte JAMAIS de contenu de message. Il ne dit que « quelque
 * chose a bougé » ; le navigateur relit ensuite par le chemin normal, celui que
 * les règles de lecture surveillent.
 */
function rejoindreCanal(conversationId) {
  if (messagerie.canal) { db.removeChannel(messagerie.canal); messagerie.canal = null; }
  messagerie.enLigne = false;
  messagerie.vuA = null;
  messagerie.ecritDepuis = 0;

  const canal = db.channel(`conversation:${conversationId}`, {
    config: { presence: { key: state.profile.id }, private: true }
  });

  const relever = () => {
    const etats = canal.presenceState();
    const autres = Object.keys(etats).filter((k) => k !== state.profile.id);
    messagerie.enLigne = autres.length > 0;
    renderPresence();
  };

  canal
    .on('presence', { event: 'sync' },  relever)
    .on('presence', { event: 'join' },  relever)
    .on('presence', { event: 'leave' }, relever)
    .on('broadcast', { event: 'frappe' }, ({ payload }) => {
      if (payload?.de === state.profile.id) return;
      messagerie.ecritDepuis = Date.now();
      renderFrappe();
      // L'indicateur s'éteint tout seul : sans cela, une personne qui ferme
      // son onglet en plein message le laisserait allumé indéfiniment.
      clearTimeout(messagerie.minuterieFrappe);
      messagerie.minuterieFrappe = setTimeout(() => {
        messagerie.ecritDepuis = 0;
        renderFrappe();
      }, 4000);
    })
    .subscribe(async (etat) => {
      if (etat !== 'SUBSCRIBED') return;
      await canal.track({ a: new Date().toISOString() });
    });

  messagerie.canal = canal;
}

/**
 * On prévient qu'on écrit, au plus une fois toutes les deux secondes. Envoyer
 * un signal à chaque touche saturerait le canal pour une information qui ne
 * change pas.
 */
let derniereAnnonce = 0;
function signalerFrappe() {
  const maintenant = Date.now();
  if (!messagerie.canal || maintenant - derniereAnnonce < 2000) return;
  derniereAnnonce = maintenant;
  messagerie.canal.send({
    type: 'broadcast', event: 'frappe', payload: { de: state.profile.id }
  });
}

/* =============================================================================
   ENVOI
   ============================================================================= */

/**
 * Le message s'affiche AVANT d'être parti. C'est ce qui fait la différence
 * entre une messagerie et un formulaire : on voit ce qu'on vient d'écrire, avec
 * une horloge, et le ✓ arrive quand le serveur a confirmé.
 *
 * Le texte affiché est ensuite remplacé par celui que la base a réellement
 * enregistré — le filtre a pu masquer un numéro, et il faut que l'expéditeur
 * voie ce que l'autre verra, pas ce qu'il croyait envoyer.
 */
async function envoyerMessage(pieceJointe = null) {
  const champ = document.getElementById('chat-input-field');
  const texte = (champ?.value || '').trim();
  if (!texte && !pieceJointe) return;

  const conversationId = messagerie.actif;
  if (!conversationId) {
    alert("Ouvrez d'abord une conversation depuis l'annuaire.");
    return;
  }

  const provisoire = {
    id: 'provisoire-' + Date.now(),
    deMoi: true,
    date: new Date(),
    texte,
    violation: false,
    piece: pieceJointe,
    lu: false,
    etat: 'enCours'
  };
  (messagerie.messages[conversationId] ||= []).push(provisoire);

  if (champ) { champ.value = ''; ajusterHauteurSaisie(); }
  delete messagerie.brouillons[conversationId];
  messagerie.aLaFin = true;
  renderFil();

  // Avertissement immédiat, avant même l'aller-retour réseau
  const apercu = inspectAndSanitizeMessage(texte);
  if (apercu.isBlocked) montrerAlerteFiltre();

  const { error } = await db.functions.invoke('envoyer-message', {
    body: {
      conversation_id: conversationId,
      content: texte,
      piece_jointe: pieceJointe || undefined
    }
  });

  if (error) {
    provisoire.etat = 'echec';
    provisoire.motif = await messageDErreurServeur(error);
    console.error('[Relais] Envoi refusé :', error);
    renderFil();
    return;
  }

  await chargerMessagesDuFil(conversationId);
  await chargerFils();
  renderFil();
  renderListeFils();
}

function montrerAlerteFiltre() {
  const toast = document.getElementById('filter-alert-toast');
  if (!toast) return;
  toast.style.display = 'block';
  clearTimeout(toast._minuterie);
  toast._minuterie = setTimeout(() => { toast.style.display = 'none'; }, 6000);
}

/* =============================================================================
   RENDU — LA LISTE DES CONVERSATIONS
   ============================================================================= */

function renderListeFils() {
  const liste = document.getElementById('conversations-list-container');
  if (!liste) return;

  const compteur = document.getElementById('active-chats-count');
  if (compteur) {
    const n = messagerie.fils.length;
    compteur.textContent = n === 0 ? 'Aucune' : `${n} ${n > 1 ? 'conversations' : 'conversation'}`;
  }
  majBadgeOnglet();

  if (!messagerie.fils.length) {
    const estAgence = state.currentRole === 'agency';
    liste.innerHTML = `
      <div class="fil-vide">
        <div class="fil-vide-icone" aria-hidden="true">💬</div>
        <strong>${estAgence ? 'Aucune demande pour l\'instant' : 'Aucune conversation'}</strong>
        <p>${estAgence
          ? 'Les e-commerçants qui vous contactent apparaîtront ici. Votre agence entre dans l\'annuaire une fois certifiée.'
          : 'Ouvrez l\'annuaire et contactez une agence certifiée pour démarrer.'}</p>
      </div>`;
    return;
  }

  liste.innerHTML = messagerie.fils.map((f) => {
    const actif = f.conversation_id === messagerie.actif;
    const apercu = f.derniere_piece && !f.dernier_message
      ? '📷 Photo'
      : (f.dernier_message || 'Conversation ouverte, aucun message');
    const prefixe = f.dernier_auteur === 'moi' && f.dernier_message ? 'Vous : ' : '';

    return `
      <button type="button" class="conv-item ${actif ? 'active' : ''} ${f.non_lus ? 'non-lu' : ''}"
              data-fil="${echapperHtml(f.conversation_id)}">
        <span class="conv-avatar" style="background:${couleurDe(f.interlocuteur)}">
          ${echapperHtml(initiales(f.interlocuteur))}
        </span>
        <span class="conv-info">
          <span class="conv-name-row">
            <span class="conv-name">${echapperHtml(f.interlocuteur || 'Sans nom')}</span>
            <span class="conv-time">${echapperHtml(heureCourte(f.dernier_le))}</span>
          </span>
          <span class="conv-bas">
            <span class="conv-last-msg">${echapperHtml(prefixe + apercu)}</span>
            ${f.non_lus ? `<span class="conv-pastille">${f.non_lus > 99 ? '99+' : f.non_lus}</span>` : ''}
          </span>
        </span>
      </button>`;
  }).join('');

  liste.querySelectorAll('[data-fil]').forEach((b) =>
    b.addEventListener('click', () => ouvrirFil(b.dataset.fil)));
}

/* =============================================================================
   RENDU — L'EN-TÊTE ET LES SIGNES DE VIE
   ============================================================================= */

function renderPresence() {
  const cible = document.getElementById('chat-partner-etat');
  if (!cible) return;

  if (messagerie.ecritDepuis) {
    cible.className = 'partner-etat ecrit';
    cible.innerHTML = '<span class="point"></span>en train d\'écrire…';
    return;
  }
  if (messagerie.enLigne) {
    cible.className = 'partner-etat en-ligne';
    cible.innerHTML = '<span class="point"></span>en ligne';
    return;
  }
  cible.className = 'partner-etat';
  cible.innerHTML = messagerie.vuA
    ? `<span class="point"></span>vu ${echapperHtml(depuisQuand(messagerie.vuA))}`
    : '';
}

function renderFrappe() {
  renderPresence();
  const flux = document.getElementById('messages-stream');
  const existant = document.getElementById('indicateur-frappe');

  if (!messagerie.ecritDepuis) { existant?.remove(); return; }
  if (existant || !flux) return;

  const bulle = document.createElement('div');
  bulle.id = 'indicateur-frappe';
  bulle.className = 'indicateur-frappe';
  bulle.innerHTML = '<i></i><i></i><i></i>';
  flux.appendChild(bulle);
  if (messagerie.aLaFin) flux.scrollTop = flux.scrollHeight;
}

/* =============================================================================
   RENDU — LE FIL
   ============================================================================= */

/** ⏳ en cours · ✓ envoyé · ✓✓ lu · ⚠ échec */
function accuse(m) {
  if (!m.deMoi) return '';
  if (m.etat === 'enCours') return '<span class="accuse en-cours" title="Envoi en cours">🕘</span>';
  if (m.etat === 'echec')   return '<span class="accuse echec" title="Non envoyé">⚠</span>';
  return m.lu
    ? '<span class="accuse lu" title="Lu">✓✓</span>'
    : '<span class="accuse" title="Envoyé">✓</span>';
}

function renderFil() {
  const flux = document.getElementById('messages-stream');
  const fil = filActif();

  const nom     = document.getElementById('chat-partner-name');
  const avatar  = document.getElementById('chat-partner-flag');
  const actions = document.querySelectorAll('.chat-actions-group .btn');

  if (!fil) {
    const estAgence = state.currentRole === 'agency';
    if (nom) nom.textContent = 'Aucune conversation';
    if (avatar) { avatar.textContent = '💬'; avatar.style.background = ''; }
    document.querySelectorAll('.verified-badge-sm').forEach((b) => { b.hidden = true; });
    actions.forEach((b) => { b.disabled = true; });
    renderPresence();

    if (flux) {
      flux.innerHTML = `
        <div class="fil-vide grand">
          <div class="fil-vide-icone" aria-hidden="true">${estAgence ? '📥' : '🔎'}</div>
          <strong>${estAgence ? 'Personne ne vous a encore écrit' : 'Choisissez une agence'}</strong>
          <p>${estAgence
            ? 'Dès qu\'un e-commerçant ouvrira une conversation, elle apparaîtra à gauche.'
            : 'Rendez-vous dans l\'annuaire et cliquez sur « Discuter &amp; Commander ».'}</p>
        </div>`;
    }
    return;
  }

  document.querySelectorAll('.verified-badge-sm').forEach((b) => { b.hidden = false; });
  actions.forEach((b) => { b.disabled = false; });
  if (nom) nom.textContent = fil.interlocuteur || 'Sans nom';
  if (avatar) {
    avatar.textContent = initiales(fil.interlocuteur);
    avatar.style.background = couleurDe(fil.interlocuteur);
    avatar.style.color = '#fff';
  }
  renderPresence();

  if (!flux) return;

  // Le fil mêle deux natures : les messages, filtrés, et les bons de commande,
  // qui ne passent pas par le filtre puisqu'ils voyagent par la table `orders`.
  // C'est ce qui permet au téléphone du client d'arriver intact chez l'agence
  // sans jamais transiter par la messagerie.
  const elements = [
    ...(messagerie.messages[messagerie.actif] || []).map((m) => ({ type: 'message', date: m.date, d: m })),
    ...(state.orders || [])
      .filter((o) => o.conversationId === messagerie.actif)
      .map((o) => ({ type: 'commande', date: o.createdAt, d: o }))
  ].sort((a, b) => a.date - b.date);

  if (!elements.length) {
    flux.innerHTML = `
      <div class="fil-vide grand">
        <div class="fil-vide-icone" aria-hidden="true">👋</div>
        <strong>Dites bonjour à ${echapperHtml(fil.interlocuteur || 'votre interlocuteur')}</strong>
        <p>Présentez votre activité et le volume que vous expédiez : c'est ce
           qui permet à une agence de vous répondre utilement.</p>
      </div>`;
    return;
  }

  flux.innerHTML = elements.map((el, i) => {
    const separateur = separateurDeJour(el.date, elements[i - 1]?.date);
    if (el.type === 'commande') return separateur + carteCommande(el.d);

    const m = el.d;
    const precedent = elements[i - 1];
    const suivant   = elements[i + 1];
    // Deux messages d'affilée du même auteur se collent ; un changement
    // d'auteur ouvre un vrai blanc. C'est ce qui distingue un fil lisible
    // d'une colonne de blocs identiques.
    const debut = !!separateur || !precedent || precedent.type !== 'message'
                  || precedent.d.deMoi !== m.deMoi;
    const fin   = !suivant || suivant.type !== 'message'
                  || suivant.d.deMoi !== m.deMoi
                  || !!separateurDeJour(suivant.date, el.date);

    const piece = m.piece
      ? `<span class="piece-jointe" data-piece="${echapperHtml(m.piece)}">
           <span class="piece-attente">Chargement…</span>
         </span>`
      : '';

    return separateur + `
      <div class="message-bubble-wrap ${m.deMoi ? 'sent' : 'received'}${debut ? ' debut-groupe' : ''}${fin ? ' fin-groupe' : ''}${m.etat === 'echec' ? ' echoue' : ''}">
        <div class="bubble ${m.violation ? 'violation' : ''}${m.piece ? ' avec-piece' : ''}">
          ${piece}${m.texte ? echapperHtml(m.texte) : ''}
        </div>
        <span class="msg-pied">
          <span class="msg-time">${echapperHtml(heureDuMessage(m.date))}</span>${accuse(m)}
        </span>
        ${m.etat === 'echec'
          ? `<button type="button" class="msg-reessayer" data-reessayer="${echapperHtml(m.id)}">
               Non envoyé — ${echapperHtml(m.motif || 'réessayer')}
             </button>`
          : ''}
      </div>`;
  }).join('');

  if (messagerie.aLaFin) flux.scrollTop = flux.scrollHeight;
  renderFrappe();
  revelerPiecesJointes(flux);
  majBoutonDescendre();
  // Le bandeau peut avoir ete dessine avant que les commandes ne soient
  // chargees : il affichait alors « 0 » sous un fil qui en contenait.
  if (typeof renderOrdersStrip === 'function') renderOrdersStrip();

  flux.querySelectorAll('[data-reessayer]').forEach((b) =>
    b.addEventListener('click', () => reessayer(b.dataset.reessayer)));
}

/** Un message refusé se renvoie sans avoir à le retaper. */
async function reessayer(id) {
  const liste = messagerie.messages[messagerie.actif] || [];
  const m = liste.find((x) => x.id === id);
  if (!m) return;
  const champ = document.getElementById('chat-input-field');
  if (champ) { champ.value = m.texte; ajusterHauteurSaisie(); }
  liste.splice(liste.indexOf(m), 1);
  renderFil();
  await envoyerMessage(m.piece);
}

/* =============================================================================
   DESCENDRE AU DERNIER MESSAGE
   ============================================================================= */

function majBoutonDescendre() {
  const flux = document.getElementById('messages-stream');
  const bouton = document.getElementById('btn-descendre');
  if (!flux || !bouton) return;
  const restant = flux.scrollHeight - flux.scrollTop - flux.clientHeight;
  bouton.hidden = restant < 120;
}

function surveillerDefilement() {
  const flux = document.getElementById('messages-stream');
  if (!flux) return;
  flux.addEventListener('scroll', () => {
    const restant = flux.scrollHeight - flux.scrollTop - flux.clientHeight;
    // Remonter dans l'historique ne doit pas être annulé par l'arrivée d'un
    // message : on ne recolle en bas que si l'on y était déjà.
    messagerie.aLaFin = restant < 120;
    majBoutonDescendre();
  }, { passive: true });

  document.getElementById('btn-descendre')?.addEventListener('click', () => {
    messagerie.aLaFin = true;
    flux.scrollTop = flux.scrollHeight;
    majBoutonDescendre();
  });
}

/* =============================================================================
   RECHERCHE DANS LA LISTE
   ============================================================================= */

function filtrerListe(terme) {
  const t = (terme || '').trim().toLowerCase();
  document.querySelectorAll('#conversations-list-container .conv-item').forEach((el) => {
    const nom = el.querySelector('.conv-name')?.textContent.toLowerCase() || '';
    const dernier = el.querySelector('.conv-last-msg')?.textContent.toLowerCase() || '';
    el.hidden = t.length > 0 && !nom.includes(t) && !dernier.includes(t);
  });
}

/* =============================================================================
   PIÈCES JOINTES
   ============================================================================= */

/**
 * Le dépôt des pièces jointes est privé : aucune adresse permanente n'existe.
 * On demande un lien signé, valable dix minutes, uniquement pour les fichiers
 * réellement affichés. Un participant qui n'appartient pas à la conversation
 * n'obtient rien — la règle vit dans le dépôt, pas ici.
 */
async function revelerPiecesJointes(conteneur) {
  const vignettes = [...conteneur.querySelectorAll('.piece-jointe[data-piece]')];
  if (!vignettes.length) return;

  const chemins = [...new Set(vignettes.map((v) => v.dataset.piece))];
  const { data, error } = await db.storage.from('pieces-chat').createSignedUrls(chemins, 600);

  if (error) {
    console.error('[Relais] Pièces jointes indisponibles :', error.message);
    vignettes.forEach((v) => { v.innerHTML = '<span class="piece-attente">Pièce jointe indisponible.</span>'; });
    return;
  }

  const liens = {};
  (data || []).forEach((d) => { if (d.signedUrl) liens[d.path] = d.signedUrl; });

  vignettes.forEach((v) => {
    const url = liens[v.dataset.piece];
    if (!url) { v.innerHTML = '<span class="piece-attente">Pièce jointe indisponible.</span>'; return; }
    const estPdf = /\.pdf$/i.test(v.dataset.piece);
    v.innerHTML = estPdf
      ? `<a class="piece-document" href="${echapperHtml(url)}" target="_blank" rel="noopener">📄 Ouvrir le document</a>`
      : `<a href="${echapperHtml(url)}" target="_blank" rel="noopener">
           <img src="${echapperHtml(url)}" alt="Pièce jointe" loading="lazy">
         </a>`;
  });
}

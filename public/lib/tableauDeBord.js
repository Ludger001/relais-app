/**
 * =============================================================================
 * RELAIS — LES TROIS TABLEAUX DE BORD
 * =============================================================================
 *
 * Un tableau de bord ne sert pas à exposer toutes les données disponibles : il
 * répond à la question que son lecteur se pose en ouvrant l'application.
 *
 *   le marchand : « où sont mes colis, et combien me doit-on ? »
 *   l'agence    : « que dois-je livrer aujourd'hui, et combien dois-je rendre ? »
 *   l'administrateur : « comment va la plateforme ? »
 *
 * D'où trois mises en page distinctes, dans le même ordre de lecture : ce qui
 * demande une action, puis l'argent, puis l'activité, puis le contexte.
 */

const FCFA = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} FCFA`;
const NOMBRE = (n) => (Number(n) || 0).toLocaleString('fr-FR');

function saluer() {
  const h = new Date().getHours();
  if (h < 5)  return 'Bonne nuit';
  if (h < 18) return 'Bonjour';
  return 'Bonsoir';
}

function dateDuJour() {
  return new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
}

/**
 * Une alerte n'apparaît que s'il y a réellement quelque chose à faire.
 * Un tableau de bord qui affiche « 0 problème » en rouge crie pour rien.
 */
function alerte(nombre, ton, titre, detail, onglet) {
  if (!nombre) return '';
  return `
    <button type="button" class="tb-alerte tb-alerte-${ton}" data-va-vers="${onglet}">
      <span class="tb-alerte-nombre">${NOMBRE(nombre)}</span>
      <span class="tb-alerte-texte">
        <strong>${titre}</strong>
        <span>${detail}</span>
      </span>
      <span class="tb-alerte-fleche" aria-hidden="true">→</span>
    </button>`;
}

/** « 1 agence » ou « 3 agences » — jamais « 1 agence(s) ». */
function pluriel(n, singulier, plurielMot) {
  const nb = Number(n) || 0;
  return `${NOMBRE(nb)} ${nb > 1 ? (plurielMot || singulier + 's') : singulier}`;
}

function mini(valeur, label) {
  return `<div class="tb-mini">
            <span class="tb-mini-valeur">${valeur}</span>
            <span class="tb-mini-label">${label}</span>
          </div>`;
}

function ligne(cle, valeur, sourdine = false) {
  return `<div class="tb-ligne">
            <dt>${cle}</dt>
            <dd class="${sourdine ? 'sourdine' : ''}">${valeur}</dd>
          </div>`;
}

/**
 * Le parcours des colis en une barre proportionnelle : on voit d'un coup où
 * ils s'accumulent, ce qu'une rangée de tuiles ne montre pas.
 */
function fluxColis(etapes) {
  const total = etapes.reduce((s, e) => s + e.nombre, 0);

  const barre = total === 0
    ? '<span style="width:100%; background: var(--bg-card-hover)"></span>'
    : etapes
        .filter(e => e.nombre > 0)
        .map(e => `<span class="seg-${e.cle}" style="width:${(e.nombre / total) * 100}%"></span>`)
        .join('');

  return `
    <div class="tb-flux">
      <div class="tb-flux-barre" role="img" aria-label="Répartition des colis par étape">${barre}</div>
      <div class="tb-flux-legende">
        ${etapes.map(e => `
          <div class="tb-flux-item">
            <span class="nb"><span class="pastille" style="background:${e.couleur}"></span>${NOMBRE(e.nombre)}</span>
            <span class="lb">${e.label}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

const COULEURS = {
  attente: 'var(--warning)',
  route:   'var(--secondary)',
  livre:   'var(--primary)',
  echec:   'var(--danger)'
};

/**
 * Le journal de sécurité affichait la règle technique qui avait déclenché la
 * détection — « appelle[\s\-_]*moi ». Illisible, et sans intérêt pour la
 * personne qui doit décider quoi faire du membre concerné.
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

/* =============================================================================
   MARCHAND
   ============================================================================= */

function vueMarchand(c, profil) {
  const enCours = (c.colis_en_attente || 0) + (c.colis_en_route || 0);
  const reussite = (c.livres_7j + c.echecs_7j) > 0
    ? Math.round((c.livres_7j / (c.livres_7j + c.echecs_7j)) * 100)
    : null;

  const attention =
    alerte(c.reversements_a_confirmer, 'urgente',
      c.reversements_a_confirmer > 1 ? 'Reversements à confirmer' : 'Reversement à confirmer',
      "Une agence déclare vous avoir viré des fonds. Vérifiez votre compte, puis confirmez.",
      'finance') +
    alerte(c.echecs_7j, 'attente',
      c.echecs_7j > 1 ? 'Livraisons en échec cette semaine' : 'Livraison en échec cette semaine',
      'Client injoignable ou refus. Le colis attend vos instructions.',
      'chat') +
    alerte(c.colis_en_attente, 'info',
      'Colis en attente de ramassage',
      "L'agence ne les a pas encore pris en charge.",
      'chat');

  return `
    <div class="tb-entete">
      <div>
        <h2 class="tb-salutation">${saluer()}${profil.full_name ? ', ' + profil.full_name.split(' ')[0] : ''}</h2>
        <p class="tb-sous-titre">${profil.merchant?.store_name || 'Votre boutique'} · ${pluriel(c.agences_actives, 'agence partenaire', 'agences partenaires')}</p>
      </div>
      <span class="tb-horodatage">${dateDuJour()}</span>
    </div>

    ${attention ? `<div class="tb-attention">${attention}</div>` : ''}

    <div class="tb-grille">
      <div class="tb-colonne">

        <section class="tb-bloc tb-vedette">
          <h3 class="tb-bloc-titre">Ce que les agences vous doivent</h3>
          <p class="tb-vedette-valeur ${c.cash_a_recevoir > 0 ? 'attente' : ''}">${FCFA(c.cash_a_recevoir)}</p>
          <p class="tb-vedette-legende">
            ${c.cash_a_recevoir > 0
              ? "Cash encaissé chez vos clients, frais de livraison déduits, pas encore reversé."
              : "Tout le cash encaissé vous a été reversé. Rien en attente."}
          </p>
          <div class="tb-vedette-pied">
            ${mini(FCFA(c.cash_en_reglement), 'En cours de règlement')}
            ${mini(FCFA(c.recu_30j), 'Reçu sur 30 jours')}
            ${mini(NOMBRE(c.total_commandes), 'Commandes au total')}
          </div>
        </section>

        <section class="tb-bloc">
          <h3 class="tb-bloc-titre">Où en sont vos colis</h3>
          ${enCours + c.livres_7j + c.echecs_7j === 0
            ? `<div class="tb-vide">
                 <strong>Aucun colis en circulation.</strong>
                 Passez votre première commande depuis une conversation avec une agence.
               </div>`
            : fluxColis([
                { cle: 'attente', nombre: c.colis_en_attente || 0, label: 'À ramasser',   couleur: COULEURS.attente },
                { cle: 'route',   nombre: c.colis_en_route || 0,   label: 'En livraison', couleur: COULEURS.route },
                { cle: 'livre',   nombre: c.livres_7j || 0,        label: 'Livrés (7 j)', couleur: COULEURS.livre },
                { cle: 'echec',   nombre: c.echecs_7j || 0,        label: 'Échecs (7 j)', couleur: COULEURS.echec }
              ])}
        </section>

      </div>

      <div class="tb-colonne">

        <section class="tb-bloc">
          <h3 class="tb-bloc-titre">30 derniers jours</h3>
          <dl class="tb-lignes">
            ${ligne('Encaissé chez vos clients', FCFA(c.volume_30j))}
            ${ligne('Frais de livraison payés', FCFA(c.frais_30j))}
            ${ligne('Net qui vous revient', FCFA((c.volume_30j || 0) - (c.frais_30j || 0)))}
            ${reussite !== null ? ligne('Taux de livraison réussie', reussite + ' %') : ''}
          </dl>
        </section>

        <section class="tb-bloc">
          <h3 class="tb-bloc-titre">Agir</h3>
          <div class="tb-actions">
            <button type="button" class="btn btn-primary" data-va-vers="directory">Trouver une agence</button>
            <button type="button" class="btn btn-outline-sm" data-va-vers="chat">Mes conversations</button>
          </div>
        </section>

      </div>
    </div>`;
}

/* =============================================================================
   AGENCE
   ============================================================================= */

function vueAgence(c, profil) {
  const certifiee = profil.agency?.status === 'verified';
  const note = Number(profil.agency?.rating_avg || 0);
  const nbAvis = profil.agency?.rating_count || 0;

  const reussite = (c.livraisons_30j + c.echecs_30j) > 0
    ? Math.round((c.livraisons_30j / (c.livraisons_30j + c.echecs_30j)) * 100)
    : null;

  const bandeau = certifiee
    ? `<div class="tb-certification ok">
         <span class="icone">✓</span>
         <div>
           <strong>Agence certifiée Relais</strong>
           <span>Vous apparaissez dans l'annuaire des e-commerçants des 5 pays.</span>
         </div>
       </div>`
    : `<div class="tb-certification attente">
         <span class="icone">⏳</span>
         <div>
           <strong>Dossier en attente de vérification</strong>
           <span>Vous n'apparaissez pas encore dans l'annuaire. Déposez vos pièces depuis « Mon Agence ».</span>
         </div>
       </div>`;

  const attention =
    alerte(c.reversements_a_declarer, 'urgente',
      c.reversements_a_declarer > 1 ? 'Reversements à déclarer' : 'Reversement à déclarer',
      "Les comptes sont arrêtés. Effectuez le virement, puis déclarez-le avec son justificatif.",
      'finance') +
    alerte(c.a_ramasser, 'attente',
      'Colis à ramasser',
      'Des marchands attendent que vous preniez leurs colis en charge.',
      'chat') +
    alerte(c.nouvelles_demandes, 'info',
      c.nouvelles_demandes > 1 ? 'Nouveaux marchands vous ont contacté' : 'Nouveau marchand vous a contacté',
      "Une conversation est ouverte, sans commande pour l'instant.",
      'chat');

  return `
    <div class="tb-entete">
      <div>
        <h2 class="tb-salutation">${saluer()}${profil.full_name ? ', ' + profil.full_name.split(' ')[0] : ''}</h2>
        <p class="tb-sous-titre">${profil.agency?.company_name || 'Votre agence'} · ${profil.agency?.primary_city || ''} · ${pluriel(c.marchands_actifs, 'marchand')}</p>
      </div>
      <span class="tb-horodatage">${dateDuJour()}</span>
    </div>

    ${bandeau}
    ${attention ? `<div class="tb-attention">${attention}</div>` : ''}

    <div class="tb-grille">
      <div class="tb-colonne">

        <section class="tb-bloc tb-vedette">
          <h3 class="tb-bloc-titre">Cash que vous devez reverser</h3>
          <p class="tb-vedette-valeur ${c.cash_a_reverser > 0 ? 'attente' : ''}">${FCFA(c.cash_a_reverser)}</p>
          <p class="tb-vedette-legende">
            ${c.cash_a_reverser > 0
              ? "Cet argent appartient à vos marchands. Il est encaissé, livré, et pas encore reversé."
              : "Vous êtes à jour : rien à reverser."}
          </p>
          <div class="tb-vedette-pied">
            ${mini(FCFA(c.cash_encaisse_jour), "Encaissé aujourd'hui")}
            ${mini(FCFA(c.mes_frais_30j), 'Vos frais sur 30 jours')}
            ${mini(NOMBRE(c.livraisons_30j), 'Livraisons sur 30 jours')}
          </div>
        </section>

        <section class="tb-bloc">
          <h3 class="tb-bloc-titre">Votre tournée du jour</h3>
          ${(c.a_ramasser + c.en_tournee + c.livres_aujourdhui + c.echecs_aujourdhui) === 0
            ? `<div class="tb-vide">
                 <strong>Rien à livrer aujourd'hui.</strong>
                 Les commandes de vos marchands apparaîtront ici.
               </div>`
            : fluxColis([
                { cle: 'attente', nombre: c.a_ramasser || 0,        label: 'À ramasser',   couleur: COULEURS.attente },
                { cle: 'route',   nombre: c.en_tournee || 0,        label: 'En tournée',   couleur: COULEURS.route },
                { cle: 'livre',   nombre: c.livres_aujourdhui || 0, label: 'Livrés',       couleur: COULEURS.livre },
                { cle: 'echec',   nombre: c.echecs_aujourdhui || 0, label: 'Échecs',       couleur: COULEURS.echec }
              ])}
        </section>

      </div>

      <div class="tb-colonne">

        <section class="tb-bloc">
          <h3 class="tb-bloc-titre">Votre réputation</h3>
          <dl class="tb-lignes">
            ${ligne('Note moyenne', nbAvis > 0 ? `${note.toFixed(1)} / 5` : 'Pas encore notée', nbAvis === 0)}
            ${ligne('Avis reçus', NOMBRE(nbAvis), nbAvis === 0)}
            ${reussite !== null ? ligne('Livraisons réussies', reussite + ' %') : ''}
            ${ligne('Flotte déclarée', pluriel(profil.agency?.fleet_size, 'livreur'))}
          </dl>
        </section>

        <section class="tb-bloc">
          <h3 class="tb-bloc-titre">Agir</h3>
          <div class="tb-actions">
            <button type="button" class="btn btn-primary" data-va-vers="chat">Mes livraisons</button>
            <button type="button" class="btn btn-outline-sm" data-va-vers="finance">Point financier</button>
          </div>
        </section>

      </div>
    </div>`;
}

/* =============================================================================
   ADMINISTRATEUR
   ============================================================================= */

function vueAdmin(c, profil, journal) {
  const attention =
    alerte(c.agences_en_attente, 'urgente',
      c.agences_en_attente > 1 ? 'Agences en attente de certification' : 'Agence en attente de certification',
      "Elle n'apparaît pas dans l'annuaire tant que vous n'avez pas examiné ses pièces.",
      'admin') +
    alerte(c.litiges, 'urgente',
      c.litiges > 1 ? 'Reversements contestés' : 'Reversement contesté',
      'Un marchand et une agence ne sont pas d\'accord sur des fonds.',
      'finance') +
    alerte(c.membres_recidivistes, 'attente',
      c.membres_recidivistes > 1 ? 'Membres insistent pour contourner' : 'Membre insiste pour contourner',
      'Au moins trois tentatives de partage de coordonnées ce mois-ci.',
      'admin');

  const derniers = (journal || []).slice(0, 5);

  return `
    <div class="tb-entete">
      <div>
        <h2 class="tb-salutation">${saluer()}${profil.full_name ? ', ' + profil.full_name.split(' ')[0].replace(/[—-]/, '') : ''}</h2>
        <p class="tb-sous-titre">État de la plateforme Relais</p>
      </div>
      <span class="tb-horodatage">${dateDuJour()}</span>
    </div>

    ${attention
      ? `<div class="tb-attention">${attention}</div>`
      : `<div class="tb-certification ok">
           <span class="icone">✓</span>
           <div>
             <strong>Rien ne demande votre intervention</strong>
             <span>Aucun dossier en attente, aucun litige, aucun membre insistant.</span>
           </div>
         </div>`}

    <div class="tb-grille">
      <div class="tb-colonne">

        <section class="tb-bloc tb-vedette">
          <h3 class="tb-bloc-titre">Volume traité sur 30 jours</h3>
          <p class="tb-vedette-valeur ${c.volume_30j > 0 ? 'positif' : ''}">${FCFA(c.volume_30j)}</p>
          <p class="tb-vedette-legende">
            Cash encaissé chez les clients finaux par l'ensemble des agences certifiées.
            C'est le volume que Relais sécurise, pas son revenu.
          </p>
          <div class="tb-vedette-pied">
            ${mini(FCFA(c.revenu_mensuel), 'Revenu mensuel récurrent')}
            ${mini(NOMBRE(c.abonnements_actifs), 'Abonnements actifs')}
            ${mini(FCFA(c.cash_en_circulation), 'Cash non encore reversé')}
          </div>
        </section>

        <section class="tb-bloc">
          <h3 class="tb-bloc-titre">Le bouclier anti-contournement</h3>
          <dl class="tb-lignes">
            ${ligne('Tentatives interceptées cette semaine', NOMBRE(c.tentatives_7j))}
            ${ligne('Depuis le lancement', NOMBRE(c.tentatives_total), true)}
            ${ligne('Membres insistants ce mois-ci', NOMBRE(c.membres_recidivistes))}
          </dl>

          ${derniers.length === 0
            ? `<div class="tb-vide"><strong>Aucune tentative enregistrée.</strong>Les échanges restent dans le cadre.</div>`
            : `<div class="tb-journal" style="margin-top:1rem;">
                 ${derniers.map(v => `
                   <div class="tb-journal-item">
                     <div class="tb-journal-tete">
                       <span class="tb-journal-qui">${v.user}</span>
                       <span class="tb-journal-quand">${v.time} · ${v.country}</span>
                     </div>
                     <div class="tb-journal-quoi">
                       ${traduireDetection(v.pattern)} — masqué et signalé
                       ${v.tentative ? `<span class="tb-journal-texte">« ${v.tentative} »</span>` : ''}
                     </div>
                   </div>`).join('')}
               </div>`}
        </section>

      </div>

      <div class="tb-colonne">

        <section class="tb-bloc">
          <h3 class="tb-bloc-titre">Les membres</h3>
          <dl class="tb-lignes">
            ${ligne('E-commerçants', NOMBRE(c.marchands))}
            ${ligne('Agences certifiées', NOMBRE(c.agences_certifiees))}
            ${ligne('Agences en attente', NOMBRE(c.agences_en_attente), c.agences_en_attente === 0)}
            ${ligne('Dossiers refusés', NOMBRE(c.agences_refusees), c.agences_refusees === 0)}
            ${ligne('Inscrits cette semaine', NOMBRE(c.inscrits_7j))}
          </dl>
        </section>

        <section class="tb-bloc">
          <h3 class="tb-bloc-titre">L'activité</h3>
          <dl class="tb-lignes">
            ${ligne('Commandes cette semaine', NOMBRE(c.commandes_7j))}
            ${ligne('Livrées cette semaine', NOMBRE(c.livrees_7j))}
            ${ligne('Depuis le lancement', NOMBRE(c.commandes_total), true)}
            ${ligne('Conversations ouvertes', NOMBRE(c.conversations))}
            ${ligne('Messages cette semaine', NOMBRE(c.messages_7j))}
          </dl>
        </section>

        <section class="tb-bloc">
          <h3 class="tb-bloc-titre">Agir</h3>
          <div class="tb-actions">
            <button type="button" class="btn btn-primary" data-va-vers="admin">Dossiers &amp; sécurité</button>
          </div>
        </section>

      </div>
    </div>`;
}

/* =============================================================================
   POINT D'ENTRÉE
   ============================================================================= */

async function chargerTableauDeBord() {
  const fonctions = {
    merchant: 'tableau_de_bord_marchand',
    agency:   'tableau_de_bord_agence',
    admin:    'tableau_de_bord_admin'
  };
  const fn = fonctions[state.currentRole];
  if (!fn) return;

  const { data, error } = await db.rpc(fn);
  if (error) {
    console.error('[Relais] Tableau de bord indisponible :', error.message);
    state.chiffres = null;
    return;
  }
  state.chiffres = data || {};
}

function renderTableauDeBord() {
  const cible = document.getElementById('view-tableau');
  if (!cible || !state.profile) return;

  if (!state.chiffres) {
    cible.innerHTML = `<div class="tb-vide">
        <strong>Vos chiffres n'ont pas pu être chargés.</strong>
        Vérifiez votre connexion, puis rechargez la page.
      </div>`;
    return;
  }

  const c = state.chiffres;
  const vues = { merchant: vueMarchand, agency: vueAgence, admin: vueAdmin };
  const vue = vues[state.currentRole];
  if (!vue) return;

  cible.innerHTML = vue(c, state.profile, state.securityLogs);

  // Chaque alerte et chaque bouton d'action mène à l'écran concerné :
  // un tableau de bord qui signale un problème doit y conduire.
  cible.querySelectorAll('[data-va-vers]').forEach(el =>
    el.addEventListener('click', () => switchTab(el.dataset.vaVers)));
}

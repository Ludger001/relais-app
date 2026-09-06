/**
 * =============================================================================
 * RELAIS — LOGIQUE D'INSCRIPTION PARTAGÉE
 * =============================================================================
 *
 * Le formulaire marchand et le formulaire agence font la même chose : créer un
 * compte, y attacher les métadonnées du métier, et laisser la base construire
 * le profil (voir le déclencheur handle_new_user dans database/02_securite.sql).
 *
 * Rien n'est inséré depuis le navigateur : juste après signUp, la session
 * n'existe pas encore quand la confirmation par e-mail est activée, et les
 * règles RLS refuseraient l'écriture. C'est la base qui s'en charge.
 */

function brancherInscription(config) {
  const form = document.getElementById(config.formId);
  const bouton = document.getElementById(config.boutonId);
  const retour = document.getElementById(config.retourId);
  if (!form || !bouton) return;

  function afficher(message, type) {
    if (!retour) {
      alert(message);
      return;
    }
    retour.hidden = false;
    retour.className = `form-feedback form-feedback-${type}`;
    retour.innerHTML = message;
    retour.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function verrouiller(actif, texte) {
    bouton.disabled = actif;
    bouton.style.opacity = actif ? '0.65' : '1';
    bouton.style.cursor = actif ? 'wait' : '';
    bouton.textContent = texte;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (retour) retour.hidden = true;

    const valeur = (id) => (document.getElementById(id)?.value || '').trim();

    const email = valeur(config.champs.email);
    const motDePasse = document.getElementById(config.champs.motDePasse).value;
    const confirmation = document.getElementById(config.champs.confirmation).value;
    const nomComplet = valeur(config.champs.nomComplet);
    const pays = valeur(config.champs.pays);

    if (motDePasse !== confirmation) {
      afficher('Les deux mots de passe ne sont pas identiques.', 'erreur');
      return;
    }
    if (motDePasse.length < 8) {
      afficher('Le mot de passe doit contenir au moins 8 caractères.', 'erreur');
      return;
    }

    verrouiller(true, 'Création de votre compte…');

    try {
      const metadonnees = Object.assign(
        { full_name: nomComplet, country: pays },
        config.construireMetadonnees()
      );

      const { data, error } = await db.auth.signUp({
        email,
        password: motDePasse,
        options: {
          data: metadonnees,
          emailRedirectTo: new URL('connexion.html', window.location.href).href
        }
      });

      if (error) {
        afficher(messageErreur(error), 'erreur');
        verrouiller(false, config.libelleBouton);
        return;
      }

      // Session immédiate : la confirmation par e-mail est désactivée
      if (data.session) {
        afficher('Compte créé. Ouverture de votre espace…', 'succes');
        window.location.href = 'app.html';
        return;
      }

      // Pas de session : il faut confirmer l'adresse e-mail
      afficher(
        `<strong>Votre compte est créé.</strong><br>
         Nous avons envoyé un lien de confirmation à <strong>${email}</strong>.
         Ouvrez-le pour activer votre accès, puis
         <a href="connexion.html">connectez-vous</a>.<br>
         <span style="opacity:.75">Pensez à vérifier vos courriers indésirables.</span>`,
        'succes'
      );
      verrouiller(false, config.libelleBouton);
      form.reset();

    } catch (err) {
      console.error('[Relais] Inscription impossible :', err);
      afficher(messageErreur(err), 'erreur');
      verrouiller(false, config.libelleBouton);
    }
  });
}

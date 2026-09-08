-- =============================================================================
-- RELAIS — PAIEMENT DES ABONNEMENTS
--
-- Applique le 2026-09-08 sur le projet Supabase "relais-hub" :
--   relais_paiement_abonnement_moneroo
--
-- Prestataire : Moneroo (orchestrateur, moneroo.io). Il se pose au-dessus des
-- passerelles locales et couvre le mobile money du Benin, du Togo, du Senegal
-- et de la Cote d'Ivoire. Le Gabon n'apparait pas dans ses methodes : c'est un
-- trou connu, l'annuaire annonce pourtant cinq pays.
--
-- LA REGLE QUI GOUVERNE TOUT CE FICHIER
-- -------------------------------------
-- Le MONTANT ne vient jamais du navigateur. Il est lu dans plans_abonnement au
-- moment de creer le paiement, puis reverifie au moment de le confirmer. Sans
-- cela, il suffirait de modifier la requete pour payer 100 FCFA un abonnement
-- a 25 000.
--
-- Et ce n'est pas cette base qui active un abonnement : c'est le webhook, apres
-- que Moneroo a confirme le paiement. Un membre qui ferme la page de paiement,
-- ou qui rejoue l'adresse de retour, n'obtient rien.
-- =============================================================================

ALTER TYPE payment_gateway ADD VALUE IF NOT EXISTS 'moneroo';


-- -----------------------------------------------------------------------------
-- 1. DEMARRER UN PAIEMENT
--
-- Le membre demande un forfait ; la base decide du prix, de la devise, et emet
-- une reference interne qui sera notre seule cle de rapprochement avec Moneroo.
-- Cette reference voyage dans le champ `metadata` de la transaction : on ne
-- depend ainsi d'aucun identifiant qu'on ne maitrise pas.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.demarrer_paiement_abonnement(p_plan_code TEXT)
RETURNS TABLE (
  reference_interne TEXT,
  montant           NUMERIC,
  devise            TEXT,
  libelle           TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_moi   UUID := public.current_profile_id();
  v_role  user_role := public.my_role();
  v_plan  plans_abonnement;
  v_ref   TEXT;
BEGIN
  IF v_moi IS NULL THEN
    RAISE EXCEPTION 'Connexion requise.';
  END IF;

  SELECT * INTO v_plan FROM plans_abonnement WHERE code = p_plan_code AND actif;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ce forfait n''existe pas ou n''est plus proposé.';
  END IF;

  -- Une agence ne souscrit pas au forfait marchand, et reciproquement.
  IF v_plan.role_cible IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'Ce forfait ne correspond pas à votre type de compte.';
  END IF;

  v_ref := 'RLS-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
           UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 10));

  INSERT INTO paiements (profile_id, plan_code, montant, devise, reference_interne, statut)
  VALUES (v_moi, v_plan.code, v_plan.prix_mensuel, v_plan.devise, v_ref, 'en_attente');

  RETURN QUERY SELECT v_ref, v_plan.prix_mensuel, v_plan.devise::TEXT, v_plan.libelle::TEXT;
END;
$$;


-- -----------------------------------------------------------------------------
-- 2. CONFIRMER UN PAIEMENT
--
-- Appelee UNIQUEMENT par la fonction serveur qui recoit le webhook, avec la cle
-- de service. Le role authenticated n'y a pas droit : sinon n'importe qui
-- activerait son propre abonnement sans payer.
--
-- Idempotente : un prestataire de paiement rejoue ses webhooks jusqu'a recevoir
-- un 200. Rappelee sur un paiement deja confirme, elle ne fait rien et le dit —
-- sans quoi un client se verrait crediter 60 ou 90 jours pour un seul paiement.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmer_paiement_abonnement(
  p_reference_interne TEXT,
  p_reference_externe TEXT,
  p_montant           NUMERIC,
  p_devise            TEXT,
  p_brut              JSONB DEFAULT NULL
)
RETURNS TABLE (resultat TEXT, detail TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_paiement paiements;
  v_plan     plans_abonnement;
  v_fin      TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_paiement FROM paiements WHERE reference_interne = p_reference_interne;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'inconnu', 'Aucun paiement ne porte cette référence.';
    RETURN;
  END IF;

  IF v_paiement.statut = 'paye' THEN
    RETURN QUERY SELECT 'deja_traite', 'Ce paiement était déjà confirmé.';
    RETURN;
  END IF;

  -- Le montant annonce doit etre celui que NOUS avons demande. Un webhook
  -- falsifie ou un paiement partiel n'active rien.
  IF p_montant IS DISTINCT FROM v_paiement.montant
     OR UPPER(p_devise) IS DISTINCT FROM UPPER(v_paiement.devise) THEN
    UPDATE paiements
       SET statut = 'echoue',
           motif_echec = format('Montant reçu %s %s, attendu %s %s',
                                p_montant, p_devise, v_paiement.montant, v_paiement.devise),
           provider_raw = p_brut,
           updated_at = NOW()
     WHERE id = v_paiement.id;
    RETURN QUERY SELECT 'montant_invalide', 'Le montant reçu ne correspond pas au forfait.';
    RETURN;
  END IF;

  SELECT * INTO v_plan FROM plans_abonnement WHERE code = v_paiement.plan_code;

  UPDATE paiements
     SET statut = 'paye',
         reference_externe = p_reference_externe,
         operateur = 'moneroo',
         provider_raw = p_brut,
         paye_le = NOW(),
         updated_at = NOW()
   WHERE id = v_paiement.id;

  -- Un abonnement encore valable se PROLONGE : quelqu'un qui renouvelle avant
  -- l'echeance ne doit pas perdre les jours qu'il a deja payes.
  SELECT GREATEST(MAX(expires_at), NOW()) INTO v_fin
  FROM subscriptions
  WHERE profile_id = v_paiement.profile_id
    AND status IN ('active', 'grace_period');

  v_fin := COALESCE(v_fin, NOW()) + INTERVAL '30 days';

  INSERT INTO subscriptions (profile_id, role, plan_name, amount_paid, currency,
                             status, payment_method, transaction_reference,
                             starts_at, expires_at)
  VALUES (v_paiement.profile_id, v_plan.role_cible, v_plan.libelle,
          v_paiement.montant, v_paiement.devise, 'active', 'moneroo',
          p_reference_externe, NOW(), v_fin);

  RETURN QUERY SELECT 'active', format('Abonnement actif jusqu''au %s',
                                       TO_CHAR(v_fin, 'DD/MM/YYYY'));
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. PRIVILEGES
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.demarrer_paiement_abonnement(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.demarrer_paiement_abonnement(TEXT) TO authenticated;

-- Confirmer, c'est activer un abonnement. Personne d'autre que le serveur.
REVOKE ALL ON FUNCTION public.confirmer_paiement_abonnement(TEXT, TEXT, NUMERIC, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- SECRETS A POSER AVANT LA MISE EN SERVICE (Supabase → Edge Functions → Secrets)
--
--   MONEROO_SECRET_KEY       la cle secrete du compte Moneroo (bac a sable
--                            d'abord, puis production)
--   MONEROO_WEBHOOK_SECRET   le secret de signature des webhooks
--   RELAIS_SITE_URL          l'adresse du site, pour le retour apres paiement
--
-- Aucune de ces valeurs ne doit apparaitre dans public/ : la cle secrete permet
-- d'emettre des paiements au nom de Relais.
-- =============================================================================

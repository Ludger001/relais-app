-- =============================================================================
-- RELAIS — LES CHIFFRES DES TABLEAUX DE BORD
--
-- Applique le 2026-09-06 sur le projet Supabase "relais-hub" :
--   relais_statistiques_tableaux_de_bord
--
-- Pourquoi en base et pas dans le navigateur : le rapprochement (cash encaisse
-- moins frais de livraison = net a reverser) doit donner le MEME nombre au
-- marchand et a l'agence. Un calcul cote navigateur n'est opposable a personne.
-- C'est la disparition d'Excel qui est le produit ; ces fonctions en sont le
-- moteur.
--
-- Chacune est SECURITY DEFINER, mais ne lit QUE les lignes du demandeur :
-- l'identite vient de my_merchant_id() / my_agency_id() / is_admin(), jamais
-- d'un parametre. Il n'y a donc rien a falsifier depuis la console.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. MARCHAND — « ou sont mes colis, et combien me doit-on ? »
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tableau_de_bord_marchand()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_marchand UUID := public.my_merchant_id();
  v_res JSONB;
BEGIN
  -- Une agence ou un visiteur n'a pas de fiche marchand : on ne revele rien.
  IF v_marchand IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT jsonb_build_object(
    'colis_en_attente',    COUNT(*) FILTER (WHERE status = 'pending_pickup'),
    'colis_en_route',      COUNT(*) FILTER (WHERE status = 'in_transit'),
    'livres_7j',           COUNT(*) FILTER (WHERE status = 'delivered' AND delivered_at > NOW() - INTERVAL '7 days'),
    'echecs_7j',           COUNT(*) FILTER (WHERE status = 'failed_attempt' AND updated_at > NOW() - INTERVAL '7 days'),

    -- L'argent encaisse chez les clients qui n'est pas encore revenu
    'cash_a_recevoir',     COALESCE(SUM(cod_amount - delivery_fee)
                             FILTER (WHERE status = 'delivered' AND payout_status <> 'paid'), 0),
    'cash_en_reglement',   COALESCE(SUM(cod_amount - delivery_fee)
                             FILTER (WHERE payout_status = 'in_settlement'), 0),
    'recu_30j',            COALESCE(SUM(cod_amount - delivery_fee)
                             FILTER (WHERE payout_status = 'paid' AND delivered_at > NOW() - INTERVAL '30 days'), 0),

    'volume_30j',          COALESCE(SUM(cod_amount)
                             FILTER (WHERE status = 'delivered' AND delivered_at > NOW() - INTERVAL '30 days'), 0),
    'frais_30j',           COALESCE(SUM(delivery_fee)
                             FILTER (WHERE status = 'delivered' AND delivered_at > NOW() - INTERVAL '30 days'), 0),
    'total_commandes',     COUNT(*)
  ) INTO v_res
  FROM orders WHERE merchant_id = v_marchand;

  RETURN v_res || jsonb_build_object(
    'agences_actives', (SELECT COUNT(DISTINCT agency_id) FROM orders WHERE merchant_id = v_marchand),
    'reversements_a_confirmer', (SELECT COUNT(*) FROM financial_payouts
                                  WHERE merchant_id = v_marchand AND status = 'initiated'),
    'conversations', (SELECT COUNT(*) FROM conversations WHERE merchant_id = v_marchand)
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 2. AGENCE — « que dois-je livrer aujourd'hui, et combien dois-je rendre ? »
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tableau_de_bord_agence()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_agence UUID := public.my_agency_id();
  v_res JSONB;
BEGIN
  IF v_agence IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT jsonb_build_object(
    'a_ramasser',          COUNT(*) FILTER (WHERE status = 'pending_pickup'),
    'en_tournee',          COUNT(*) FILTER (WHERE status = 'in_transit'),
    'livres_aujourdhui',   COUNT(*) FILTER (WHERE status = 'delivered' AND delivered_at::date = CURRENT_DATE),
    'echecs_aujourdhui',   COUNT(*) FILTER (WHERE status = 'failed_attempt' AND updated_at::date = CURRENT_DATE),

    -- Le cash encaisse chez les clients appartient au marchand, pas a l'agence
    'cash_a_reverser',     COALESCE(SUM(cod_amount - delivery_fee)
                             FILTER (WHERE status = 'delivered' AND payout_status = 'unpaid'), 0),
    'cash_encaisse_jour',  COALESCE(SUM(cod_amount)
                             FILTER (WHERE status = 'delivered' AND delivered_at::date = CURRENT_DATE), 0),

    -- Ce que l'agence gagne reellement : ses frais de livraison
    'mes_frais_30j',       COALESCE(SUM(delivery_fee)
                             FILTER (WHERE status = 'delivered' AND delivered_at > NOW() - INTERVAL '30 days'), 0),
    'livraisons_30j',      COUNT(*) FILTER (WHERE status = 'delivered' AND delivered_at > NOW() - INTERVAL '30 days'),
    'echecs_30j',          COUNT(*) FILTER (WHERE status = 'failed_attempt' AND updated_at > NOW() - INTERVAL '30 days')
  ) INTO v_res
  FROM orders WHERE agency_id = v_agence;

  RETURN v_res || jsonb_build_object(
    'marchands_actifs', (SELECT COUNT(DISTINCT merchant_id) FROM orders WHERE agency_id = v_agence),
    'reversements_a_declarer', (SELECT COUNT(*) FROM financial_payouts
                                 WHERE agency_id = v_agence AND status = 'draft'),
    -- Une conversation sans commande, c'est un marchand qui attend une reponse
    'nouvelles_demandes', (SELECT COUNT(*) FROM conversations c
                            WHERE c.agency_id = v_agence
                              AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.conversation_id = c.id))
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. ADMINISTRATEUR — « comment va la plateforme ? »
--
-- Seule fonction des trois a lever une exception plutot qu'a rendre un objet
-- vide : ici, un appel non autorise n'est pas un cas normal, c'est une tentative.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tableau_de_bord_admin()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Réservé à l''administration';
  END IF;

  RETURN jsonb_build_object(
    -- Les membres
    'marchands',            (SELECT COUNT(*) FROM merchants),
    'agences_certifiees',   (SELECT COUNT(*) FROM agencies WHERE status = 'verified'),
    'agences_en_attente',   (SELECT COUNT(*) FROM agencies WHERE status = 'pending_verification'),
    'agences_refusees',     (SELECT COUNT(*) FROM agencies WHERE status = 'rejected'),
    'inscrits_7j',          (SELECT COUNT(*) FROM profiles WHERE created_at > NOW() - INTERVAL '7 days'),

    -- L'activite reelle
    'commandes_total',      (SELECT COUNT(*) FROM orders),
    'commandes_7j',         (SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '7 days'),
    'livrees_7j',           (SELECT COUNT(*) FROM orders WHERE status = 'delivered' AND delivered_at > NOW() - INTERVAL '7 days'),
    'volume_30j',           (SELECT COALESCE(SUM(cod_amount), 0) FROM orders
                              WHERE status = 'delivered' AND delivered_at > NOW() - INTERVAL '30 days'),
    'conversations',        (SELECT COUNT(*) FROM conversations),
    'messages_7j',          (SELECT COUNT(*) FROM messages WHERE created_at > NOW() - INTERVAL '7 days'),

    -- Le bouclier anti-desintermediation
    'tentatives_7j',        (SELECT COUNT(*) FROM security_violations WHERE created_at > NOW() - INTERVAL '7 days'),
    'tentatives_total',     (SELECT COUNT(*) FROM security_violations),
    'membres_recidivistes', (SELECT COUNT(*) FROM (
                               SELECT user_id FROM security_violations
                               WHERE created_at > NOW() - INTERVAL '30 days'
                               GROUP BY user_id HAVING COUNT(*) >= 3) r),

    -- L'argent qui circule
    'reversements_en_cours', (SELECT COUNT(*) FROM financial_payouts WHERE status IN ('draft','initiated')),
    'litiges',               (SELECT COUNT(*) FROM financial_payouts WHERE status = 'disputed'),
    'cash_en_circulation',   (SELECT COALESCE(SUM(cod_amount - delivery_fee), 0) FROM orders
                               WHERE status = 'delivered' AND payout_status <> 'paid'),

    -- Le revenu de Relais : deux abonnements, jamais de commission
    'abonnements_actifs',    (SELECT COUNT(*) FROM subscriptions
                               WHERE status IN ('active','grace_period') AND expires_at > NOW()),
    'revenu_mensuel',        (SELECT COALESCE(SUM(amount_paid), 0) FROM subscriptions
                               WHERE status IN ('active','grace_period') AND expires_at > NOW())
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. PRIVILEGES
--
-- Un visiteur non connecte n'a rien a compter : on retire EXECUTE a public et
-- a anon, puis on le rend au seul role connecte. Le cloisonnement par role
-- metier est fait DANS les fonctions, pas par le privilege SQL.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.tableau_de_bord_marchand() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tableau_de_bord_agence()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tableau_de_bord_admin()    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.tableau_de_bord_marchand() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tableau_de_bord_agence()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.tableau_de_bord_admin()    TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. DURCISSEMENT DES FONCTIONS DE REFERENCE
--
-- Applique le 2026-09-06 : relais_fige_search_path_references
--
-- reference_commande() et reference_reversement() appelaient nextval() sur une
-- sequence nommee sans schema, sans search_path fige. L'appelant choisissait
-- donc ou cette sequence etait cherchee : il pouvait en placer une a lui devant
-- et decider des references emises. Le chemin est desormais fige, comme pour
-- toutes les autres fonctions du projet.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reference_commande()
RETURNS TEXT LANGUAGE SQL SET search_path = public AS $$
  SELECT 'REL-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
         LPAD(nextval('public.sequence_reference_commande')::TEXT, 5, '0');
$$;

CREATE OR REPLACE FUNCTION public.reference_reversement()
RETURNS TEXT LANGUAGE SQL SET search_path = public AS $$
  SELECT 'PAY-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
         LPAD(nextval('public.sequence_reference_reversement')::TEXT, 5, '0');
$$;

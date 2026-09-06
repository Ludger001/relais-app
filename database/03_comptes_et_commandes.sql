-- =============================================================================
-- RELAIS — CRÉATION DES PROFILS, RÉFÉRENCES DE COMMANDE, ET GEL DES CONDITIONS
--
-- Appliqué le 2026-09-05/06 sur le projet Supabase "relais-hub". Regroupe :
--   relais_creation_profil_a_inscription
--   relais_autoriser_contexte_serveur
--   relais_reference_commande_automatique
--   relais_geler_conditions_commande
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. À L'INSCRIPTION, CRÉER LE PROFIL ET LA FICHE MÉTIER
--
-- Indispensable : juste après signUp, le navigateur n'est pas encore
-- authentifié, donc RLS l'empêche d'insérer son propre profil.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  meta       JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_role     user_role;
  v_country  target_country;
  v_profile  UUID;
BEGIN
  IF meta->>'role' IS NULL OR meta->>'country' IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_role    := (meta->>'role')::user_role;
    v_country := (meta->>'country')::target_country;
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;

  -- SÉCURITÉ : on ne devient jamais administrateur en le demandant à
  -- l'inscription. Le rôle admin ne s'accorde qu'à la main, en base.
  IF v_role = 'admin' THEN
    RETURN NEW;
  END IF;

  INSERT INTO profiles (auth_user_id, email, full_name, role, country)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NULLIF(TRIM(meta->>'full_name'), ''), NEW.email),
    v_role, v_country
  )
  RETURNING id INTO v_profile;

  IF v_role = 'merchant' THEN
    INSERT INTO merchants (profile_id, store_name, primary_country, product_categories)
    VALUES (
      v_profile,
      COALESCE(NULLIF(TRIM(meta->>'store_name'), ''), 'Boutique sans nom'),
      v_country,
      COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(meta->'product_categories') = 'array'
             THEN meta->'product_categories' ELSE '[]'::jsonb END) x), '{}'::text[])
    );

  ELSIF v_role = 'agency' THEN
    INSERT INTO agencies (
      profile_id, company_name, legal_registration_number, country, primary_city,
      covered_areas, base_delivery_fee, cod_payout_frequency, has_warehousing, fleet_size
    )
    VALUES (
      v_profile,
      COALESCE(NULLIF(TRIM(meta->>'company_name'), ''), 'Agence sans nom'),
      NULLIF(TRIM(meta->>'legal_registration_number'), ''),
      v_country,
      COALESCE(NULLIF(TRIM(meta->>'primary_city'), ''), 'Non precisee'),
      COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(meta->'covered_areas') = 'array'
             THEN meta->'covered_areas' ELSE '[]'::jsonb END) x), '{}'::text[]),
      COALESCE((meta->>'base_delivery_fee')::NUMERIC, 1500.00),
      COALESCE((meta->>'cod_payout_frequency')::payout_frequency, 'weekly'),
      COALESCE((meta->>'has_warehousing')::BOOLEAN, FALSE),
      COALESCE((meta->>'fleet_size')::INTEGER, 1)
    );
    -- statut laissé à 'pending_verification' : une agence n'apparaît dans
    -- l'annuaire qu'après validation KYC par un administrateur
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- -----------------------------------------------------------------------------
-- 2. LES TRIGGERS DE PROTECTION DOIVENT LAISSER PASSER LE CONTEXTE SERVEUR
--
-- auth.uid() est NULL quand il n'y a aucune session : clé service_role,
-- console SQL, tâche planifiée. Sans cette ouverture, certifier une agence
-- depuis l'espace d'administration était impossible.
--
-- Une requête d'un membre connecté porte TOUJOURS un auth.uid(), donc rien
-- n'est relâché pour les utilisateurs de l'application.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Changement de role interdit';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_agency_verification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
       OR NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
       OR NEW.rating_count IS DISTINCT FROM OLD.rating_count THEN
      RAISE EXCEPTION 'Seul un administrateur peut modifier la certification ou la note';
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prevent_role_escalation()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_agency_verification() FROM PUBLIC, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. RÉFÉRENCE DE COMMANDE GÉNÉRÉE PAR LA BASE
--
-- Si le navigateur la fabriquait, deux marchands commandant au même instant
-- pourraient produire la même référence : la contrainte d'unicité ferait
-- échouer l'un des deux sans raison compréhensible pour lui.
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS sequence_reference_commande START 1;

CREATE OR REPLACE FUNCTION public.reference_commande()
RETURNS TEXT LANGUAGE SQL VOLATILE AS $$
  SELECT 'REL-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
         LPAD(nextval('sequence_reference_commande')::TEXT, 5, '0');
$$;

ALTER TABLE orders ALTER COLUMN order_code SET DEFAULT public.reference_commande();

REVOKE ALL ON SEQUENCE sequence_reference_commande FROM anon;
GRANT USAGE ON SEQUENCE sequence_reference_commande TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. LES CONDITIONS D'UNE COMMANDE NE SE RÉÉCRIVENT PAS APRÈS COUP
--
-- Faille constatée et corrigée : un marchand pouvait modifier cod_amount
-- APRÈS livraison (15 000 → 300 000 FCFA), donc changer unilatéralement ce
-- que l'agence lui doit. Symétriquement, une agence aurait pu réduire le
-- montant encaissé.
--
-- Le bilan financier repose entièrement sur ces chiffres. Ils sont figés dès
-- que le colis quitte les mains du marchand.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.figer_conditions_commande()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  est_marchand BOOLEAN := (NEW.merchant_id = public.my_merchant_id());
  est_agence   BOOLEAN := (NEW.agency_id   = public.my_agency_id());
  cote_serveur BOOLEAN := (auth.uid() IS NULL) OR public.is_admin();
BEGIN
  IF cote_serveur THEN
    RETURN NEW;
  END IF;

  -- L'identité de la commande n'appartient à personne
  IF NEW.order_code         IS DISTINCT FROM OLD.order_code
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
     OR NEW.merchant_id     IS DISTINCT FROM OLD.merchant_id
     OR NEW.agency_id       IS DISTINCT FROM OLD.agency_id THEN
    RAISE EXCEPTION 'La référence et les parties d''une commande ne peuvent pas changer';
  END IF;

  -- Le statut de reversement suit le point financier, il ne se force pas
  IF NEW.payout_status IS DISTINCT FROM OLD.payout_status THEN
    RAISE EXCEPTION 'Le statut de reversement se règle depuis le point financier';
  END IF;

  -- Conditions commerciales et coordonnées du destinataire
  IF NEW.product_name             IS DISTINCT FROM OLD.product_name
     OR NEW.quantity              IS DISTINCT FROM OLD.quantity
     OR NEW.cod_amount            IS DISTINCT FROM OLD.cod_amount
     OR NEW.delivery_fee          IS DISTINCT FROM OLD.delivery_fee
     OR NEW.currency              IS DISTINCT FROM OLD.currency
     OR NEW.recipient_name        IS DISTINCT FROM OLD.recipient_name
     OR NEW.recipient_phone       IS DISTINCT FROM OLD.recipient_phone
     OR NEW.recipient_address     IS DISTINCT FROM OLD.recipient_address
     OR NEW.recipient_city        IS DISTINCT FROM OLD.recipient_city
     OR NEW.delivery_instructions IS DISTINCT FROM OLD.delivery_instructions THEN

    IF NOT est_marchand THEN
      RAISE EXCEPTION 'Seul le marchand peut corriger le contenu de sa commande';
    END IF;

    IF OLD.status <> 'pending_pickup' THEN
      RAISE EXCEPTION 'Commande déjà prise en charge : ses conditions sont figées';
    END IF;
  END IF;

  -- La date de livraison est posée par la base, jamais déclarée
  IF NEW.delivered_at IS DISTINCT FROM OLD.delivered_at AND NOT est_agence THEN
    RAISE EXCEPTION 'La date de livraison est établie par Relais';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.figer_conditions_commande() FROM PUBLIC, anon, authenticated;

-- Ce contrôle passe AVANT celui qui journalise le changement de statut
CREATE TRIGGER trg_orders_figer_conditions
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION public.figer_conditions_commande();

-- =============================================================================
-- RELAIS — IDENTITE, RLS, DURCISSEMENT DES PRIVILEGES
--
-- Applique le 2026-09-05 sur le projet Supabase "relais-hub". Regroupe :
--   20260905234339_relais_rls_et_securite
--   20260905234421_relais_durcissement_privileges
--   20260905234533_relais_verrouillage_fonctions
--
-- Principe : ne jamais dependre uniquement de l'absence d'une policy.
-- Quand un acces doit etre impossible, on retire aussi le privilege SQL.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. QUI SUIS-JE ? (SECURITY DEFINER pour eviter la recursion RLS sur profiles)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.profiles WHERE auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS user_role LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE auth_user_id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.my_merchant_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id FROM public.merchants m
  JOIN public.profiles p ON p.id = m.profile_id
  WHERE p.auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.my_agency_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id FROM public.agencies a
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE p.auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_participant(conv_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conv_id
      AND (c.merchant_id = public.my_merchant_id() OR c.agency_id = public.my_agency_id())
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. ACTIVATION DE RLS PARTOUT
-- -----------------------------------------------------------------------------
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agencies            ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_payouts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews             ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3. PROFILES — on ne voit que soi (l'email des autres reste invisible)
-- -----------------------------------------------------------------------------
CREATE POLICY profiles_select_self ON profiles FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_admin());

CREATE POLICY profiles_insert_self ON profiles FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY profiles_update_self ON profiles FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_admin())
  WITH CHECK (auth_user_id = auth.uid() OR public.is_admin());

-- Personne ne s'auto-promeut administrateur
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Changement de role interdit';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_no_escalation
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();

-- -----------------------------------------------------------------------------
-- 4. AGENCIES — l'annuaire ne montre que les agences verifiees
-- -----------------------------------------------------------------------------
CREATE POLICY agencies_select_verified ON agencies FOR SELECT TO authenticated
  USING (status = 'verified' OR profile_id = public.current_profile_id() OR public.is_admin());

CREATE POLICY agencies_insert_own ON agencies FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id() AND public.my_role() = 'agency');

CREATE POLICY agencies_update_own ON agencies FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id() OR public.is_admin())
  WITH CHECK (profile_id = public.current_profile_id() OR public.is_admin());

-- Une agence ne se certifie pas elle-meme et ne se note pas elle-meme
CREATE OR REPLACE FUNCTION public.protect_agency_verification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
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

CREATE TRIGGER trg_agencies_protect_verification
  BEFORE UPDATE ON agencies
  FOR EACH ROW EXECUTE FUNCTION public.protect_agency_verification();

-- -----------------------------------------------------------------------------
-- 5. MERCHANTS — une agence ne voit un marchand que si elle discute avec lui
-- -----------------------------------------------------------------------------
CREATE POLICY merchants_select_related ON merchants FOR SELECT TO authenticated
  USING (
    profile_id = public.current_profile_id()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.merchant_id = merchants.id AND c.agency_id = public.my_agency_id()
    )
  );

CREATE POLICY merchants_insert_own ON merchants FOR INSERT TO authenticated
  WITH CHECK (profile_id = public.current_profile_id() AND public.my_role() = 'merchant');

CREATE POLICY merchants_update_own ON merchants FOR UPDATE TO authenticated
  USING (profile_id = public.current_profile_id() OR public.is_admin())
  WITH CHECK (profile_id = public.current_profile_id() OR public.is_admin());

-- -----------------------------------------------------------------------------
-- 6. SUBSCRIPTIONS — lecture seule cote client ; seul le webhook de paiement ecrit
-- -----------------------------------------------------------------------------
CREATE POLICY subscriptions_select_own ON subscriptions FOR SELECT TO authenticated
  USING (profile_id = public.current_profile_id() OR public.is_admin());

-- -----------------------------------------------------------------------------
-- 7. CONVERSATIONS — participants uniquement
-- -----------------------------------------------------------------------------
CREATE POLICY conversations_select_participant ON conversations FOR SELECT TO authenticated
  USING (merchant_id = public.my_merchant_id() OR agency_id = public.my_agency_id() OR public.is_admin());

CREATE POLICY conversations_insert_merchant ON conversations FOR INSERT TO authenticated
  WITH CHECK (
    merchant_id = public.my_merchant_id()
    AND EXISTS (SELECT 1 FROM agencies a WHERE a.id = conversations.agency_id AND a.status = 'verified')
  );

CREATE POLICY conversations_update_participant ON conversations FOR UPDATE TO authenticated
  USING (merchant_id = public.my_merchant_id() OR agency_id = public.my_agency_id() OR public.is_admin())
  WITH CHECK (merchant_id = public.my_merchant_id() OR agency_id = public.my_agency_id() OR public.is_admin());

-- -----------------------------------------------------------------------------
-- 8. MESSAGES — lecture pour les participants, ECRITURE DIRECTE IMPOSSIBLE
-- -----------------------------------------------------------------------------
CREATE POLICY messages_select_participant ON messages FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id) OR public.is_admin());

-- Aucune policy INSERT/UPDATE/DELETE : le seul chemin d'ecriture sera la
-- fonction serveur de filtrage (Bloc 7). On coupe aussi le privilege lui-meme.
REVOKE INSERT, UPDATE, DELETE ON public.messages FROM anon, authenticated;

-- Le contenu brut ne doit JAMAIS sortir, meme pour un participant legitime.
-- ATTENTION : un REVOKE de colonne seul ne suffit pas quand le SELECT est
-- accorde sur toute la table. Il faut retirer le SELECT global, puis le
-- reaccorder colonne par colonne en omettant original_content.
REVOKE SELECT ON public.messages FROM anon, authenticated;
GRANT SELECT (id, conversation_id, sender_id, filtered_content,
              has_contact_leak_attempt, attachment_url, is_read, created_at)
  ON public.messages TO authenticated;

CREATE VIEW public.messages_readable WITH (security_invoker = on) AS
  SELECT id, conversation_id, sender_id, filtered_content,
         has_contact_leak_attempt, attachment_url, is_read, created_at
  FROM public.messages;

GRANT SELECT ON public.messages_readable TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. ORDERS — le bon de commande structure
-- -----------------------------------------------------------------------------
CREATE POLICY orders_select_participant ON orders FOR SELECT TO authenticated
  USING (merchant_id = public.my_merchant_id() OR agency_id = public.my_agency_id() OR public.is_admin());

CREATE POLICY orders_insert_merchant ON orders FOR INSERT TO authenticated
  WITH CHECK (
    merchant_id = public.my_merchant_id()
    AND public.is_conversation_participant(conversation_id)
  );

CREATE POLICY orders_update_participant ON orders FOR UPDATE TO authenticated
  USING (merchant_id = public.my_merchant_id() OR agency_id = public.my_agency_id() OR public.is_admin())
  WITH CHECK (merchant_id = public.my_merchant_id() OR agency_id = public.my_agency_id() OR public.is_admin());

-- Seule l'agence en charge fait evoluer la livraison, et tout est trace
CREATE OR REPLACE FUNCTION public.log_order_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  moi UUID := public.current_profile_id();
BEGIN
  NEW.updated_at := NOW();

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('in_transit', 'delivered', 'failed_attempt', 'returned')
       AND NEW.agency_id IS DISTINCT FROM public.my_agency_id()
       AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Seule l''agence en charge peut faire evoluer la livraison';
    END IF;

    IF NEW.status = 'delivered' AND NEW.delivered_at IS NULL THEN
      NEW.delivered_at := NOW();
    END IF;

    -- changed_by pointe sur un profil : si aucune session (service_role),
    -- on rattache la trace au profil du marchand proprietaire de la commande
    IF moi IS NULL THEN
      SELECT profile_id INTO moi FROM merchants WHERE id = NEW.merchant_id;
    END IF;

    INSERT INTO order_status_logs (order_id, changed_by, previous_status, new_status)
    VALUES (NEW.id, moi, OLD.status, NEW.status);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_log_status
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();

-- -----------------------------------------------------------------------------
-- 10. HISTORIQUE — lisible par les participants, ecrit par le trigger seulement
-- -----------------------------------------------------------------------------
CREATE POLICY status_logs_select_participant ON order_status_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_status_logs.order_id
        AND (o.merchant_id = public.my_merchant_id() OR o.agency_id = public.my_agency_id())
    )
    OR public.is_admin()
  );

REVOKE INSERT, UPDATE, DELETE ON public.order_status_logs FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. POINT FINANCIER
-- -----------------------------------------------------------------------------
CREATE POLICY payouts_select_participant ON financial_payouts FOR SELECT TO authenticated
  USING (merchant_id = public.my_merchant_id() OR agency_id = public.my_agency_id() OR public.is_admin());

CREATE POLICY payouts_insert_agency ON financial_payouts FOR INSERT TO authenticated
  WITH CHECK (agency_id = public.my_agency_id() OR public.is_admin());

CREATE POLICY payouts_update_participant ON financial_payouts FOR UPDATE TO authenticated
  USING (merchant_id = public.my_merchant_id() OR agency_id = public.my_agency_id() OR public.is_admin())
  WITH CHECK (merchant_id = public.my_merchant_id() OR agency_id = public.my_agency_id() OR public.is_admin());

CREATE POLICY payout_orders_select ON payout_orders FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM financial_payouts f
      WHERE f.id = payout_orders.payout_id
        AND (f.merchant_id = public.my_merchant_id() OR f.agency_id = public.my_agency_id())
    )
    OR public.is_admin()
  );

CREATE POLICY payout_orders_insert ON payout_orders FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM financial_payouts f
      WHERE f.id = payout_orders.payout_id AND f.agency_id = public.my_agency_id()
    )
    OR public.is_admin()
  );

-- -----------------------------------------------------------------------------
-- 12. TENTATIVES DE CONTOURNEMENT — l'administrateur seul les lit
-- -----------------------------------------------------------------------------
CREATE POLICY violations_select_admin ON security_violations FOR SELECT TO authenticated
  USING (public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.security_violations FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 13. AVIS — reputation visible entre membres, deposable apres une vraie livraison
-- -----------------------------------------------------------------------------
CREATE POLICY reviews_select_all ON reviews FOR SELECT TO authenticated
  USING (true);

CREATE POLICY reviews_insert_after_delivery ON reviews FOR INSERT TO authenticated
  WITH CHECK (
    merchant_id = public.my_merchant_id()
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.merchant_id = public.my_merchant_id()
        AND o.agency_id = reviews.agency_id
        AND o.status = 'delivered'
    )
  );

CREATE POLICY reviews_update_own ON reviews FOR UPDATE TO authenticated
  USING (merchant_id = public.my_merchant_id())
  WITH CHECK (merchant_id = public.my_merchant_id());

-- -----------------------------------------------------------------------------
-- 14. DURCISSEMENT DES PRIVILEGES
-- -----------------------------------------------------------------------------

-- Le visiteur anonyme n'a rien a faire dans les donnees metier
REVOKE ALL ON public.profiles            FROM anon;
REVOKE ALL ON public.agencies            FROM anon;
REVOKE ALL ON public.merchants           FROM anon;
REVOKE ALL ON public.subscriptions       FROM anon;
REVOKE ALL ON public.conversations       FROM anon;
REVOKE ALL ON public.messages            FROM anon;
REVOKE ALL ON public.orders              FROM anon;
REVOKE ALL ON public.order_status_logs   FROM anon;
REVOKE ALL ON public.financial_payouts   FROM anon;
REVOKE ALL ON public.payout_orders       FROM anon;
REVOKE ALL ON public.security_violations FROM anon;
REVOKE ALL ON public.reviews             FROM anon;
REVOKE ALL ON public.messages_readable   FROM anon;

-- Un abonnement ne s'accorde pas soi-meme
REVOKE INSERT, UPDATE, DELETE ON public.subscriptions FROM authenticated;

-- On n'efface pas une trace opposable : on annule, on ne supprime pas
REVOKE DELETE ON public.orders            FROM authenticated;
REVOKE DELETE ON public.conversations     FROM authenticated;
REVOKE DELETE ON public.financial_payouts FROM authenticated;
REVOKE DELETE ON public.agencies          FROM authenticated;
REVOKE DELETE ON public.reviews           FROM authenticated;

-- -----------------------------------------------------------------------------
-- 15. VERROUILLAGE DES FONCTIONS EXPOSEES EN RPC
-- -----------------------------------------------------------------------------

-- Fonctions de trigger : jamais appelables a la main. Les triggers s'executent
-- avec les droits du proprietaire de la table, retirer EXECUTE ne les gene pas.
REVOKE EXECUTE ON FUNCTION public.log_order_status_change()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_role_escalation()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_agency_verification() FROM PUBLIC, anon, authenticated;

-- Fonctions d'identite : necessaires aux policies RLS pour les membres
-- connectes. Elles ne revelent jamais que l'identite de l'appelant lui-meme.
REVOKE EXECUTE ON FUNCTION public.current_profile_id()              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_role()                         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin()                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_merchant_id()                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_agency_id()                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_profile_id()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_role()                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin()                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_merchant_id()                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_agency_id()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(UUID) TO authenticated;

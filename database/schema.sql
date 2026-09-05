-- =============================================================================
-- SAAS RELAIS — SCHÉMA RELATIONNEL POSTGRESQL / SUPABASE
-- Hub B2B & Opérations COD (Bénin, Togo, Sénégal, Côte d'Ivoire, Gabon)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ENUMS & TYPES
CREATE TYPE user_role AS ENUM ('merchant', 'agency', 'admin');
CREATE TYPE target_country AS ENUM ('BJ', 'TG', 'SN', 'CI', 'GA'); -- Bénin, Togo, Sénégal, Côte d'Ivoire, Gabon
CREATE TYPE agency_status AS ENUM ('pending_verification', 'verified', 'rejected', 'suspended');
CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'grace_period', 'cancelled');
CREATE TYPE payout_frequency AS ENUM ('daily', 'twice_weekly', 'weekly', 'bi_weekly');
CREATE TYPE order_status AS ENUM (
    'pending_pickup',     -- En attente de ramassage / expédition
    'in_transit',        -- En cours de livraison vers le client
    'delivered',         -- Livrée avec succès & fonds COD encaissés
    'failed_attempt',    -- Tentative infructueuse (client injoignable / report)
    'cancelled',         -- Annulée par le client / marchand
    'returned'           -- Colis retourné au stock marchand
);
CREATE TYPE payout_status AS ENUM (
    'unpaid',             -- Montant COD encaissé, en attente de reversement
    'in_settlement',      -- Inclus dans un point financier en cours de validation
    'paid'                -- Reversement confirmé et reçu par le marchand
);
CREATE TYPE financial_payout_status AS ENUM (
    'draft',              -- Brouillon généré
    'initiated',          -- Agence a marqué "Virement effectué" avec preuve
    'confirmed',          -- Marchand a validé "Fonds reçus"
    'disputed'            -- Contesté par l'une des parties
);
CREATE TYPE payment_gateway AS ENUM (
    'fedapay',
    'kkiapay',
    'paystack',
    'wave',
    'mtn_momo',
    'moov_money',
    'orange_money',
    'airtel_money'
);

-- 2. TABLES UTILISATEURS & PROFILS
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID UNIQUE, -- Lien Supabase Auth
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    role user_role NOT NULL,
    country target_country NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. PROFIL SPÉCIFIQUE AGENCE DE LIVRAISON
CREATE TABLE IF NOT EXISTS agencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    company_name VARCHAR(150) NOT NULL,
    legal_registration_number VARCHAR(100), -- IFU / NINEA / RCCM
    country target_country NOT NULL,
    primary_city VARCHAR(100) NOT NULL,
    covered_areas TEXT[] DEFAULT '{}',     -- Quartiers / villes satellites
    base_delivery_fee NUMERIC(12, 2) NOT NULL DEFAULT 1500.00,
    cod_payout_frequency payout_frequency DEFAULT 'weekly',
    has_warehousing BOOLEAN DEFAULT FALSE,
    fleet_size INTEGER DEFAULT 1,
    status agency_status DEFAULT 'pending_verification',
    verification_documents JSONB DEFAULT '[]'::jsonb, -- Stockage URLs pièces KYC
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by UUID REFERENCES profiles(id),
    rating_avg NUMERIC(3, 2) DEFAULT 5.00,
    rating_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 4. PROFIL SPÉCIFIQUE E-COMMERÇANT
CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    store_name VARCHAR(150) NOT NULL,
    product_categories TEXT[] DEFAULT '{}',
    primary_country target_country NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 5. GESTION DES ABONNEMENTS (Paywall bilatéral dès J1)
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role user_role NOT NULL,
    plan_name VARCHAR(50) NOT NULL, -- ex: 'starter_merchant', 'pro_agency'
    amount_paid NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'FCFA',
    status subscription_status DEFAULT 'active',
    payment_method payment_gateway,
    transaction_reference VARCHAR(150),
    starts_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 6. CONVERSATIONS & CHAT SÉCURISÉ (1-to-1 exclusif)
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    is_blocked BOOLEAN DEFAULT FALSE,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    CONSTRAINT unique_merchant_agency_conversation UNIQUE (merchant_id, agency_id)
);

-- 7. MESSAGES (Avec détection & masquage anti-fuite)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES profiles(id),
    original_content TEXT NOT NULL,
    filtered_content TEXT NOT NULL,
    has_contact_leak_attempt BOOLEAN DEFAULT FALSE,
    attachment_url TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 8. GESTION DES COMMANDES INTÉGRÉES AU CHAT (Mini-ERP COD)
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    agency_id UUID NOT NULL REFERENCES agencies(id),
    order_code VARCHAR(50) NOT NULL UNIQUE, -- ex: REL-2026-00124
    product_name VARCHAR(200) NOT NULL,     -- ex: Gel Visage Éclat 200ml
    quantity INTEGER DEFAULT 1,
    cod_amount NUMERIC(12, 2) NOT NULL,     -- Montant cash à encaisser chez le client
    delivery_fee NUMERIC(12, 2) NOT NULL,   -- Frais convenus avec l'agence
    currency VARCHAR(10) DEFAULT 'FCFA',
    
    -- Coordonnées du client destinataire final (autorisées uniquement ici)
    recipient_name VARCHAR(150) NOT NULL,
    recipient_phone VARCHAR(30) NOT NULL,
    recipient_address TEXT NOT NULL,
    recipient_city VARCHAR(100) NOT NULL,
    delivery_instructions TEXT,

    status order_status DEFAULT 'pending_pickup',
    payout_status payout_status DEFAULT 'unpaid',
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 9. HISTORIQUE DES STATUTS DE COMMANDE (Audit trail)
CREATE TABLE IF NOT EXISTS order_status_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    changed_by UUID NOT NULL REFERENCES profiles(id),
    previous_status order_status,
    new_status order_status NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 10. POINT FINANCIER & RÉCONCILIATION COD
CREATE TABLE IF NOT EXISTS financial_payouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payout_reference VARCHAR(50) NOT NULL UNIQUE, -- ex: PAY-2026-0891
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    agency_id UUID NOT NULL REFERENCES agencies(id),
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    
    period_start_date DATE NOT NULL,
    period_end_date DATE NOT NULL,
    total_delivered_orders INTEGER NOT NULL,
    total_cod_collected NUMERIC(12, 2) NOT NULL,
    total_delivery_fees NUMERIC(12, 2) NOT NULL,
    net_payout_amount NUMERIC(12, 2) NOT NULL, -- Total COD collecté - Frais agence
    currency VARCHAR(10) DEFAULT 'FCFA',
    
    status financial_payout_status DEFAULT 'draft',
    proof_document_url TEXT, -- Reçu capture de virement Mobile Money
    agency_note TEXT,
    merchant_note TEXT,
    
    initiated_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 11. ASSOCIATION DES COMMANDES AU POINT FINANCIER
CREATE TABLE IF NOT EXISTS payout_orders (
    payout_id UUID NOT NULL REFERENCES financial_payouts(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    PRIMARY KEY (payout_id, order_id)
);

-- 12. LOGS DE TENTATIVES DE DÉSINTERMÉDIATION (Sécurité)
CREATE TABLE IF NOT EXISTS security_violations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id),
    conversation_id UUID REFERENCES conversations(id),
    detected_pattern VARCHAR(100),
    attempted_content TEXT NOT NULL,
    action_taken VARCHAR(50) DEFAULT 'masked_and_warned',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 13. AVIS & NOTATIONS VÉRIFIÉS (Après au moins 1 livraison réussie)
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    overall_rating INTEGER CHECK (overall_rating BETWEEN 1 AND 5),
    speed_rating INTEGER CHECK (speed_rating BETWEEN 1 AND 5),
    cod_reliability_rating INTEGER CHECK (cod_reliability_rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    CONSTRAINT unique_merchant_agency_review UNIQUE (agency_id, merchant_id)
);

-- INDEXES POUR HAUTES PERFORMANCES
CREATE INDEX IF NOT EXISTS idx_profiles_role_country ON profiles(role, country);
CREATE INDEX IF NOT EXISTS idx_agencies_status_country ON agencies(status, country);
CREATE INDEX IF NOT EXISTS idx_orders_conversation_status ON orders(conversation_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_payout_status ON orders(payout_status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_profile_active ON subscriptions(profile_id, status, expires_at);

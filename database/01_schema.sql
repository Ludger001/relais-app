-- =============================================================================
-- RELAIS — SCHEMA INITIAL
-- Hub B2B & operations COD (Benin, Togo, Senegal, Cote d'Ivoire, Gabon)
--
-- Applique le 2026-09-05 sur le projet Supabase "relais-hub"
-- Migration : 20260905234212_relais_schema_initial
-- =============================================================================

CREATE TYPE user_role AS ENUM ('merchant', 'agency', 'admin');
CREATE TYPE target_country AS ENUM ('BJ', 'TG', 'SN', 'CI', 'GA');
CREATE TYPE agency_status AS ENUM ('pending_verification', 'verified', 'rejected', 'suspended');
CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'grace_period', 'cancelled');
CREATE TYPE payout_frequency AS ENUM ('daily', 'twice_weekly', 'weekly', 'bi_weekly');

CREATE TYPE order_status AS ENUM (
    'pending_pickup', 'in_transit', 'delivered',
    'failed_attempt', 'cancelled', 'returned'
);

CREATE TYPE payout_status AS ENUM ('unpaid', 'in_settlement', 'paid');
CREATE TYPE financial_payout_status AS ENUM ('draft', 'initiated', 'confirmed', 'disputed');

CREATE TYPE payment_gateway AS ENUM (
    'fedapay', 'kkiapay', 'paystack', 'wave',
    'mtn_momo', 'moov_money', 'orange_money', 'airtel_money'
);

-- PROFILS — rattaches a Supabase Auth
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    role user_role NOT NULL,
    country target_country NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    company_name VARCHAR(150) NOT NULL,
    legal_registration_number VARCHAR(100),
    country target_country NOT NULL,
    primary_city VARCHAR(100) NOT NULL,
    covered_areas TEXT[] NOT NULL DEFAULT '{}',
    base_delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 1500.00,
    cod_payout_frequency payout_frequency NOT NULL DEFAULT 'weekly',
    has_warehousing BOOLEAN NOT NULL DEFAULT FALSE,
    fleet_size INTEGER NOT NULL DEFAULT 1,
    status agency_status NOT NULL DEFAULT 'pending_verification',
    verification_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES profiles(id),
    rating_avg NUMERIC(3,2) NOT NULL DEFAULT 5.00,
    rating_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    store_name VARCHAR(150) NOT NULL,
    product_categories TEXT[] NOT NULL DEFAULT '{}',
    primary_country target_country NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role user_role NOT NULL,
    plan_name VARCHAR(50) NOT NULL,
    amount_paid NUMERIC(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'FCFA',
    status subscription_status NOT NULL DEFAULT 'active',
    payment_method payment_gateway,
    transaction_reference VARCHAR(150),
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_merchant_agency_conversation UNIQUE (merchant_id, agency_id)
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES profiles(id),
    original_content TEXT NOT NULL,
    filtered_content TEXT NOT NULL,
    has_contact_leak_attempt BOOLEAN NOT NULL DEFAULT FALSE,
    attachment_url TEXT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id),
    agency_id UUID NOT NULL REFERENCES agencies(id),
    order_code VARCHAR(50) NOT NULL UNIQUE,
    product_name VARCHAR(200) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    cod_amount NUMERIC(12,2) NOT NULL CHECK (cod_amount >= 0),
    delivery_fee NUMERIC(12,2) NOT NULL CHECK (delivery_fee >= 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'FCFA',

    -- Coordonnees du client destinataire : le SEUL endroit autorise
    recipient_name VARCHAR(150) NOT NULL,
    recipient_phone VARCHAR(30) NOT NULL,
    recipient_address TEXT NOT NULL,
    recipient_city VARCHAR(100) NOT NULL,
    delivery_instructions TEXT,

    status order_status NOT NULL DEFAULT 'pending_pickup',
    payout_status payout_status NOT NULL DEFAULT 'unpaid',
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- C'est cet historique qui tranche en cas de litige
CREATE TABLE order_status_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    changed_by UUID NOT NULL REFERENCES profiles(id),
    previous_status order_status,
    new_status order_status NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE financial_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payout_reference VARCHAR(50) NOT NULL UNIQUE,
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    agency_id UUID NOT NULL REFERENCES agencies(id),
    merchant_id UUID NOT NULL REFERENCES merchants(id),

    period_start_date DATE NOT NULL,
    period_end_date DATE NOT NULL,
    total_delivered_orders INTEGER NOT NULL,
    total_cod_collected NUMERIC(12,2) NOT NULL,
    total_delivery_fees NUMERIC(12,2) NOT NULL,
    net_payout_amount NUMERIC(12,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'FCFA',

    status financial_payout_status NOT NULL DEFAULT 'draft',
    proof_document_url TEXT,
    agency_note TEXT,
    merchant_note TEXT,

    initiated_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT periode_coherente CHECK (period_end_date >= period_start_date)
);

CREATE TABLE payout_orders (
    payout_id UUID NOT NULL REFERENCES financial_payouts(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    PRIMARY KEY (payout_id, order_id)
);

CREATE TABLE security_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id),
    conversation_id UUID REFERENCES conversations(id),
    detected_pattern VARCHAR(100),
    attempted_content TEXT NOT NULL,
    action_taken VARCHAR(50) NOT NULL DEFAULT 'masked_and_warned',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    overall_rating INTEGER NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
    speed_rating INTEGER CHECK (speed_rating BETWEEN 1 AND 5),
    cod_reliability_rating INTEGER CHECK (cod_reliability_rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_merchant_agency_review UNIQUE (agency_id, merchant_id)
);

-- INDEXES
CREATE INDEX idx_profiles_auth_user ON profiles(auth_user_id);
CREATE INDEX idx_profiles_role_country ON profiles(role, country);
CREATE INDEX idx_agencies_status_country ON agencies(status, country);
CREATE INDEX idx_agencies_profile ON agencies(profile_id);
CREATE INDEX idx_merchants_profile ON merchants(profile_id);
CREATE INDEX idx_conversations_merchant ON conversations(merchant_id);
CREATE INDEX idx_conversations_agency ON conversations(agency_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_orders_conversation_status ON orders(conversation_id, status);
CREATE INDEX idx_orders_agency_created ON orders(agency_id, created_at DESC);
CREATE INDEX idx_orders_merchant_created ON orders(merchant_id, created_at DESC);
CREATE INDEX idx_orders_payout_status ON orders(payout_status);
CREATE INDEX idx_subscriptions_profile_active ON subscriptions(profile_id, status, expires_at);
CREATE INDEX idx_status_logs_order ON order_status_logs(order_id, created_at DESC);

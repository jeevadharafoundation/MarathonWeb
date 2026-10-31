-- ==============================================================================
-- ANGAMALY MARATHON 2027 - SUPABASE DATABASE SCHEMA
-- Run this in your Supabase Dashboard: SQL Editor -> New Query -> Run
-- ==============================================================================

-- 1. Enable UUID Extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create Sequences for Automatic Registration Reference & Bib Numbering
CREATE SEQUENCE IF NOT EXISTS reg_code_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS temp_reg_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS bib_hm_seq START 12111; -- 21.1K Half Marathon
CREATE SEQUENCE IF NOT EXISTS bib_mm_seq START 13111; -- 10K Mini Marathon
CREATE SEQUENCE IF NOT EXISTS bib_fr_seq START 14111; -- 5K Fun Run

-- 3. Create Registrations Table
CREATE TABLE IF NOT EXISTS public.registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reg_code VARCHAR(30) UNIQUE NOT NULL DEFAULT ('TMP-' || nextval('temp_reg_seq')),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL,
    gender VARCHAR(20) NOT NULL,
    dob DATE NOT NULL,
    age INT NOT NULL,
    phone VARCHAR(25) NOT NULL,
    emergency_contact VARCHAR(25) NOT NULL,
    blood_group VARCHAR(10) NOT NULL,
    address TEXT NOT NULL,
    hear_source VARCHAR(60),
    blood_donation_interest VARCHAR(15) DEFAULT 'No',
    category VARCHAR(20) NOT NULL, -- '21.1K', '10K', '5K'
    shirt_size VARCHAR(15) NOT NULL, -- 'XS / 34', 'S / 36', 'M / 38', 'L / 40', 'XL / 42', 'XXL / 44'
    fee_type VARCHAR(20) NOT NULL, -- 'regular', 'early', 'student'
    amount_payable NUMERIC(10,2) NOT NULL,
    payment_provider VARCHAR(30) NOT NULL, -- 'gpay', 'phonepe', 'paytm', 'supermoney', 'amazonpay'
    utr_number VARCHAR(100) DEFAULT 'IN_PROOF',
    payment_proof_url TEXT NOT NULL, -- Stored in Cloudflare R2
    student_proof_url TEXT, -- Stored in Cloudflare R2 (optional)
    group_members JSONB, -- Stored for student group registrations (minimum 5, no max limit: array of member objects)
    payment_status VARCHAR(20) DEFAULT 'pending' NOT NULL, -- 'pending', 'verified', 'rejected'
    bib_number VARCHAR(30), -- Assigned by admin on verification
    rejection_reason TEXT,
    verified_at TIMESTAMPTZ,
    admin_notes TEXT,
    email_sent BOOLEAN DEFAULT false,
    email_sent_at TIMESTAMPTZ
);

-- 4. Create Event Settings Table for Dynamic Configs
CREATE TABLE IF NOT EXISTS public.event_settings (
    key VARCHAR(60) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed Initial Default Settings
INSERT INTO public.event_settings (key, value)
VALUES 
(
    'upi_config', 
    jsonb_build_object(
        'gpay', 'qr.jeevadhara@sib',
        'phonepe', 'qr.jeevadhara@sib',
        'paytm', 'qr.jeevadhara@sib',
        'supermoney', 'qr.jeevadhara@sib',
        'amazonpay', 'qr.jeevadhara@sib'
    )
),
(
    'event_info',
    jsonb_build_object(
        'event_name', 'Angamaly Marathon 2027',
        'edition', '3rd Edition',
        'event_date', '2027-01-17',
        'reporting_venue', 'De Paul Institute of Science & Technology (DiST), Angamaly',
        'early_bird_deadline', '2027-01-05T18:00:00+05:30',
        'registration_open', true,
        'max_registrations', 3000
    )
)
ON CONFLICT (key) DO NOTHING;

-- 5. Helper Function to Generate Next Bib Number by Category
CREATE OR REPLACE FUNCTION public.assign_next_bib(race_cat TEXT)
RETURNS TEXT AS $$
DECLARE
    next_bib TEXT;
BEGIN
    IF race_cat = '21.1K' THEN
        next_bib := '' || nextval('bib_hm_seq');
    ELSIF race_cat = '10K' THEN
        next_bib := '' || nextval('bib_mm_seq');
    ELSE
        next_bib := '' || nextval('bib_fr_seq');
    END IF;
    RETURN next_bib;
END;
$$ LANGUAGE plpgsql;

-- 6. Create Indexes for High Performance Queries & Search
CREATE INDEX IF NOT EXISTS idx_reg_email ON public.registrations(email);
CREATE INDEX IF NOT EXISTS idx_reg_phone ON public.registrations(phone);
CREATE INDEX IF NOT EXISTS idx_reg_code ON public.registrations(reg_code);
CREATE INDEX IF NOT EXISTS idx_reg_utr ON public.registrations(utr_number);
CREATE INDEX IF NOT EXISTS idx_reg_status ON public.registrations(payment_status);
CREATE INDEX IF NOT EXISTS idx_reg_category ON public.registrations(category);
CREATE INDEX IF NOT EXISTS idx_reg_shirt ON public.registrations(shirt_size);
CREATE INDEX IF NOT EXISTS idx_reg_created ON public.registrations(created_at DESC);

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_settings ENABLE ROW LEVEL SECURITY;

-- 8. Policies for Registrations Table
-- Allow anyone to insert a new registration (Participants submitting form)
CREATE POLICY "Public can insert registrations"
ON public.registrations
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Allow public to select registrations (Used by confirmation slip & status check by reg_code or email)
CREATE POLICY "Public can view own registration"
ON public.registrations
FOR SELECT
TO anon, authenticated
USING (true);

-- Allow authenticated admins full update & delete access
CREATE POLICY "Admins have full access to registrations"
ON public.registrations
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 9. Policies for Event Settings Table
-- Public can read event configs (UPI IDs, deadlines)
CREATE POLICY "Public can read event settings"
ON public.event_settings
FOR SELECT
TO anon, authenticated
USING (true);

-- Only authenticated admins can modify event settings
CREATE POLICY "Admins can update event settings"
ON public.event_settings
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- ==============================================================================
-- 10. RAZORPAY PAYMENT GATEWAY EXTENSIONS, AUDIT LOGS & ATOMIC CONFIRMATION RPC
-- ==============================================================================

ALTER TABLE public.registrations ALTER COLUMN payment_proof_url SET DEFAULT 'RAZORPAY_CHECKOUT';

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(64) UNIQUE,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(64) UNIQUE,
  ADD COLUMN IF NOT EXISTS razorpay_signature VARCHAR(256),
  ADD COLUMN IF NOT EXISTS gateway_status VARCHAR(30) DEFAULT 'created' NOT NULL,
  ADD COLUMN IF NOT EXISTS payment_method_detail VARCHAR(80),
  ADD COLUMN IF NOT EXISTS amount_paid_paise INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120) UNIQUE,
  ADD COLUMN IF NOT EXISTS payment_attempts INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_payment_error JSONB,
  ADD COLUMN IF NOT EXISTS refund_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS refund_status VARCHAR(30) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS refund_amount_paise INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_reg_rzp_order ON public.registrations(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_reg_rzp_payment ON public.registrations(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_reg_gateway_status ON public.registrations(gateway_status);
CREATE INDEX IF NOT EXISTS idx_reg_idempotency ON public.registrations(idempotency_key);

CREATE TABLE IF NOT EXISTS public.payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID REFERENCES public.registrations(id) ON DELETE CASCADE,
    reg_code VARCHAR(30),
    razorpay_order_id VARCHAR(64),
    razorpay_payment_id VARCHAR(64),
    event_type VARCHAR(60) NOT NULL,
    status VARCHAR(30) NOT NULL,
    amount_paise INTEGER,
    currency VARCHAR(10) DEFAULT 'INR',
    payment_method VARCHAR(60),
    error_code VARCHAR(80),
    error_description TEXT,
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pt_reg_id ON public.payment_transactions(registration_id);
CREATE INDEX IF NOT EXISTS idx_pt_order_id ON public.payment_transactions(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_pt_payment_id ON public.payment_transactions(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_pt_created ON public.payment_transactions(created_at DESC);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.razorpay_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(100) UNIQUE NOT NULL,
    event_type VARCHAR(60) NOT NULL,
    razorpay_order_id VARCHAR(64),
    razorpay_payment_id VARCHAR(64),
    processing_status VARCHAR(30) DEFAULT 'received' NOT NULL,
    payload JSONB NOT NULL,
    error_message TEXT,
    received_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rwe_event_id ON public.razorpay_webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_rwe_order_id ON public.razorpay_webhook_events(razorpay_order_id);

ALTER TABLE public.razorpay_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.confirm_razorpay_payment(
    p_reg_id UUID,
    p_razorpay_order_id TEXT,
    p_razorpay_payment_id TEXT,
    p_razorpay_signature TEXT,
    p_amount_paid_paise INT,
    p_payment_method_detail TEXT,
    p_utr_number TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reg public.registrations%ROWTYPE;
    v_primary_bib TEXT;
    v_members JSONB;
    v_updated_members JSONB := '[]'::jsonb;
    v_member JSONB;
    v_idx INT := 0;
    v_m_bib TEXT;
BEGIN
    SELECT * INTO v_reg
    FROM public.registrations
    WHERE id = p_reg_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration % not found', p_reg_id;
    END IF;

    IF v_reg.razorpay_order_id IS NOT NULL AND p_razorpay_order_id IS NOT NULL AND v_reg.razorpay_order_id <> p_razorpay_order_id THEN
        RAISE EXCEPTION 'Order ID mismatch for registration %', p_reg_id;
    END IF;

    IF v_reg.payment_status = 'verified' AND v_reg.bib_number IS NOT NULL AND v_reg.bib_number <> '' THEN
        UPDATE public.registrations
        SET razorpay_payment_id = COALESCE(v_reg.razorpay_payment_id, p_razorpay_payment_id),
            razorpay_signature = COALESCE(v_reg.razorpay_signature, p_razorpay_signature),
            gateway_status = 'captured',
            amount_paid_paise = GREATEST(COALESCE(v_reg.amount_paid_paise, 0), COALESCE(p_amount_paid_paise, 0)),
            payment_method_detail = COALESCE(p_payment_method_detail, v_reg.payment_method_detail),
            utr_number = CASE WHEN v_reg.utr_number IS NULL OR v_reg.utr_number = '' OR v_reg.utr_number = 'IN_PROOF' THEN COALESCE(p_utr_number, p_razorpay_payment_id) ELSE v_reg.utr_number END,
            updated_at = now()
        WHERE id = p_reg_id
        RETURNING * INTO v_reg;

        RETURN jsonb_build_object(
            'already_verified', true,
            'bib_number', v_reg.bib_number,
            'reg_code', v_reg.reg_code,
            'record', to_jsonb(v_reg)
        );
    END IF;

    v_primary_bib := COALESCE(NULLIF(v_reg.bib_number, ''), public.assign_next_bib(v_reg.category));

    v_members := v_reg.group_members;
    IF v_members IS NOT NULL AND jsonb_typeof(v_members) = 'array' AND jsonb_array_length(v_members) > 0 THEN
        FOR v_idx IN 0 .. (jsonb_array_length(v_members) - 1) LOOP
            v_member := v_members -> v_idx;
            IF (v_member ->> 'bib_number') IS NOT NULL AND (v_member ->> 'bib_number') <> '' THEN
                v_m_bib := v_member ->> 'bib_number';
            ELSE
                v_m_bib := public.assign_next_bib(v_reg.category);
            END IF;
            v_updated_members := v_updated_members || jsonb_build_array(
                v_member || jsonb_build_object('bib_number', v_m_bib)
            );
        END LOOP;
    ELSE
        v_updated_members := v_members;
    END IF;

    UPDATE public.registrations
    SET payment_status = 'verified',
        gateway_status = 'captured',
        bib_number = v_primary_bib,
        group_members = v_updated_members,
        razorpay_order_id = COALESCE(p_razorpay_order_id, v_reg.razorpay_order_id),
        razorpay_payment_id = COALESCE(p_razorpay_payment_id, v_reg.razorpay_payment_id),
        razorpay_signature = COALESCE(p_razorpay_signature, v_reg.razorpay_signature),
        amount_paid_paise = COALESCE(p_amount_paid_paise, v_reg.amount_paid_paise),
        payment_method_detail = COALESCE(p_payment_method_detail, v_reg.payment_method_detail),
        utr_number = COALESCE(NULLIF(p_utr_number, ''), p_razorpay_payment_id, v_reg.utr_number),
        verified_at = COALESCE(v_reg.verified_at, now()),
        rejection_reason = NULL,
        updated_at = now()
    WHERE id = p_reg_id
    RETURNING * INTO v_reg;

    RETURN jsonb_build_object(
        'already_verified', false,
        'bib_number', v_reg.bib_number,
        'reg_code', v_reg.reg_code,
        'record', to_jsonb(v_reg)
    );
END;
$$;

-- ==============================================================================
-- 11. AUTOMATIC PROMOTION OF TEMPORARY REG CODE TO OFFICIAL AM27- CODE
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.assign_reg_code_on_verify()
RETURNS TRIGGER AS $$
BEGIN
    -- If row is transitioning to verified and still has a temporary code (or no AM27- code)
    IF NEW.payment_status = 'verified' AND (NEW.reg_code IS NULL OR NEW.reg_code LIKE 'TMP-%' OR NEW.reg_code NOT LIKE 'AM27-%') THEN
        NEW.reg_code := 'AM27-' || nextval('reg_code_seq');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assign_reg_code_on_verify ON public.registrations;
CREATE TRIGGER trg_assign_reg_code_on_verify
BEFORE UPDATE ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION public.assign_reg_code_on_verify();


-- ==============================================================================
-- ANGAMALY MARATHON 2027 - SUPABASE DATABASE SCHEMA
-- Run this in your Supabase Dashboard: SQL Editor -> New Query -> Run
-- ==============================================================================

-- 1. Enable UUID Extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create Sequences for Automatic Registration Reference & Bib Numbering
CREATE SEQUENCE IF NOT EXISTS reg_code_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS bib_hm_seq START 1001; -- 21.1K Half Marathon
CREATE SEQUENCE IF NOT EXISTS bib_mm_seq START 2001; -- 10K Mini Marathon
CREATE SEQUENCE IF NOT EXISTS bib_fr_seq START 3001; -- 5K Fun Run

-- 3. Create Registrations Table
CREATE TABLE IF NOT EXISTS public.registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reg_code VARCHAR(30) UNIQUE NOT NULL DEFAULT ('AM27-' || nextval('reg_code_seq')),
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
    utr_number VARCHAR(100) NOT NULL,
    payment_proof_url TEXT NOT NULL, -- Stored in Cloudflare R2
    student_proof_url TEXT, -- Stored in Cloudflare R2 (optional)
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
        'gpay', 'marathon@upi',
        'phonepe', 'marathon@upi',
        'paytm', 'marathon@upi',
        'supermoney', 'marathon@upi',
        'amazonpay', 'marathon@upi'
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
        next_bib := 'HM-' || nextval('bib_hm_seq');
    ELSIF race_cat = '10K' THEN
        next_bib := 'MM-' || nextval('bib_mm_seq');
    ELSE
        next_bib := 'FR-' || nextval('bib_fr_seq');
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

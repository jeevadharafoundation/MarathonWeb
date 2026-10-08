# 🏃 Angamaly Marathon 2027 – Registration & Admin System

A production-ready, **100% Zero-Cost** marathon registration web platform and organizer admin portal built for ~3,000 runners.

---

## ⚡ Architecture & Technology Stack

| Service | Purpose | Free Tier Capacity | Expected Usage |
| :--- | :--- | :--- | :--- |
| **Cloudflare Pages** | Global Edge Web Hosting | Unlimited bandwidth & requests | Fast CDN frontend |
| **Cloudflare Pages Functions** | Serverless Edge API | 100,000 requests/day | File uploads & verify APIs |
| **Cloudflare R2** | Object Media Storage | 10 GB storage, $0 egress | ~450 MB (client compressed) |
| **Supabase** | PostgreSQL & Admin Auth | 500 MB DB, 50,000 Auth MAU | ~5 MB for 3,000 runners |
| **GitHub** | Version Control & CI/CD | Unlimited repositories | Push-to-deploy to Cloudflare |
| **Resend** | Transactional Confirmation Emails | 3,000 emails/month, 100/day | Runner bib confirmation |

---

## 📁 Project Structure

```
.
├── public/
│   ├── index.html                 # Participant registration page & event schedule
│   ├── gallery.html               # Marathon photo gallery
│   ├── admin.html                 # Organizer Admin Portal (Auth, verification, metrics, exports)
│   ├── confirmation.html          # Participant submission confirmation slip & status check
│   └── assets/
│       ├── css/
│       ├── js/
│       │   ├── config.js          # Client-side configuration
│       │   ├── compressor.js      # Client-side canvas image compressor (~150KB)
│       │   ├── register.js        # Registration form submission & R2 upload logic
│       │   └── admin.js           # Admin dashboard, table filters, & CSV export
│       └── images/                # Banners, posters, gallery images
├── functions/
│   └── api/
│       ├── upload.js              # Cloudflare Pages Function -> Streams image to R2
│       ├── confirm-registration.js# Verifies runner in Supabase & sends Resend email
│       └── reject-registration.js # Rejects invalid registration with reason
├── supabase/
│   └── schema.sql                 # Ready-to-run PostgreSQL schema, RLS, indexes & sequences
├── wrangler.toml                  # Cloudflare Pages & R2 bucket binding configuration
├── .env                           # Local environment variables
└── README.md
```

---

## 🚀 Setup & Deployment Guide

### Step 1: Run SQL Schema in Supabase
1. Open your Supabase project: [https://asjrnktlhhnibljgotsz.supabase.co](https://asjrnktlhhnibljgotsz.supabase.co)
2. Go to **SQL Editor** in the left sidebar → click **New query**.
3. Copy the entire contents of [`supabase/schema.sql`](supabase/schema.sql) and paste it into the editor.
4. Click **Run**. This will create:
   - `registrations` table with all fields and auto-incrementing `AM27-1001` registration codes.
   - `event_settings` table pre-seeded with UPI IDs and race parameters.
   - Row-Level Security (RLS) policies and performance indexes.

### Step 2: Create Your Admin Account in Supabase
1. In your Supabase Dashboard, go to **Authentication** → **Users**.
2. Click **Add user** → **Create user**.
3. Enter your email (e.g. `jeevadharafoundation2012@gmail.com`) and a password.
4. Use this email and password to log into `/admin.html`.

### Step 3: Connect GitHub to Cloudflare Pages
1. Go to your [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**.
2. Click **Create Application** → select the **Pages** tab → **Connect to Git**.
3. Select your repository: `jeevadharafoundation/MarathonWeb`.
4. Configure build settings:
   - **Framework preset**: `None`
   - **Build command**: *(leave empty)*
   - **Build output directory**: `public`
5. Click **Save and Deploy**.

### Step 4: Configure Cloudflare Pages R2 Binding & Environment Variables
In your deployed Cloudflare Pages project:

1. **Bind the R2 Bucket**:
   - Go to **Settings** → **Functions** → scroll down to **R2 bucket bindings**.
   - Click **Add binding**:
     - Variable name: `R2_BUCKET`
     - R2 bucket: `marathon-payment-details`
   - Click **Save**.

2. **Add Environment Variables**:
   - Go to **Settings** → **Environment variables** → click **Add variables**:
     - `SUPABASE_URL`: `your_supabase_project_url`
     - `SUPABASE_ANON_KEY`: `your_supabase_anon_key`
     - `SUPABASE_SERVICE_ROLE_KEY`: `your_supabase_service_role_key`
     - `RESEND_API_KEY`: `your_resend_api_key`
     - `SENDER_EMAIL`: `onboarding@resend.dev`
     - `ORGANIZER_EMAIL`: `jeevadharafoundation2012@gmail.com`
     - `R2_PUBLIC_DOMAIN`: `https://pub-7d6ecd8f80cc49d193ba7ce1c1f72c97.r2.dev`
   - Click **Save**.

---

## 📧 Email Notifications (Resend)

- When an admin clicks **✓ Approve & Send Resend Email** on the admin portal:
  - The runner's status updates to `verified`.
  - The assigned Bib number is recorded (e.g. `HM-1001`).
  - An email with the runner's name, bib, category, reporting time, venue, and kit distribution date is sent via Resend.
- **Resend Free Tier Rate Limit**: Resend allows 3,000 emails/month and **100 emails/day**.
  - If verifying more than 100 runners in a single day, the admin can use the **WA (WhatsApp)** button next to each runner to send instant confirmations at zero cost!

---

## 🛠️ Testing Locally

You can run and test the complete system locally with Cloudflare Wrangler:

```bash
# Install Wrangler dependencies
npm install

# Run local edge server with Pages Functions and R2 binding
npx wrangler pages dev public --r2 R2_BUCKET=marathon-payment-details
```

Open `http://localhost:8788` in your browser to test registration, and `http://localhost:8788/admin.html` for the admin portal.

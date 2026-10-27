# 📊 Angamaly Marathon 2027 – Real-Time Google Sheets Backup Setup Guide

A 100% Zero-Cost, automatic, real-time backup and mirror system that syncs runner registrations and admin verification updates directly into Google Sheets without slowing down the website or affecting registration stability.

---

## ⚡ How It Works (Triple-Layer Redundancy)

```
[Runner Registers / Admin Updates]
          │
          ├──> [1. Frontend/Edge Async Mirror] ────┐
          │    (fire-and-forget / waitUntil)       │
          │                                        ▼
          └──> [2. Supabase DB Webhook] ───> [/api/backup-to-sheet] ───> [Google Apps Script]
                                                   ▲                             │
[3. Admin Portal "Sync to Sheet" Button] ──────────┘                             ▼
                                                                        [Google Sheet Backup]
```

1. **Non-Blocking**: Database operations and user registration confirmations finish in milliseconds; mirroring occurs asynchronously in the background.
2. **Upsert Guarantee**: When someone registers, a new row is appended. When an organizer approves or assigns a bib number, the existing row is updated by `Reg Code` (no duplicate rows!).
3. **Clickable Links**: Payment proof screenshots stored in Cloudflare R2 automatically format as clickable `=HYPERLINK(url, "View Proof")` links in the sheet.

---

## 🚀 Setup Instructions (Takes ~3 minutes)

### Step 1: Create Your Google Sheet
1. Open [Google Sheets](https://sheets.new) in your browser.
2. Name your spreadsheet: **Angamaly Marathon 2027 – Live Registrations Backup**.
3. Keep the default sheet name or rename it to `Registrations`.

---

### Step 2: Paste the Apps Script Code
1. In the top menu of your Google Sheet, click **Extensions** → **Apps Script**.
2. In the code editor, delete any default code inside `Code.gs`.
3. Open [`google-sheets-backup/Code.gs`](./Code.gs), copy the **entire file**, and paste it into the Apps Script editor.
4. Click the **💾 Save** icon (or press `Ctrl + S`).

---

### Step 3: Deploy as a Web App
1. In the top right corner of Apps Script, click **Deploy** → **New deployment**.
2. Click the gear icon ⚙️ next to "Select type" and choose **Web app**.
3. Fill in the deployment settings:
   - **Description**: `Angamaly Marathon Realtime Backup`
   - **Execute as**: `Me (<your-email>)`
   - **Who has access**: `Anyone` *(Crucial: allows Cloudflare and Supabase to send updates)*
4. Click **Deploy**.
5. When prompted, click **Authorize access**, select your Google account, click **Advanced**, and click **Go to Angamaly Marathon Realtime Backup (unsafe)**. Click **Allow**.
6. Copy the **Web app URL** that looks like:
   ```
   https://script.google.com/macros/s/AKfycbx.../exec
   ```

---

### Step 4: Configure Cloudflare Pages Environment Variables
1. Go to your [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**.
2. Click on your project: `angamaly-marathon`.
3. Navigate to **Settings** → **Environment variables**.
4. Click **Add variable**:
   - **Variable name**: `GOOGLE_SHEETS_WEBHOOK_URL`
   - **Value**: *(Paste your Google Apps Script Web App URL from Step 3)*
5. *(Optional Security Secret)*:
   - **Variable name**: `GOOGLE_SHEET_BACKUP_SECRET`
   - **Value**: `any-secure-random-token-of-your-choice`
6. Click **Save**.
7. Also add this to your local `.env` and `wrangler.toml` for local testing.

---

### Step 5: (Recommended) Enable Supabase Database Webhook
This ensures that even if registrations are inserted or updated directly in Supabase table editor or by third-party scripts, they automatically sync to Google Sheets!

1. Open your Supabase Dashboard: [https://asjrnktlhhnibljgotsz.supabase.co](https://asjrnktlhhnibljgotsz.supabase.co)
2. In the left navigation, click **Database** → **Webhooks** (or **Integrations** → **Database Webhooks**).
3. Click **Create a new webhook**:
   - **Name**: `backup_to_google_sheets`
   - **Table**: `public.registrations`
   - **Events**: Check both `Insert` and `Update`
   - **Type of Webhook**: `HTTP Request`
   - **HTTP Method**: `POST`
   - **URL**: `https://<your-cloudflare-pages-domain>/api/backup-to-sheet`
   - **HTTP Headers**:
     - `Content-Type`: `application/json`
     - *(If you set a secret in Step 4)*: `x-backup-secret`: `<your-secret>`
4. Click **Create Webhook**.

---

## 🧪 Testing Your Setup

### 1. Test from Apps Script Editor
In your Apps Script editor:
- Select the function **`testAppend`** from the dropdown menu at the top.
- Click **▶ Run**.
- Switch to your Google Sheet: You will see headers automatically created with professional styling and a sample runner row inserted with green/amber formatting!

### 2. Test from Admin Portal
- Open your Admin Portal: `/admin.html`.
- In the toolbar, click **📊 Google Sheet Backup**.
- Confirm the sync: all existing runners in the database will be sent and formatted into your Google Sheet!

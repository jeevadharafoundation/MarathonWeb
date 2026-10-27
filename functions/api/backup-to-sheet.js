// Cloudflare Pages Function: /api/backup-to-sheet
// Asynchronously receives Supabase Database Webhooks & Admin Sync requests,
// formats runner records, and mirrors them into Google Sheets via Google Apps Script.

export async function onRequestGet(context) {
  const { env } = context;
  const gasUrl = env.GOOGLE_SHEETS_WEBHOOK_URL;

  if (!gasUrl) {
    return new Response(JSON.stringify({
      status: "unconfigured",
      message: "GOOGLE_SHEETS_WEBHOOK_URL is not configured in Cloudflare environment variables yet."
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Ping Google Apps Script GET endpoint
  try {
    const res = await fetch(gasUrl, { redirect: "follow" });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { parsed = text; }

    return new Response(JSON.stringify({
      status: "configured",
      googleAppsScriptReachable: res.ok,
      googleResponse: parsed
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      status: "error",
      message: `Failed to reach Google Apps Script: ${err.message}`
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const gasUrl = env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!gasUrl) {
    return new Response(JSON.stringify({
      success: false,
      error: "GOOGLE_SHEETS_WEBHOOK_URL environment variable is not configured."
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 1. Security check: Webhook Secret or Admin Auth
  const expectedSecret = env.GOOGLE_SHEET_BACKUP_SECRET;
  if (expectedSecret) {
    const providedSecret = request.headers.get("x-backup-secret");
    const authHeader = request.headers.get("Authorization");
    const isSecretMatch = providedSecret && providedSecret.trim() === expectedSecret.trim();

    // If secret does not match, allow valid Supabase admin token
    let isAdminValid = false;
    if (!isSecretMatch && authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "").trim();
      const supabaseUrl = env.SUPABASE_URL || "https://asjrnktlhhnibljgotsz.supabase.co";
      const supabaseAnonKey = env.SUPABASE_ANON_KEY;
      try {
        const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${token}`
          }
        });
        if (userRes.ok) isAdminValid = true;
      } catch (_) {}
    }

    if (!isSecretMatch && !isAdminValid) {
      return new Response(JSON.stringify({
        success: false,
        error: "Unauthorized: Invalid x-backup-secret header or admin token."
      }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // 2. Parse payload
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: "Invalid JSON in request body"
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 3. Normalize Payload
  // Supabase Webhook: { type: "INSERT" | "UPDATE", table: "registrations", record: { ... }, old_record: { ... } }
  // Batch sync: { type: "SYNC_BATCH", records: [ ... ] }
  // Direct record: { reg_code: "AM27-1001", ... }
  let forwardPayload;

  if (body.type === "SYNC_BATCH" || Array.isArray(body.records)) {
    forwardPayload = {
      type: "SYNC_BATCH",
      records: body.records || []
    };
  } else if (body.record) {
    forwardPayload = {
      type: body.type || "UPSERT",
      record: body.record
    };
  } else if (body.reg_code) {
    forwardPayload = {
      type: body.type || "UPSERT",
      record: body
    };
  } else {
    return new Response(JSON.stringify({
      success: false,
      error: "Payload does not contain valid registration data or records array",
      received: body
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 4. Forward to Google Apps Script Web App
  try {
    const gasResponse = await fetch(gasUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(forwardPayload),
      redirect: "follow" // Important: Follows Google Apps Script 302 redirect
    });

    const resText = await gasResponse.text();
    let resJson;
    try {
      resJson = JSON.parse(resText);
    } catch (_) {
      resJson = { raw: resText };
    }

    return new Response(JSON.stringify({
      success: gasResponse.ok && (resJson.success !== false),
      googleStatus: gasResponse.status,
      result: resJson
    }), {
      status: gasResponse.ok ? 200 : 502,
      headers: { "Content-Type": "application/json" }
    });

  } catch (forwardErr) {
    return new Response(JSON.stringify({
      success: false,
      error: `Failed to forward backup to Google Apps Script: ${forwardErr.message}`
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// Cloudflare Pages Function: POST /api/delete-registration
// Permanently deletes a runner registration record from Supabase after strict safety confirmation

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json().catch(() => ({}));
    const { regId, confirmation } = body;

    if (!regId) {
      return new Response(JSON.stringify({ error: "Missing regId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (String(confirmation || "").trim() !== "DELETE") {
      return new Response(JSON.stringify({ error: "Invalid confirmation. You must type 'DELETE' to confirm deletion." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Verify Admin Authorization Header
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized: Missing Admin Token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
    const token = authHeader.replace("Bearer ", "").trim();

    const supabaseUrl = env.SUPABASE_URL || "https://asjrnktlhhnibljgotsz.supabase.co";
    const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseAnonKey = env.SUPABASE_ANON_KEY;

    // 1. Verify admin token with Supabase Auth
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        "apikey": supabaseAnonKey || supabaseServiceKey,
        "Authorization": `Bearer ${token}`
      }
    });

    if (!userRes.ok) {
      return new Response(JSON.stringify({ error: "Invalid admin session" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const effectiveApiKey = supabaseServiceKey || supabaseAnonKey;
    const effectiveAuthHeader = supabaseServiceKey ? `Bearer ${supabaseServiceKey}` : `Bearer ${token}`;

    if (!effectiveApiKey) {
      return new Response(JSON.stringify({ error: "Supabase API key is missing in environment variables" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 2. Fetch current registration details before deletion for audit/sync
    const regRes = await fetch(`${supabaseUrl}/rest/v1/registrations?id=eq.${regId}&select=*`, {
      headers: {
        "apikey": effectiveApiKey,
        "Authorization": effectiveAuthHeader
      }
    });

    if (!regRes.ok) {
      const errText = await regRes.text();
      return new Response(JSON.stringify({ error: `Failed to fetch registration (${regRes.status}): ${errText}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const regData = await regRes.json();
    if (!regData || regData.length === 0) {
      return new Response(JSON.stringify({ error: "Registration record not found or already deleted" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    const runner = regData[0];

    // 3. Delete from Supabase public.registrations (cascades to payment_transactions)
    const delRes = await fetch(`${supabaseUrl}/rest/v1/registrations?id=eq.${regId}`, {
      method: "DELETE",
      headers: {
        "apikey": effectiveApiKey,
        "Authorization": effectiveAuthHeader,
        "Prefer": "return=representation"
      }
    });

    if (!delRes.ok) {
      const errText = await delRes.text();
      return new Response(JSON.stringify({ error: `Supabase delete failed (${delRes.status}): ${errText}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 4. Optional Google Sheets deletion sync
    if (env.GOOGLE_SHEETS_WEBHOOK_URL) {
      const syncTask = async () => {
        try {
          await fetch(env.GOOGLE_SHEETS_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "DELETE", record: runner }),
            redirect: "follow"
          });
        } catch (_) {}
      };

      if (context && typeof context.waitUntil === "function") {
        context.waitUntil(syncTask());
      } else {
        syncTask().catch(() => {});
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        deletedId: regId,
        regCode: runner.reg_code,
        fullName: runner.full_name
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

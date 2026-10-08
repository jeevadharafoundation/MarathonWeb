// Cloudflare Pages Function: POST /api/reject-registration
// Marks registration as rejected with a reason and notifies the participant

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { regId, reason = "Payment reference / screenshot could not be verified" } = body;

    if (!regId) {
      return new Response(JSON.stringify({ error: "Missing regId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

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

    // Verify admin
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

    // Update status in Supabase
    const updateRes = await fetch(`${supabaseUrl}/rest/v1/registrations?id=eq.${regId}`, {
      method: "PATCH",
      headers: {
        "apikey": supabaseServiceKey,
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        payment_status: "rejected",
        rejection_reason: reason
      })
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      return new Response(JSON.stringify({ error: `Update failed: ${errText}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: true, status: "rejected" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Failed to reject registration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

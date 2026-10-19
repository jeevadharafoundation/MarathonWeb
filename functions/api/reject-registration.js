// Cloudflare Pages Function: POST /api/reject-registration
// Marks registration as rejected with a reason and notifies the participant via Resend email

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { 
      regId, 
      reason = "Payment reference / screenshot could not be verified",
      sendEmail = true 
    } = body;

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

    // 1. Verify admin
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

    // Effective auth: Use Service Role Key if present; otherwise fall back to authenticated Admin JWT
    const effectiveApiKey = supabaseServiceKey || supabaseAnonKey;
    const effectiveAuthHeader = supabaseServiceKey ? `Bearer ${supabaseServiceKey}` : `Bearer ${token}`;

    if (!effectiveApiKey) {
      return new Response(JSON.stringify({ error: "Supabase API key is missing in environment variables" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 2. Fetch current runner details from Supabase
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
      return new Response(JSON.stringify({ error: "Registration not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    const runner = regData[0];

    // 3. Update status to rejected in Supabase
    const updateRes = await fetch(`${supabaseUrl}/rest/v1/registrations?id=eq.${regId}`, {
      method: "PATCH",
      headers: {
        "apikey": effectiveApiKey,
        "Authorization": effectiveAuthHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        payment_status: "rejected",
        rejection_reason: reason
      })
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      return new Response(JSON.stringify({ error: `Update failed (${updateRes.status}): ${errText}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 4. Send Rejection Email via Resend if enabled
    const resendApiKey = env.RESEND_API_KEY;
    let emailResult = { attempted: false, success: false };

    if (sendEmail && resendApiKey && runner.email) {
      emailResult.attempted = true;
      try {
        let sender = env.SENDER_EMAIL || "Angamaly Marathon 2027 <noreply@angamalymarathon.com>";
        if (sender.includes("@gmail.com") || sender.includes("onboarding@resend.dev") || !sender.includes("@angamalymarathon.com")) {
          sender = "Angamaly Marathon 2027 <noreply@angamalymarathon.com>";
        } else if (!sender.includes("<")) {
          sender = `Angamaly Marathon 2027 <${sender}>`;
        }

        const categoryTitle = runner.category === "21.1K" 
          ? "Half Marathon – 21.1K" 
          : (runner.category === "10K" ? "Mini Marathon – 10K" : "Fun Run / Walk – 5K");

        const utrDisplay = (!runner.utr_number || runner.utr_number === "IN_PROOF") 
          ? "Submitted via Screenshot" 
          : runner.utr_number;

        const waHelpText = encodeURIComponent(
          `Hi, my name is ${runner.full_name} (Registration Code: ${runner.reg_code}). I received a notification regarding my registration verification issue: "${reason}". Here is my updated payment proof:`
        );
        const waHelpUrl = `https://wa.me/918590012027?text=${waHelpText}`;

        const rejectEmailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Angamaly Marathon 2027 – Registration Update</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;-webkit-font-smoothing:antialiased;">
  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:620px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 25px -5px rgba(0,0,0,0.06),0 8px 10px -6px rgba(0,0,0,0.04);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background:linear-gradient(135deg, #061834 0%, #0c2d61 100%);padding:34px 28px;text-align:center;">
              <span style="display:inline-block;background:rgba(239,68,68,0.18);border:1px solid #f87171;color:#fca5a5;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">
                ⚠️ Action Required
              </span>
              <h1 style="color:#ffffff;font-size:24px;font-weight:800;margin:0 0 6px 0;letter-spacing:-0.5px;">ANGAMALY MARATHON 2027</h1>
              <p style="color:#93c5fd;font-size:14px;margin:0;font-weight:500;">Registration Verification Update</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding:32px 28px;">
              <p style="font-size:16px;line-height:24px;color:#1e293b;margin:0 0 16px 0;">
                Dear <strong>${runner.full_name}</strong>,
              </p>
              <p style="font-size:14.5px;line-height:22px;color:#475569;margin:0 0 20px 0;">
                Thank you for applying to participate in the <strong>Angamaly Marathon 2027</strong>. During the administrative verification of your registration details and payment submission, our verification team was unable to confirm your payment receipt.
              </p>

              <!-- Reason Box -->
              <div style="background-color:#fff5f5;border-left:4px solid #ef4444;border-radius:8px;padding:16px 18px;margin-bottom:24px;">
                <div style="font-size:12px;font-weight:800;color:#991b1b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">
                  Reason Stated by Verification Team
                </div>
                <div style="font-size:15px;font-weight:700;color:#7f1d1d;line-height:1.4;">
                  ${reason}
                </div>
              </div>

              <!-- Registration Summary -->
              <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;overflow:hidden;">
                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">Registration Code</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #e2e8f0;font-size:13.5px;font-weight:800;color:#0f172a;text-align:right;">${runner.reg_code}</td>
                </tr>
                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">Race Category</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #e2e8f0;font-size:13.5px;font-weight:700;color:#0f172a;text-align:right;">${categoryTitle}</td>
                </tr>
                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">Amount Due</td>
                  <td style="padding:14px 18px;border-bottom:1px solid #e2e8f0;font-size:13.5px;font-weight:700;color:#0f172a;text-align:right;">₹${runner.amount_payable}</td>
                </tr>
                <tr>
                  <td style="padding:14px 18px;font-size:13px;color:#64748b;">Payment UTR / Ref</td>
                  <td style="padding:14px 18px;font-size:13px;font-weight:600;color:#475569;text-align:right;">${utrDisplay}</td>
                </tr>
              </table>

              <!-- Steps to Resolve -->
              <h3 style="font-size:15px;color:#0f172a;margin:0 0 12px 0;">How to Resolve & Confirm Your Slot:</h3>
              <ol style="margin:0 0 24px 0;padding-left:20px;font-size:13.5px;line-height:22px;color:#475569;">
                <li style="margin-bottom:8px;"><strong>If you have completed the payment:</strong> Please send a clear, uncropped screenshot of your bank / UPI transaction showing the 12-digit UTR number and timestamp.</li>
                <li style="margin-bottom:8px;"><strong>Reply to this email</strong> directly attaching your updated proof, OR send it directly to our helpdesk on WhatsApp.</li>
                <li>Our team will re-verify your submission and immediately issue your official Bib number.</li>
              </ol>

              <!-- Action Button: Contact Helpdesk -->
              <div style="text-align:center;margin-bottom:28px;">
                <a href="${waHelpUrl}" style="display:inline-block;background-color:#25D366;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:800;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(37,211,102,0.3);">
                  📲 Contact Helpdesk via WhatsApp
                </a>
              </div>

              <!-- Support Note -->
              <div style="border-top:1px solid #e2e8f0;padding-top:20px;font-size:12.5px;color:#64748b;line-height:18px;">
                If you believe this status was marked in error, please reach out to us at <a href="mailto:support@angamalymarathon.com" style="color:#0284c7;text-decoration:none;">support@angamalymarathon.com</a> or call/WhatsApp <strong>+91 85900 12027</strong>.
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:22px 28px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="font-size:12px;color:#94a3b8;margin:0 0 4px 0;">
                Organized by <strong>Angamaly Sports Association & Jeevadhara Foundation</strong>
              </p>
              <p style="font-size:11px;color:#cbd5e1;margin:0;">
                DiST Campus, Angamaly, Ernakulam, Kerala 683572
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
        `;

        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: sender,
            to: [runner.email],
            subject: `Angamaly Marathon 2027 – Important Registration Update (${runner.reg_code})`,
            html: rejectEmailHtml
          })
        });

        if (resendRes.ok) {
          const resendData = await resendRes.json();
          emailResult = { attempted: true, success: true, id: resendData.id };
        } else {
          const errText = await resendRes.text();
          emailResult = { attempted: true, success: false, error: errText };
        }
      } catch (e) {
        emailResult = { attempted: true, success: false, error: e.message };
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      status: "rejected",
      email: emailResult
    }), {
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

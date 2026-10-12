// Cloudflare Pages Function: POST /api/confirm-registration
// Verifies runner payment in Supabase, assigns Bib Number, and sends confirmation email via Resend

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { regId, bibNumber, sendEmail = true, adminNotes = "", groupMembers } = body;

    if (!regId) {
      return new Response(JSON.stringify({ error: "Missing regId" }), {
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

    // 1. Verify token with Supabase Auth
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

    // 2. Fetch current registration details from Supabase
    const regRes = await fetch(`${supabaseUrl}/rest/v1/registrations?id=eq.${regId}&select=*`, {
      headers: {
        "apikey": effectiveApiKey,
        "Authorization": effectiveAuthHeader
      }
    });

    if (!regRes.ok) {
      const errText = await regRes.text();
      return new Response(JSON.stringify({ error: `Failed to fetch registration record (${regRes.status}): ${errText}` }), {
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
    const finalBib = bibNumber || runner.bib_number || `BIB-${Date.now().toString().slice(-4)}`;

    // 3. Update Supabase record to verified
    const updatePayload = {
      payment_status: "verified",
      bib_number: finalBib,
      verified_at: new Date().toISOString(),
      admin_notes: adminNotes || runner.admin_notes
    };
    if (groupMembers !== undefined && groupMembers !== null) {
      updatePayload.group_members = groupMembers;
    }

    const updateRes = await fetch(`${supabaseUrl}/rest/v1/registrations?id=eq.${regId}`, {
      method: "PATCH",
      headers: {
        "apikey": effectiveApiKey,
        "Authorization": effectiveAuthHeader,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(updatePayload)
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      return new Response(JSON.stringify({ error: `Supabase update failed (${updateRes.status}): ${errText}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    let emailResult = { attempted: false, success: false };

    // 4. Send Confirmation Email via Resend if enabled
    if (sendEmail && env.RESEND_API_KEY && runner.email) {
      emailResult.attempted = true;
      try {
        const scheduleMap = {
          "21.1K": { report: "05:00 AM", flag: "05:30 AM", title: "Half Marathon – 21.1K" },
          "10K": { report: "05:30 AM", flag: "06:00 AM", title: "Mini Marathon – 10K" },
          "5K": { report: "06:00 AM", flag: "06:30 AM", title: "Fun Run / Walk – 5K" }
        };
        const raceInfo = scheduleMap[runner.category] || scheduleMap["5K"];

        // Determine Sender Email (Avoid raw @gmail.com since Resend requires verified custom domains)
        let sender = env.SENDER_EMAIL || "onboarding@resend.dev";
        if (sender.includes("@gmail.com")) {
          sender = "Angamaly Marathon 2027 <onboarding@resend.dev>";
        } else if (!sender.includes("<")) {
          sender = `Angamaly Marathon 2027 <${sender}>`;
        }

        const effectiveMembers = groupMembers || runner.group_members;
        let membersArray = [];
        if (effectiveMembers) {
          try {
            membersArray = typeof effectiveMembers === "string" ? JSON.parse(effectiveMembers) : effectiveMembers;
          } catch(e) { membersArray = []; }
        }

        let groupEmailHtml = "";
        if (runner.fee_type === "student_group" || (Array.isArray(membersArray) && membersArray.length > 0)) {
          let rowsHtml = `
            <tr style="background:#f1f5f9;font-weight:700;">
              <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e2e8f0;">Student #1 (Leader): ${runner.full_name}</td>
              <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #e2e8f0;text-align:right;">Bib: <strong>${finalBib}</strong> (Size: ${runner.shirt_size})</td>
            </tr>
          `;
          membersArray.forEach((m, idx) => {
            rowsHtml += `
              <tr style="border-bottom:1px solid #edf2f9;">
                <td style="padding:8px 12px;font-size:13px;">Student #${m.member_index || (idx + 2)}: ${m.name || 'Member'}</td>
                <td style="padding:8px 12px;font-size:13px;text-align:right;">Bib: <strong>${m.bib_number || 'Assigned'}</strong> (Size: ${m.shirt_size || 'M'})</td>
              </tr>
            `;
          });

          groupEmailHtml = `
            <div style="margin:20px 0;background:#f8fbff;border:1.5px solid #c7d2fe;border-radius:12px;padding:16px;">
              <strong style="color:#062e68;font-size:14px;">👥 Student Group Roster (All 5 Runners)</strong>
              <table style="width:100%;margin-top:10px;border-collapse:collapse;">
                ${rowsHtml}
              </table>
              <p style="margin:10px 0 0;font-size:12px;color:#60708a;line-height:1.4;">
                📌 <em>Notice: Student #1 ID proof was submitted online. The remaining 4 students must carry their physical student ID cards when collecting their race kits and bibs.</em>
              </p>
            </div>
          `;
        }

        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f8fd; margin: 0; padding: 24px; color: #0c1b33; }
  .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 18px; overflow: hidden; border: 1px solid #dde6f1; box-shadow: 0 10px 30px rgba(19,47,92,0.08); }
  .header { background: #062e68; padding: 32px 24px; text-align: center; color: #ffffff; }
  .header h1 { margin: 0; font-size: 26px; letter-spacing: -0.5px; }
  .header h1 span { color: #e41f2b; }
  .header p { margin: 8px 0 0; color: #cbd9ef; font-size: 14px; }
  .content { padding: 32px 28px; }
  .badge-box { background: #eaf4ff; border: 2px dashed #0b66c3; border-radius: 14px; padding: 20px; text-align: center; margin: 24px 0; }
  .bib-label { font-size: 13px; text-transform: uppercase; color: #0b66c3; font-weight: 800; letter-spacing: 1px; }
  .bib-val { font-size: 42px; font-weight: 900; color: #062e68; margin: 6px 0; }
  .reg-code { font-size: 14px; color: #60708a; }
  .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  .details-table td { padding: 12px 14px; border-bottom: 1px solid #edf2f9; font-size: 14px; }
  .details-table td:first-child { color: #60708a; font-weight: 600; width: 40%; }
  .details-table td:last-child { color: #0c1b33; font-weight: 800; }
  .notice-box { background: #fff9df; border-left: 4px solid #ffd523; padding: 16px; border-radius: 10px; margin: 24px 0; font-size: 13.5px; line-height: 1.5; }
  .footer { background: #031f48; padding: 24px; text-align: center; font-size: 12.5px; color: #a1b4d0; }
  .footer strong { color: #ffffff; }
</style>
</head>
<body>
<div class="email-container">
  <div class="header">
    <h1>ANGAMALY <span>MARATHON ’27</span></h1>
    <p>3rd Edition • Sunday, 17 January 2027 • DiST, Angamaly</p>
  </div>
  <div class="content">
    <h2 style="margin-top:0; color:#062e68;">Registration Confirmed! 🎉</h2>
    <p>Dear <strong>${runner.full_name}</strong>,</p>
    <p>Congratulations! Your registration and payment for <strong>Angamaly Marathon 2027</strong> have been verified and approved.</p>

    <div class="badge-box">
      <div class="bib-label">Your Official Bib Number</div>
      <div class="bib-val">${finalBib}</div>
      <div class="reg-code">Registration Reference: <strong>${runner.reg_code}</strong></div>
    </div>

    <table class="details-table">
      <tr><td>Registration Type</td><td>${
        runner.fee_type === 'student_group'
          ? 'Group of Students (5 Nos)'
          : (runner.fee_type === 'student_early'
            ? 'Early Bird Student Registration'
            : (runner.fee_type === 'student' ? 'Normal Student Registration' : (runner.fee_type === 'early' ? 'Early Bird Registration' : 'Regular Registration')))
      }</td></tr>
      <tr><td>Event Date</td><td>Sunday, 17 January 2027</td></tr>
      <tr><td>Reporting Time</td><td>${raceInfo.report}</td></tr>
      <tr><td>Flag Off Time</td><td>${raceInfo.flag}</td></tr>
      <tr><td>Venue</td><td>De Paul Institute of Science & Technology (DiST), Angamaly</td></tr>
      <tr><td>Payment UTR / Reference</td><td>${(runner.utr_number && runner.utr_number !== 'IN_PROOF') ? runner.utr_number : 'Verified via Screenshot'}</td></tr>
      <tr><td>Status</td><td><span style="color:#169447; font-weight:900;">Verified & Confirmed</span></td></tr>
    </table>

    ${groupEmailHtml}

    <div class="notice-box">
      <strong>Bib & T-Shirt Kit Distribution:</strong><br>
      📅 <strong>Saturday, 16 January 2027</strong> | 10:00 AM – 6:00 PM<br>
      📍 De Paul Institute of Science & Technology, Angamaly<br>
      <em>Please present this confirmation email and a valid photo ID while collecting your race kit.</em>
    </div>

    <p style="font-size:14px; color:#495c77;">For any queries or assistance, contact our event coordinators:</p>
    <ul style="font-size:13.5px; color:#495c77; padding-left:20px; line-height:1.6;">
      <li>Ms. Ann Maria G. — 9447822320</li>
      <li>Mr. Shonn J Kuruvilla — 9605769677</li>
      <li>Mr. Riju Pappachan (Race Director) — 9495810646</li>
    </ul>

    <p style="margin-top:24px;">See you at the starting line!<br><strong>Team Angamaly Marathon 2027</strong><br><em>Run for Health • Run for Hope</em></p>
  </div>
  <div class="footer">
    <strong>Angamaly Sports Association & Jeevadhara Foundation</strong><br>
    De Paul Institute of Science & Technology, Angamaly, Ernakulam, Kerala<br>
    Email: jeevadharafoundation2012@gmail.com
  </div>
</div>
</body>
</html>
        `;

        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: sender,
            to: [runner.email],
            reply_to: env.ORGANIZER_EMAIL || "jeevadharafoundation2012@gmail.com",
            subject: `Registration Confirmed! Angamaly Marathon 2027 (Bib: ${finalBib})`,
            html: emailHtml
          })
        });

        const resendJson = await resendRes.json().catch(() => ({}));
        if (resendRes.ok) {
          emailResult.success = true;
          emailResult.id = resendJson.id;

          // Record email status in Supabase
          await fetch(`${supabaseUrl}/rest/v1/registrations?id=eq.${regId}`, {
            method: "PATCH",
            headers: {
              "apikey": effectiveApiKey,
              "Authorization": effectiveAuthHeader,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              email_sent: true,
              email_sent_at: new Date().toISOString()
            })
          });
        } else {
          emailResult.success = false;
          emailResult.statusCode = resendRes.status;
          emailResult.error = resendJson.message || resendJson.error || "Resend email delivery skipped / domain unverified";
        }
      } catch (mailErr) {
        emailResult.success = false;
        emailResult.error = mailErr.message;
      }
    } else if (!env.RESEND_API_KEY) {
      emailResult = { attempted: false, success: false, reason: "RESEND_API_KEY not configured" };
    }

    return new Response(JSON.stringify({
      success: true,
      bibNumber: finalBib,
      runner: {
        id: runner.id,
        full_name: runner.full_name,
        phone: runner.phone,
        reg_code: runner.reg_code,
        category: runner.category,
        amount_payable: runner.amount_payable
      },
      email: emailResult
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Failed to confirm registration" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

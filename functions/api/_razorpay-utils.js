// Shared Server-Side Utilities for Razorpay Payment Gateway Integration
// Runs in Cloudflare Pages Functions (Web Crypto + Fetch runtime)

const PRICES_INR = {
  regular: { "21.1K": 750, "10K": 600, "5K": 350 },
  early: { "21.1K": 700, "10K": 550, "5K": 300 },
  student_per_head: 200
};

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

export function getSupabaseConfig(env) {
  const supabaseUrl = (env.SUPABASE_URL || "https://asjrnktlhhnibljgotsz.supabase.co").replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.SUPABASE_ANON_KEY;
  const apiKey = serviceKey || anonKey;
  if (!apiKey) {
    throw new Error("Server configuration error: Missing Supabase API key");
  }
  return {
    supabaseUrl,
    apiKey,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  };
}

/**
 * Fetches live early_bird_deadline from Supabase event_settings and computes authoritative price in INR & paise.
 * Supports both async `(env, category, requestedFeeType, groupMembers)` and synchronous object `({ category, feeType, groupMembers, earlyBirdDeadline, now })`.
 * Never trusts client-supplied amounts.
 */
export async function calculateServerFee(envOrOpts, categoryArg, requestedFeeTypeArg, groupMembersArg) {
  const isOptionsObj =
    envOrOpts &&
    typeof envOrOpts === "object" &&
    ("category" in envOrOpts || "feeType" in envOrOpts) &&
    categoryArg === undefined;

  const category = isOptionsObj ? envOrOpts.category : categoryArg;
  const requestedFeeType = isOptionsObj ? (envOrOpts.feeType || envOrOpts.requestedFeeType) : requestedFeeTypeArg;
  const groupMembers = isOptionsObj ? envOrOpts.groupMembers : groupMembersArg;

  const validCategories = ["21.1K", "10K", "5K"];
  if (!validCategories.includes(category)) {
    if (isOptionsObj) {
      return { valid: false, error: `Invalid race category: ${category}` };
    }
    throw new Error(`Invalid race category: ${category}`);
  }

  let earlyBirdDeadline = isOptionsObj && envOrOpts.earlyBirdDeadline
    ? new Date(envOrOpts.earlyBirdDeadline)
    : new Date("2027-01-05T18:00:00+05:30");

  if (!isOptionsObj && envOrOpts) {
    try {
      const sb = getSupabaseConfig(envOrOpts);
      const res = await fetch(`${sb.supabaseUrl}/rest/v1/event_settings?key=eq.event_info&select=value`, {
        headers: sb.headers
      });
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows[0]?.value?.early_bird_deadline) {
          const parsed = new Date(rows[0].value.early_bird_deadline);
          if (!isNaN(parsed.getTime())) {
            earlyBirdDeadline = parsed;
          }
        }
      }
    } catch (_) {
      // Fallback to default deadline if settings read fails
    }
  }

  const nowDate = isOptionsObj && envOrOpts.now ? new Date(envOrOpts.now) : new Date();
  const isEarlyBird = nowDate < earlyBirdDeadline;

  if (requestedFeeType === "student_group") {
    const membersArr = Array.isArray(groupMembers) ? groupMembers : [];
    const totalStudents = 1 + membersArr.length;
    if (totalStudents < 5) {
      const errMsg = "Student Group registration requires a minimum of 5 students (Team Leader + at least 4 members).";
      if (isOptionsObj) {
        return { valid: false, error: errMsg };
      }
      throw new Error(errMsg);
    }
    const amountInr = totalStudents * PRICES_INR.student_per_head;
    return {
      valid: true,
      effectiveFeeType: "student_group",
      amountInr,
      amountRupees: amountInr,
      amountPaise: amountInr * 100,
      totalStudents,
      isEarlyBird
    };
  }

  const effectiveFeeType = isEarlyBird ? "early" : "regular";
  const amountInr = PRICES_INR[effectiveFeeType][category];
  if (!amountInr || amountInr <= 0) {
    const errMsg = "Unable to determine valid registration fee for selected category.";
    if (isOptionsObj) {
      return { valid: false, error: errMsg };
    }
    throw new Error(errMsg);
  }

  return {
    valid: true,
    effectiveFeeType,
    amountInr,
    amountRupees: amountInr,
    amountPaise: amountInr * 100,
    totalStudents: 1,
    isEarlyBird
  };
}

/**
 * Computes HMAC-SHA256 hex digest using Web Crypto API
 */
export async function computeHmacSha256Hex(message, secret) {
  if (!secret || typeof message !== "string") {
    throw new Error("Missing secret or message for HMAC-SHA256");
  }
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time HMAC-SHA256 signature verification to prevent timing side-channel attacks
 */
export async function verifyHmacSha256(message, providedSignatureHex, secret) {
  if (!providedSignatureHex || typeof providedSignatureHex !== "string" || !secret) {
    return false;
  }
  const expectedHex = await computeHmacSha256Hex(message, secret);
  const cleanProvided = providedSignatureHex.trim().toLowerCase();
  const cleanExpected = expectedHex.trim().toLowerCase();

  if (cleanProvided.length !== cleanExpected.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < cleanExpected.length; i++) {
    diff |= cleanExpected.charCodeAt(i) ^ cleanProvided.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Calls Razorpay Official v1 REST API with Basic Auth and timeout protection
 */
export async function razorpayRequest(env, path, { method = "GET", body = null, headers = {} } = {}) {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured on the server.");
  }

  const credentials = btoa(`${keyId.trim()}:${keySecret.trim()}`);
  const url = `https://api.razorpay.com/v1${path.startsWith("/") ? path : "/" + path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const fetchOpts = {
      method,
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        ...headers
      },
      signal: controller.signal
    };
    if (body !== null) {
      fetchOpts.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const res = await fetch(url, fetchOpts);
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { raw: text };
    }

    if (!res.ok) {
      const errDesc = data?.error?.description || data?.error?.reason || `Razorpay API HTTP ${res.status}`;
      return {
        ok: false,
        status: res.status,
        data,
        error: errDesc,
        errorCode: data?.error?.code || "GATEWAY_ERROR"
      };
    }

    return { ok: true, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export function formatPaymentMethodDetail(payment) {
  if (!payment || typeof payment !== "object") return "razorpay";
  const m = payment.method || "razorpay";
  if (m === "upi" && payment.vpa) return `upi (${payment.vpa})`;
  if (m === "card" && payment.card?.last4) return `card (${payment.card.network || "Card"} ****${payment.card.last4})`;
  if (m === "netbanking" && payment.bank) return `netbanking (${payment.bank})`;
  if (m === "wallet" && payment.wallet) return `wallet (${payment.wallet})`;
  return m;
}

export function extractBankUtr(payment) {
  if (!payment || typeof payment !== "object") return "";
  const acq = payment.acquirer_data || {};
  return String(
    acq.rrn ||
    acq.upi_transaction_id ||
    acq.bank_transaction_id ||
    acq.auth_code ||
    payment.id ||
    ""
  ).trim();
}

/**
 * Writes an immutable audit entry into public.payment_transactions
 */
export async function logPaymentTransaction(env, {
  registrationId = null,
  regCode = null,
  razorpayOrderId = null,
  razorpayPaymentId = null,
  eventType,
  status,
  amountPaise = null,
  currency = "INR",
  paymentMethod = null,
  errorCode = null,
  errorDescription = null,
  rawPayload = null
}) {
  try {
    const sb = getSupabaseConfig(env);
    await fetch(`${sb.supabaseUrl}/rest/v1/payment_transactions`, {
      method: "POST",
      headers: sb.headers,
      body: JSON.stringify({
        registration_id: registrationId,
        reg_code: regCode,
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId,
        event_type: eventType,
        status,
        amount_paise: amountPaise,
        currency,
        payment_method: paymentMethod,
        error_code: errorCode,
        error_description: errorDescription,
        raw_payload: rawPayload
      })
    });
  } catch (err) {
    console.warn("Audit log write warning:", err.message);
  }
}

/**
 * Atomically activates a registration via confirm_razorpay_payment RPC,
 * assigns official Bib number(s) once, sends Resend confirmation email, and syncs to Google Sheets.
 */
export async function finalizeCapturedPayment(context, env, regId, paymentObj, razorpaySignature = null) {
  const sb = getSupabaseConfig(env);
  const orderId = paymentObj?.order_id || null;
  const paymentId = paymentObj?.id || null;
  const amountPaise = Number(paymentObj?.amount || 0);
  const methodDetail = formatPaymentMethodDetail(paymentObj);
  const bankUtr = extractBankUtr(paymentObj) || paymentId;

  const rpcRes = await fetch(`${sb.supabaseUrl}/rest/v1/rpc/confirm_razorpay_payment`, {
    method: "POST",
    headers: sb.headers,
    body: JSON.stringify({
      p_reg_id: regId,
      p_razorpay_order_id: orderId,
      p_razorpay_payment_id: paymentId,
      p_razorpay_signature: razorpaySignature,
      p_amount_paid_paise: amountPaise,
      p_payment_method_detail: methodDetail,
      p_utr_number: bankUtr
    })
  });

  if (!rpcRes.ok) {
    const errText = await rpcRes.text();
    throw new Error(`Atomic payment confirmation failed (${rpcRes.status}): ${errText}`);
  }

  const rpcData = await rpcRes.json();
  const updatedRecord = rpcData.record || {};
  const alreadyVerified = Boolean(rpcData.already_verified);

  await logPaymentTransaction(env, {
    registrationId: regId,
    regCode: updatedRecord.reg_code || rpcData.reg_code,
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    eventType: alreadyVerified ? "payment.captured.idempotent" : "payment.captured.confirmed",
    status: "captured",
    amountPaise,
    currency: paymentObj?.currency || "INR",
    paymentMethod: methodDetail,
    rawPayload: {
      payment_id: paymentId,
      order_id: orderId,
      method: paymentObj?.method,
      status: paymentObj?.status,
      utr: bankUtr,
      bib_number: rpcData.bib_number
    }
  });

  // Dispatch Confirmation Email & Google Sheets sync if not yet sent
  const shouldSendEmail = !updatedRecord.email_sent && Boolean(env.RESEND_API_KEY) && Boolean(updatedRecord.email);

  const backgroundTask = async () => {
    if (shouldSendEmail) {
      await sendConfirmationEmail(env, sb, updatedRecord);
    }
    if (env.GOOGLE_SHEETS_WEBHOOK_URL) {
      try {
        await fetch(env.GOOGLE_SHEETS_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "UPSERT", record: updatedRecord }),
          redirect: "follow"
        });
      } catch (_) {}
    }
  };

  if (context && typeof context.waitUntil === "function") {
    context.waitUntil(backgroundTask());
  } else {
    await backgroundTask();
  }

  return {
    alreadyVerified,
    bibNumber: rpcData.bib_number || updatedRecord.bib_number,
    regCode: rpcData.reg_code || updatedRecord.reg_code,
    record: updatedRecord
  };
}

async function sendConfirmationEmail(env, sb, runner) {
  try {
    const resendApiKey = env.RESEND_API_KEY;
    if (!resendApiKey || !runner?.email) return;

    let sender = env.SENDER_EMAIL || "Angamaly Marathon 2027 <noreply@angamalymarathon.com>";
    if (sender.includes("@gmail.com") || sender.includes("onboarding@resend.dev") || !sender.includes("@angamalymarathon.com")) {
      sender = "Angamaly Marathon 2027 <noreply@angamalymarathon.com>";
    } else if (!sender.includes("<")) {
      sender = `Angamaly Marathon 2027 <${sender}>`;
    }

    const categoryDetails = {
      "21.1K": { title: "Half Marathon – 21.1KM", report: "05:00 AM", flag: "05:30 AM" },
      "10K": { title: "Mini Marathon – 10KM", report: "05:30 AM", flag: "06:00 AM" },
      "5K": { title: "Fun Run / Walk – 5KM", report: "06:00 AM", flag: "06:30 AM" }
    };
    const raceInfo = categoryDetails[runner.category] || { title: runner.category, report: "05:30 AM", flag: "06:00 AM" };

    let membersArray = runner.group_members;
    if (typeof membersArray === "string") {
      try { membersArray = JSON.parse(membersArray); } catch (_) { membersArray = []; }
    }

    let groupEmailHtml = "";
    if (runner.fee_type === "student_group" && Array.isArray(membersArray) && membersArray.length > 0) {
      let rowsHtml = `
        <tr style="border-bottom:1px solid #edf2f9;">
          <td style="padding:8px 12px;font-weight:700;color:#062e68;font-size:13px;">Student #1 (Leader): ${runner.full_name}</td>
          <td style="padding:8px 12px;font-size:13px;text-align:right;">Bib: <strong>${runner.bib_number}</strong> (Size: ${runner.shirt_size})</td>
        </tr>
      `;
      membersArray.forEach((m, idx) => {
        rowsHtml += `
          <tr style="border-bottom:1px solid #edf2f9;">
            <td style="padding:8px 12px;font-size:13px;">Student #${m.member_index || (idx + 2)}: ${m.name || "Member"}</td>
            <td style="padding:8px 12px;font-size:13px;text-align:right;">Bib: <strong>${m.bib_number || "Assigned"}</strong> (Size: ${m.shirt_size || "M"})</td>
          </tr>
        `;
      });

      groupEmailHtml = `
        <div style="margin:20px 0;background:#f8fbff;border:1.5px solid #c7d2fe;border-radius:12px;padding:16px;">
          <strong style="color:#062e68;font-size:14px;">👥 Student Group Roster (All ${1 + membersArray.length} Runners)</strong>
          <table style="width:100%;margin-top:10px;border-collapse:collapse;">
            ${rowsHtml}
          </table>
          <p style="margin:10px 0 0;font-size:12px;color:#60708a;line-height:1.4;">
            📌 <em>Notice: Student #1 ID proof was submitted online. The remaining ${membersArray.length} students must carry their physical student ID cards when collecting their race kits and bibs.</em>
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
    <h2 style="margin-top:0; color:#062e68;">Registration & Payment Confirmed! 🎉</h2>
    <p>Dear <strong>${runner.full_name}</strong>,</p>
    <p>Thank you for registering! Your payment for <strong>Angamaly Marathon 2027</strong> has been verified via Razorpay and your official Bib number is assigned below.</p>

    <div class="badge-box">
      <div class="bib-label">Your Official Bib Number</div>
      <div class="bib-val">${runner.bib_number}</div>
      <div class="reg-code">Registration Reference: <strong>${runner.reg_code}</strong></div>
    </div>

    <table class="details-table">
      <tr><td>Race Category</td><td>${raceInfo.title}</td></tr>
      <tr><td>Registration Type</td><td>${
        runner.fee_type === "student_group"
          ? `Group of Students (${1 + (Array.isArray(membersArray) ? membersArray.length : 0)} Students)`
          : (runner.fee_type === "early" ? "Early Bird Registration" : "Regular Registration")
      }</td></tr>
      <tr><td>T-Shirt Size</td><td>${runner.shirt_size || "Standard"}</td></tr>
      <tr><td>Amount Paid</td><td>₹${runner.amount_payable}</td></tr>
      <tr><td>Razorpay Payment ID</td><td>${runner.razorpay_payment_id || "—"}</td></tr>
      <tr><td>Bank Ref / UTR</td><td>${runner.utr_number || runner.razorpay_payment_id || "Verified"}</td></tr>
      <tr><td>Event Date</td><td>Sunday, 17 January 2027</td></tr>
      <tr><td>Reporting Time</td><td>${raceInfo.report}</td></tr>
      <tr><td>Flag Off Time</td><td>${raceInfo.flag}</td></tr>
      <tr><td>Venue</td><td>De Paul Institute of Science & Technology (DiST), Angamaly</td></tr>
      <tr><td>Status</td><td><span style="color:#169447; font-weight:900;">Verified & Confirmed</span></td></tr>
    </table>

    ${groupEmailHtml}

    <div class="notice-box">
      <strong>Bib & T-Shirt Kit Distribution:</strong><br>
      📅 <strong>Saturday, 16 January 2027</strong> | 10:00 AM – 6:00 PM<br>
      📍 De Paul Institute of Science & Technology, Angamaly<br>
      <em>Please present this confirmation email and a valid photo ID while collecting your race kit.</em>
    </div>

    <p style="margin-top:24px;">See you at the starting line!<br><strong>Team Angamaly Marathon 2027</strong><br><em>Run for Health • Run for Hope</em></p>
  </div>
  <div class="footer">
    <strong>Angamaly Sports Association & Jeevadhara Foundation</strong><br>
    De Paul Institute of Science & Technology, Angamaly, Ernakulam, Kerala<br>
    Email: jeevadharafoundation2012@gmail.com
  </div>
</div>
</body>
</html>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: sender,
        to: [runner.email],
        reply_to: env.ORGANIZER_EMAIL || "jeevadharafoundation2012@gmail.com",
        subject: `Registration Confirmed! Angamaly Marathon 2027 (Bib: ${runner.bib_number})`,
        html: emailHtml
      })
    });

    if (resendRes.ok) {
      await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${runner.id}`, {
        method: "PATCH",
        headers: sb.headers,
        body: JSON.stringify({
          email_sent: true,
          email_sent_at: new Date().toISOString()
        })
      });
    }
  } catch (err) {
    console.warn("Confirmation email error:", err.message);
  }
}

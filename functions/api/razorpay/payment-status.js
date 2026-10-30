// Cloudflare Pages Function: GET & POST /api/razorpay/payment-status
// Reconciles registration payment status directly with Razorpay's server APIs.
// Recovers interrupted checkouts, pending UPI transactions, and delayed webhooks.

import {
  jsonResponse,
  getSupabaseConfig,
  razorpayRequest,
  logPaymentTransaction,
  finalizeCapturedPayment
} from "../_razorpay-utils.js";

async function reconcileSingleRegistration(context, env, sb, reg, clientEvent = null) {
  if (!reg) return null;

  // If already verified with a Bib number, return immediately
  if (reg.payment_status === "verified" && reg.bib_number) {
    return {
      verified: true,
      status: "captured",
      gateway_status: "captured",
      regId: reg.id,
      reg_id: reg.id,
      regCode: reg.reg_code,
      reg_code: reg.reg_code,
      bibNumber: reg.bib_number,
      bib_number: reg.bib_number,
      razorpay_order_id: reg.razorpay_order_id,
      razorpay_payment_id: reg.razorpay_payment_id,
      registration: reg,
      record: reg
    };
  }

  const orderId = reg.razorpay_order_id;
  if (!orderId) {
    return {
      verified: false,
      status: reg.gateway_status || "created",
      gateway_status: reg.gateway_status || "created",
      regId: reg.id,
      reg_id: reg.id,
      regCode: reg.reg_code,
      reg_code: reg.reg_code,
      registration: reg,
      record: reg
    };
  }

  const expectedPaise = Math.round(Number(reg.amount_payable) * 100);

  // Query Razorpay Order Payments API to inspect all payment attempts on this order
  const paymentsRes = await razorpayRequest(env, `/orders/${encodeURIComponent(orderId)}/payments`);
  if (!paymentsRes.ok || !Array.isArray(paymentsRes.data?.items)) {
    // Uncertain gateway state due to network/API error -> keep pending verification, never mark failed
    return {
      verified: false,
      status: "pending",
      gateway_status: reg.gateway_status || "pending",
      regId: reg.id,
      reg_id: reg.id,
      regCode: reg.reg_code,
      reg_code: reg.reg_code,
      razorpay_order_id: orderId,
      registration: reg,
      record: reg,
      message: "Payment verification in progress. Checking with bank..."
    };
  }

  const items = paymentsRes.data.items;

  // 1. Check if any payment attempt is 'captured'
  const capturedPayment = items.find((p) => p.status === "captured" && p.currency === "INR" && Number(p.amount) >= expectedPaise);
  if (capturedPayment) {
    const finalized = await finalizeCapturedPayment(context, env, reg.id, capturedPayment, null);
    return {
      verified: true,
      status: "captured",
      gateway_status: "captured",
      regId: reg.id,
      reg_id: reg.id,
      regCode: finalized.regCode,
      reg_code: finalized.regCode,
      bibNumber: finalized.bibNumber,
      bib_number: finalized.bibNumber,
      razorpay_order_id: orderId,
      razorpay_payment_id: capturedPayment.id,
      registration: finalized.record,
      record: finalized.record
    };
  }

  // 2. Check if any payment attempt is 'authorized' (and attempt auto-capture)
  const authorizedPayment = items.find((p) => p.status === "authorized" && p.currency === "INR" && Number(p.amount) >= expectedPaise);
  if (authorizedPayment) {
    const capRes = await razorpayRequest(env, `/payments/${encodeURIComponent(authorizedPayment.id)}/capture`, {
      method: "POST",
      body: { amount: expectedPaise, currency: "INR" }
    });
    if (capRes.ok && capRes.data?.status === "captured") {
      const finalized = await finalizeCapturedPayment(context, env, reg.id, capRes.data, null);
      return {
        verified: true,
        status: "captured",
        gateway_status: "captured",
        regId: reg.id,
        reg_id: reg.id,
        regCode: finalized.regCode,
        reg_code: finalized.regCode,
        bibNumber: finalized.bibNumber,
        bib_number: finalized.bibNumber,
        razorpay_order_id: orderId,
        razorpay_payment_id: capRes.data.id,
        registration: finalized.record,
        record: finalized.record
      };
    }

    if (reg.gateway_status !== "authorized") {
      await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${reg.id}&payment_status=neq.verified`, {
        method: "PATCH",
        headers: sb.headers,
        body: JSON.stringify({
          razorpay_payment_id: authorizedPayment.id,
          gateway_status: "authorized",
          updated_at: new Date().toISOString()
        })
      });
    }

    return {
      verified: false,
      status: "pending",
      gateway_status: "authorized",
      reg_id: reg.id,
      reg_code: reg.reg_code,
      razorpay_order_id: orderId,
      razorpay_payment_id: authorizedPayment.id,
      message: "Payment is authorized by your bank and awaiting final capture confirmation."
    };
  }

  // 3. Check if any payment attempt is 'created' / 'pending' (e.g. UPI collect/intent in flight)
  const pendingPayment = items.find((p) => p.status === "created" || p.status === "pending");
  if (pendingPayment) {
    return {
      verified: false,
      status: "pending",
      gateway_status: "pending",
      reg_id: reg.id,
      reg_code: reg.reg_code,
      razorpay_order_id: orderId,
      razorpay_payment_id: pendingPayment.id,
      message: "UPI / Bank payment request is still in progress."
    };
  }

  // 4. Check if all attempts on this order failed
  const latestFailed = items.find((p) => p.status === "failed");
  if (latestFailed) {
    if (reg.gateway_status !== "failed") {
      await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${reg.id}&payment_status=neq.verified`, {
        method: "PATCH",
        headers: sb.headers,
        body: JSON.stringify({
          gateway_status: "failed",
          last_payment_error: {
            code: latestFailed.error_code,
            description: latestFailed.error_description,
            reason: latestFailed.error_reason
          },
          updated_at: new Date().toISOString()
        })
      });
    }
    return {
      verified: false,
      status: "failed",
      gateway_status: "failed",
      reg_id: reg.id,
      reg_code: reg.reg_code,
      razorpay_order_id: orderId,
      error: latestFailed.error_description || "Payment attempt failed."
    };
  }

  // 5. No payment attempts recorded on Razorpay yet (Order is still 'created' or customer dismissed modal)
  if (clientEvent === "cancelled" && reg.gateway_status === "created") {
    await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${reg.id}&payment_status=neq.verified`, {
      method: "PATCH",
      headers: sb.headers,
      body: JSON.stringify({
        gateway_status: "cancelled",
        updated_at: new Date().toISOString()
      })
    });
    await logPaymentTransaction(env, {
      registrationId: reg.id,
      regCode: reg.reg_code,
      razorpayOrderId: orderId,
      eventType: "client.checkout_cancelled",
      status: "cancelled"
    });
    return {
      verified: false,
      status: "cancelled",
      gateway_status: "cancelled",
      reg_id: reg.id,
      reg_code: reg.reg_code,
      razorpay_order_id: orderId
    };
  }

  return {
    verified: false,
    status: reg.gateway_status || "created",
    gateway_status: reg.gateway_status || "created",
    reg_id: reg.id,
    reg_code: reg.reg_code,
    razorpay_order_id: orderId
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);
    const regId = url.searchParams.get("reg_id");
    const regCode = url.searchParams.get("code");
    const orderId = url.searchParams.get("order_id");

    if (!regId && !regCode && !orderId) {
      return jsonResponse({ error: "Missing reg_id, code, or order_id query parameter." }, 400);
    }

    const sb = getSupabaseConfig(env);
    let queryFilter = "";
    if (regId && /^[0-9a-f-]{36}$/i.test(regId)) {
      queryFilter = `id=eq.${encodeURIComponent(regId)}`;
    } else if (orderId) {
      queryFilter = `razorpay_order_id=eq.${encodeURIComponent(orderId)}`;
    } else if (regCode) {
      queryFilter = `reg_code=eq.${encodeURIComponent(regCode)}`;
    } else {
      return jsonResponse({ error: "Invalid identifier format." }, 400);
    }

    const r = await fetch(`${sb.supabaseUrl}/rest/v1/registrations?${queryFilter}&select=*`, {
      headers: sb.headers
    });
    if (!r.ok) {
      return jsonResponse({ error: "Failed to lookup registration." }, 500);
    }

    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonResponse({ error: "Registration not found." }, 404);
    }

    const result = await reconcileSingleRegistration(context, env, sb, rows[0], null);
    return jsonResponse(result, 200);
  } catch (err) {
    return jsonResponse({ error: err.message || "Error checking payment status." }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    let body = {};
    try {
      body = await request.json();
    } catch (_) {}

    const sb = getSupabaseConfig(env);

    // Mode A: Admin Batch Reconciliation of Pending Razorpay Orders
    if (body.action === "reconcile_all_pending") {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return jsonResponse({ error: "Unauthorized: Admin token required for batch reconciliation." }, 401);
      }
      const token = authHeader.replace("Bearer ", "").trim();
      const userRes = await fetch(`${sb.supabaseUrl}/auth/v1/user`, {
        headers: {
          apikey: env.SUPABASE_ANON_KEY || sb.apiKey,
          Authorization: `Bearer ${token}`
        }
      });
      if (!userRes.ok) {
        return jsonResponse({ error: "Invalid admin session." }, 401);
      }

      const pendingRes = await fetch(
        `${sb.supabaseUrl}/rest/v1/registrations?payment_status=eq.pending&razorpay_order_id=not.is.null&order=created_at.desc&limit=50&select=*`,
        { headers: sb.headers }
      );
      if (!pendingRes.ok) {
        return jsonResponse({ error: "Failed to fetch pending orders." }, 500);
      }

      const pendingList = await pendingRes.json();
      let newlyVerifiedCount = 0;
      const results = [];

      for (const reg of pendingList) {
        const res = await reconcileSingleRegistration(context, env, sb, reg, null);
        if (res?.verified) newlyVerifiedCount++;
        results.push({
          reg_code: reg.reg_code,
          status: res?.status,
          bib_number: res?.bib_number || null
        });
      }

      return jsonResponse({
        success: true,
        checked: pendingList.length,
        newlyVerified: newlyVerifiedCount,
        newly_verified: newlyVerifiedCount,
        stillPending: pendingList.length - newlyVerifiedCount,
        results
      });
    }

    // Mode B: Single Registration Reconciliation or Client Event Reporting
    const regId = body.reg_id ? String(body.reg_id).trim() : null;
    const orderId = body.order_id ? String(body.order_id).trim() : null;
    const regCode = body.code ? String(body.code).trim() : null;
    const clientEvent = body.client_event ? String(body.client_event).trim() : null;

    let queryFilter = "";
    if (regId && /^[0-9a-f-]{36}$/i.test(regId)) {
      queryFilter = `id=eq.${encodeURIComponent(regId)}`;
    } else if (orderId) {
      queryFilter = `razorpay_order_id=eq.${encodeURIComponent(orderId)}`;
    } else if (regCode) {
      queryFilter = `reg_code=eq.${encodeURIComponent(regCode)}`;
    } else {
      return jsonResponse({ error: "Missing reg_id, order_id, or code." }, 400);
    }

    const r = await fetch(`${sb.supabaseUrl}/rest/v1/registrations?${queryFilter}&select=*`, {
      headers: sb.headers
    });
    if (!r.ok) {
      return jsonResponse({ error: "Failed to lookup registration." }, 500);
    }

    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonResponse({ error: "Registration not found." }, 404);
    }

    const result = await reconcileSingleRegistration(context, env, sb, rows[0], clientEvent);
    return jsonResponse(result, 200);
  } catch (err) {
    return jsonResponse({ error: err.message || "Error reconciling payment." }, 500);
  }
}

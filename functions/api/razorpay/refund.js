// Cloudflare Pages Function: POST /api/razorpay/refund
// Protected Admin endpoint to initiate full or partial refunds via Razorpay API.

import {
  jsonResponse,
  getSupabaseConfig,
  razorpayRequest,
  logPaymentTransaction
} from "../_razorpay-utils.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized: Missing Admin Token" }, 401);
    }
    const token = authHeader.replace("Bearer ", "").trim();

    const sb = getSupabaseConfig(env);

    // 1. Verify Admin Session with Supabase Auth
    const userRes = await fetch(`${sb.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY || sb.apiKey,
        Authorization: `Bearer ${token}`
      }
    });
    if (!userRes.ok) {
      return jsonResponse({ error: "Unauthorized: Invalid Admin Session" }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return jsonResponse({ error: "Invalid JSON payload." }, 400);
    }

    const regId = String(body.reg_id || "").trim();
    const reason = String(body.reason || "Admin initiated refund").trim();
    const customAmountInr = body.amount_inr ? Number(body.amount_inr) : null;
    const customAmountPaise = body.amount_paise ? Math.round(Number(body.amount_paise)) : null;

    if (!regId || !/^[0-9a-f-]{36}$/i.test(regId)) {
      return jsonResponse({ error: "Valid reg_id is required." }, 400);
    }

    // 2. Fetch Registration Record
    const regRes = await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${encodeURIComponent(regId)}&select=*`, {
      headers: sb.headers
    });
    if (!regRes.ok) {
      return jsonResponse({ error: "Failed to fetch registration." }, 500);
    }
    const rows = await regRes.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonResponse({ error: "Registration not found." }, 404);
    }

    const reg = rows[0];
    if (!reg.razorpay_payment_id) {
      return jsonResponse({ error: "No Razorpay Payment ID is associated with this registration." }, 400);
    }
    if (reg.refund_status === "processed" || reg.gateway_status === "refunded") {
      return jsonResponse({ error: `This transaction has already been refunded (Refund ID: ${reg.refund_id || "—"}).` }, 400);
    }

    const fullAmountPaise = Math.round(Number(reg.amount_payable) * 100);
    const refundAmountPaise = customAmountPaise && customAmountPaise > 0
      ? customAmountPaise
      : (customAmountInr && customAmountInr > 0 ? Math.round(customAmountInr * 100) : fullAmountPaise);

    if (refundAmountPaise <= 0 || refundAmountPaise > fullAmountPaise) {
      return jsonResponse({ error: "Invalid refund amount specified." }, 400);
    }

    // 3. Call Razorpay Refund API
    const refundRes = await razorpayRequest(env, `/payments/${encodeURIComponent(reg.razorpay_payment_id)}/refund`, {
      method: "POST",
      body: {
        amount: refundAmountPaise,
        speed: "normal",
        receipt: `RFND_${reg.reg_code}_${Date.now()}`,
        notes: {
          reg_id: reg.id,
          reg_code: reg.reg_code,
          reason
        }
      }
    });

    if (!refundRes.ok || !refundRes.data?.id) {
      await logPaymentTransaction(env, {
        registrationId: reg.id,
        regCode: reg.reg_code,
        razorpayOrderId: reg.razorpay_order_id,
        razorpayPaymentId: reg.razorpay_payment_id,
        eventType: "refund.failed",
        status: "failed",
        amountPaise: refundAmountPaise,
        errorCode: refundRes.errorCode,
        errorDescription: refundRes.error
      });
      return jsonResponse({ error: refundRes.error || "Failed to initiate refund with Razorpay." }, 502);
    }

    const refundObj = refundRes.data;
    const isFullRefund = refundAmountPaise >= fullAmountPaise;
    const isProcessed = refundObj.status === "processed";
    const nextGatewayStatus = isProcessed
      ? (isFullRefund ? "refunded" : "partially_refunded")
      : "refund_pending";

    const updatePayload = {
      refund_id: refundObj.id,
      refund_status: refundObj.status || "pending",
      refund_amount_paise: refundAmountPaise,
      gateway_status: nextGatewayStatus,
      admin_notes: `${reg.admin_notes ? reg.admin_notes + " | " : ""}Refund (${refundObj.id}): ${reason}`,
      updated_at: new Date().toISOString()
    };

    if (isFullRefund) {
      updatePayload.payment_status = "rejected";
      updatePayload.rejection_reason = `Refunded via Razorpay (${refundObj.id}): ${reason}`;
    }

    await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${reg.id}`, {
      method: "PATCH",
      headers: sb.headers,
      body: JSON.stringify(updatePayload)
    });

    await logPaymentTransaction(env, {
      registrationId: reg.id,
      regCode: reg.reg_code,
      razorpayOrderId: reg.razorpay_order_id,
      razorpayPaymentId: reg.razorpay_payment_id,
      eventType: "refund.initiated",
      status: refundObj.status || "pending",
      amountPaise: refundAmountPaise,
      rawPayload: refundObj
    });

    return jsonResponse({
      success: true,
      refundId: refundObj.id,
      refund_id: refundObj.id,
      refundStatus: refundObj.status,
      refund_status: refundObj.status,
      gatewayStatus: nextGatewayStatus,
      gateway_status: nextGatewayStatus,
      amountRupees: refundAmountPaise / 100,
      amount_inr: refundAmountPaise / 100
    });
  } catch (err) {
    return jsonResponse({ error: err.message || "Error initiating refund." }, 500);
  }
}

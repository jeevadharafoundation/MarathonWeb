// Cloudflare Pages Function: POST /api/razorpay/verify-payment
// Mandatory server-side HMAC-SHA256 signature verification + Razorpay API payment status & amount check.

import {
  jsonResponse,
  getSupabaseConfig,
  verifyHmacSha256,
  razorpayRequest,
  logPaymentTransaction,
  finalizeCapturedPayment
} from "../_razorpay-utils.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return jsonResponse({ error: "Payment gateway credentials not configured." }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return jsonResponse({ error: "Invalid JSON payload." }, 400);
    }

    const regId = String(body.reg_id || "").trim();
    const orderId = String(body.razorpay_order_id || "").trim();
    const paymentId = String(body.razorpay_payment_id || "").trim();
    const signature = String(body.razorpay_signature || "").trim();

    if (!regId || !orderId || !paymentId || !signature) {
      return jsonResponse({ verified: false, error: "Missing required payment verification parameters." }, 400);
    }

    // 1. Constant-time HMAC-SHA256 Signature Verification
    const signedPayload = `${orderId}|${paymentId}`;
    const isSignatureValid = await verifyHmacSha256(signedPayload, signature, env.RAZORPAY_KEY_SECRET.trim());

    if (!isSignatureValid) {
      await logPaymentTransaction(env, {
        registrationId: /^[0-9a-f-]{36}$/i.test(regId) ? regId : null,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        eventType: "checkout.signature_mismatch",
        status: "failed",
        errorCode: "INVALID_SIGNATURE",
        errorDescription: "HMAC-SHA256 payment signature verification failed"
      });
      return jsonResponse({
        verified: false,
        error: "Payment signature verification failed. Transaction could not be authenticated."
      }, 400);
    }

    // 2. Fetch Stored Registration & Validate Order Ownership
    const sb = getSupabaseConfig(env);
    const regRes = await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${encodeURIComponent(regId)}&select=*`, {
      headers: sb.headers
    });

    if (!regRes.ok) {
      return jsonResponse({ verified: false, error: "Unable to fetch registration record for verification." }, 500);
    }

    const rows = await regRes.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return jsonResponse({ verified: false, error: "Registration record not found." }, 404);
    }

    const reg = rows[0];
    if (reg.razorpay_order_id && reg.razorpay_order_id !== orderId) {
      await logPaymentTransaction(env, {
        registrationId: reg.id,
        regCode: reg.reg_code,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        eventType: "checkout.order_mismatch",
        status: "failed",
        errorCode: "ORDER_MISMATCH",
        errorDescription: `Expected order ${reg.razorpay_order_id}, received ${orderId}`
      });
      return jsonResponse({ verified: false, error: "Payment order does not match this registration." }, 400);
    }

    // If already verified, return idempotent success immediately
    if (reg.payment_status === "verified" && reg.bib_number) {
      return jsonResponse({
        verified: true,
        status: "captured",
        regId: reg.id,
        reg_id: reg.id,
        regCode: reg.reg_code,
        reg_code: reg.reg_code,
        bibNumber: reg.bib_number,
        bib_number: reg.bib_number,
        registration: reg,
        record: reg
      });
    }

    // 3. Fetch Authoritative Payment Details from Razorpay Server API
    const pRes = await razorpayRequest(env, `/payments/${encodeURIComponent(paymentId)}`);
    if (!pRes.ok || !pRes.data?.id) {
      // Do not mark failed if Razorpay API had a temporary network/timeout issue; keep pending verification
      await logPaymentTransaction(env, {
        registrationId: reg.id,
        regCode: reg.reg_code,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        eventType: "checkout.gateway_lookup_pending",
        status: "pending",
        errorCode: pRes.errorCode,
        errorDescription: pRes.error
      });
      return jsonResponse({
        verified: false,
        status: "pending",
        reg_id: reg.id,
        reg_code: reg.reg_code,
        message: "Payment signature verified. Confirming capture status with bank..."
      }, 202);
    }

    let payment = pRes.data;
    const expectedPaise = Math.round(Number(reg.amount_payable) * 100);

    // Verify order_id, amount, and currency against Razorpay's payment record
    if (payment.order_id !== orderId) {
      return jsonResponse({ verified: false, error: "Payment does not belong to the specified Razorpay Order." }, 400);
    }
    if (payment.currency !== "INR" || Number(payment.amount) < expectedPaise) {
      await logPaymentTransaction(env, {
        registrationId: reg.id,
        regCode: reg.reg_code,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        eventType: "checkout.amount_mismatch",
        status: "failed",
        amountPaise: Number(payment.amount),
        errorCode: "AMOUNT_MISMATCH",
        errorDescription: `Expected ${expectedPaise} paise (INR), got ${payment.amount} (${payment.currency})`
      });
      return jsonResponse({ verified: false, error: "Paid amount does not match the required registration fee." }, 400);
    }

    // 4. If payment is 'authorized', attempt immediate server-side capture
    if (payment.status === "authorized") {
      const capRes = await razorpayRequest(env, `/payments/${encodeURIComponent(paymentId)}/capture`, {
        method: "POST",
        body: { amount: expectedPaise, currency: "INR" }
      });
      if (capRes.ok && capRes.data?.status === "captured") {
        payment = capRes.data;
      }
    }

    // 5. Activate Registration Only When Confirmed 'captured'
    if (payment.status === "captured") {
      const finalized = await finalizeCapturedPayment(context, env, reg.id, payment, signature);
      return jsonResponse({
        verified: true,
        status: "captured",
        regId: reg.id,
        reg_id: reg.id,
        regCode: finalized.regCode,
        reg_code: finalized.regCode,
        bibNumber: finalized.bibNumber,
        bib_number: finalized.bibNumber,
        registration: finalized.record,
        record: finalized.record
      });
    }

    if (payment.status === "authorized" || payment.status === "created" || payment.status === "pending") {
      await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${reg.id}`, {
        method: "PATCH",
        headers: sb.headers,
        body: JSON.stringify({
          razorpay_payment_id: paymentId,
          razorpay_signature: signature,
          gateway_status: payment.status === "authorized" ? "authorized" : "pending",
          updated_at: new Date().toISOString()
        })
      });

      await logPaymentTransaction(env, {
        registrationId: reg.id,
        regCode: reg.reg_code,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        eventType: "checkout.payment_pending_capture",
        status: payment.status,
        amountPaise: Number(payment.amount),
        paymentMethod: payment.method
      });

      return jsonResponse({
        verified: false,
        status: "pending",
        gateway_status: payment.status,
        reg_id: reg.id,
        reg_code: reg.reg_code,
        message: "Payment verification in progress. Your Bib number will be assigned automatically once confirmed."
      }, 202);
    }

    // Payment failed
    await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${reg.id}&payment_status=neq.verified`, {
      method: "PATCH",
      headers: sb.headers,
      body: JSON.stringify({
        gateway_status: "failed",
        last_payment_error: {
          code: payment.error_code,
          description: payment.error_description,
          source: payment.error_source,
          step: payment.error_step,
          reason: payment.error_reason
        },
        updated_at: new Date().toISOString()
      })
    });

    await logPaymentTransaction(env, {
      registrationId: reg.id,
      regCode: reg.reg_code,
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
      eventType: "checkout.payment_failed",
      status: "failed",
      amountPaise: Number(payment.amount),
      paymentMethod: payment.method,
      errorCode: payment.error_code,
      errorDescription: payment.error_description
    });

    return jsonResponse({
      verified: false,
      status: "failed",
      error: payment.error_description || "Payment was declined by the bank."
    }, 400);
  } catch (err) {
    return jsonResponse({
      error: err.message || "Error verifying payment."
    }, 500);
  }
}

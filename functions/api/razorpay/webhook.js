// Cloudflare Pages Function: POST /api/razorpay/webhook
// Verifies Razorpay Webhook HMAC-SHA256 signature against raw request body,
// stores & deduplicates events in public.razorpay_webhook_events, and reconciles registration states.

import {
  jsonResponse,
  getSupabaseConfig,
  verifyHmacSha256,
  logPaymentTransaction,
  finalizeCapturedPayment
} from "../_razorpay-utils.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return jsonResponse({ error: "Webhook secret is not configured on the server." }, 500);
    }

    const signature = request.headers.get("x-razorpay-signature");
    if (!signature) {
      return jsonResponse({ error: "Missing x-razorpay-signature header." }, 401);
    }

    // 1. Read Raw Body for Exact Cryptographic Verification
    const rawBody = await request.text();
    const isValid = await verifyHmacSha256(rawBody, signature, webhookSecret.trim());
    if (!isValid) {
      return jsonResponse({ error: "Invalid webhook signature." }, 401);
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (_) {
      return jsonResponse({ error: "Malformed JSON webhook body." }, 400);
    }

    const eventType = String(payload.event || "unknown");
    const paymentEntity = payload?.payload?.payment?.entity || null;
    const orderEntity = payload?.payload?.order?.entity || null;
    const refundEntity = payload?.payload?.refund?.entity || null;

    const orderId = paymentEntity?.order_id || orderEntity?.id || null;
    const paymentId = refundEntity?.payment_id || paymentEntity?.id || null;

    // Derive unique event ID from header or fallback deterministic composite key
    const headerEventId = request.headers.get("x-razorpay-event-id");
    const eventId = headerEventId
      ? String(headerEventId).trim()
      : `${eventType}_${paymentId || orderId || "evt"}_${payload.created_at || Date.now()}`;

    const sb = getSupabaseConfig(env);

    // 2. Check Idempotency & Durably Store Webhook Event Before Processing
    const existingCheck = await fetch(
      `${sb.supabaseUrl}/rest/v1/razorpay_webhook_events?event_id=eq.${encodeURIComponent(eventId)}&select=id,processing_status`,
      { headers: sb.headers }
    );
    if (existingCheck.ok) {
      const existingRows = await existingCheck.json();
      if (Array.isArray(existingRows) && existingRows.length > 0) {
        if (existingRows[0].processing_status === "processed" || existingRows[0].processing_status === "ignored_stale") {
          return jsonResponse({ status: "duplicate_ignored", event_id: eventId }, 200);
        }
      } else {
        await fetch(`${sb.supabaseUrl}/rest/v1/razorpay_webhook_events`, {
          method: "POST",
          headers: sb.headers,
          body: JSON.stringify({
            event_id: eventId,
            event_type: eventType,
            razorpay_order_id: orderId,
            razorpay_payment_id: paymentId,
            processing_status: "received",
            payload
          })
        });
      }
    }

    // 3. Locate Matching Registration Record
    let reg = null;
    if (orderId) {
      const r = await fetch(
        `${sb.supabaseUrl}/rest/v1/registrations?razorpay_order_id=eq.${encodeURIComponent(orderId)}&select=*`,
        { headers: sb.headers }
      );
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length > 0) reg = rows[0];
      }
    }
    if (!reg && paymentId) {
      const r = await fetch(
        `${sb.supabaseUrl}/rest/v1/registrations?razorpay_payment_id=eq.${encodeURIComponent(paymentId)}&select=*`,
        { headers: sb.headers }
      );
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length > 0) reg = rows[0];
      }
    }
    const noteRegId = paymentEntity?.notes?.reg_id || orderEntity?.notes?.reg_id;
    if (!reg && noteRegId && /^[0-9a-f-]{36}$/i.test(String(noteRegId))) {
      const r = await fetch(
        `${sb.supabaseUrl}/rest/v1/registrations?id=eq.${encodeURIComponent(String(noteRegId))}&select=*`,
        { headers: sb.headers }
      );
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length > 0) reg = rows[0];
      }
    }

    if (!reg) {
      await fetch(`${sb.supabaseUrl}/rest/v1/razorpay_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`, {
        method: "PATCH",
        headers: sb.headers,
        body: JSON.stringify({
          processing_status: "ignored_stale",
          error_message: "No matching registration found for order/payment",
          processed_at: new Date().toISOString()
        })
      });
      return jsonResponse({ status: "unmatched_order_ignored", event_id: eventId }, 200);
    }

    const expectedPaise = Math.round(Number(reg.amount_payable) * 100);
    let finalProcessingStatus = "processed";

    // 4. Process Event with Out-of-Order State Protection
    if (eventType === "payment.captured" || eventType === "order.paid") {
      if (paymentEntity && paymentEntity.currency === "INR" && Number(paymentEntity.amount) >= expectedPaise) {
        await finalizeCapturedPayment(context, env, reg.id, paymentEntity, null);
      } else {
        finalProcessingStatus = "failed";
        await logPaymentTransaction(env, {
          registrationId: reg.id,
          regCode: reg.reg_code,
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          eventType: `webhook.${eventType}.amount_mismatch`,
          status: "failed",
          amountPaise: Number(paymentEntity?.amount || 0),
          errorCode: "WEBHOOK_AMOUNT_MISMATCH",
          errorDescription: `Expected ${expectedPaise} paise, webhook reported ${paymentEntity?.amount}`
        });
      }
    } else if (eventType === "payment.authorized") {
      // Never overwrite an already captured/verified payment
      if (reg.payment_status !== "verified" && reg.gateway_status !== "captured") {
        await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${reg.id}&payment_status=neq.verified`, {
          method: "PATCH",
          headers: sb.headers,
          body: JSON.stringify({
            razorpay_payment_id: paymentId || reg.razorpay_payment_id,
            gateway_status: "authorized",
            updated_at: new Date().toISOString()
          })
        });
      } else {
        finalProcessingStatus = "ignored_stale";
      }
      await logPaymentTransaction(env, {
        registrationId: reg.id,
        regCode: reg.reg_code,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        eventType: "webhook.payment.authorized",
        status: "authorized",
        amountPaise: Number(paymentEntity?.amount || 0),
        paymentMethod: paymentEntity?.method
      });
    } else if (eventType === "payment.failed") {
      // Critical rule: Never allow a delayed payment.failed event to overwrite a verified/captured registration
      if (reg.payment_status !== "verified" && reg.gateway_status !== "captured") {
        await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${reg.id}&payment_status=neq.verified`, {
          method: "PATCH",
          headers: sb.headers,
          body: JSON.stringify({
            gateway_status: "failed",
            last_payment_error: {
              code: paymentEntity?.error_code,
              description: paymentEntity?.error_description,
              source: paymentEntity?.error_source,
              step: paymentEntity?.error_step,
              reason: paymentEntity?.error_reason
            },
            updated_at: new Date().toISOString()
          })
        });
      } else {
        finalProcessingStatus = "ignored_stale";
      }
      await logPaymentTransaction(env, {
        registrationId: reg.id,
        regCode: reg.reg_code,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        eventType: "webhook.payment.failed",
        status: "failed",
        amountPaise: Number(paymentEntity?.amount || 0),
        paymentMethod: paymentEntity?.method,
        errorCode: paymentEntity?.error_code,
        errorDescription: paymentEntity?.error_description
      });
    } else if (eventType.startsWith("refund.")) {
      const refundId = refundEntity?.id || null;
      const refundAmount = Number(refundEntity?.amount || 0);
      const refundState = eventType === "refund.processed"
        ? "processed"
        : eventType === "refund.failed"
        ? "failed"
        : "pending";

      const isFullRefund = refundAmount >= expectedPaise;
      const nextGatewayStatus = refundState === "processed"
        ? (isFullRefund ? "refunded" : "partially_refunded")
        : (refundState === "pending" ? "refund_pending" : reg.gateway_status);

      const updateFields = {
        refund_id: refundId,
        refund_status: refundState,
        refund_amount_paise: refundAmount,
        gateway_status: nextGatewayStatus,
        updated_at: new Date().toISOString()
      };
      if (refundState === "processed" && isFullRefund) {
        updateFields.payment_status = "rejected";
        updateFields.rejection_reason = `Refunded via Razorpay (${refundId})`;
      }

      await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${reg.id}`, {
        method: "PATCH",
        headers: sb.headers,
        body: JSON.stringify(updateFields)
      });

      await logPaymentTransaction(env, {
        registrationId: reg.id,
        regCode: reg.reg_code,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        eventType: `webhook.${eventType}`,
        status: refundState,
        amountPaise: refundAmount,
        rawPayload: { refund_id: refundId, status: refundEntity?.status }
      });
    }

    // 5. Mark Webhook Event as Processed
    await fetch(`${sb.supabaseUrl}/rest/v1/razorpay_webhook_events?event_id=eq.${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: sb.headers,
      body: JSON.stringify({
        processing_status: finalProcessingStatus,
        processed_at: new Date().toISOString()
      })
    });

    return jsonResponse({ status: "ok", event_id: eventId, outcome: finalProcessingStatus }, 200);
  } catch (err) {
    return jsonResponse({ error: err.message || "Webhook processing failed" }, 500);
  }
}

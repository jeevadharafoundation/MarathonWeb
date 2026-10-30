// Cloudflare Pages Function: POST /api/razorpay/create-order
// Securely validates runner details, computes registration fee server-side,
// prevents duplicate orders via idempotency & order reuse, and creates a Razorpay Order.

import {
  jsonResponse,
  getSupabaseConfig,
  calculateServerFee,
  razorpayRequest,
  logPaymentTransaction,
  finalizeCapturedPayment
} from "../_razorpay-utils.js";

function cleanPhone(val) {
  let digits = String(val || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

function calculateAgeOnRaceDay(dobStr) {
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) return -1;
  const raceDate = new Date("2027-01-17T00:00:00+05:30");
  let age = raceDate.getFullYear() - dob.getFullYear();
  const m = raceDate.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && raceDate.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      return jsonResponse({ error: "Payment gateway is not configured on the server." }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      return jsonResponse({ error: "Invalid JSON request body." }, 400);
    }

    const fullName = String(body.full_name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const gender = String(body.gender || "").trim();
    const dob = String(body.dob || "").trim();
    const phone = cleanPhone(body.phone);
    const emergencyContact = cleanPhone(body.emergency_contact);
    const bloodGroup = String(body.blood_group || "").trim();
    const address = String(body.address || "").trim();
    const hearSource = String(body.hear_source || "").trim();
    const bloodDonationInterest = String(body.blood_donation_interest || "No").trim();
    const category = String(body.category || "").trim();
    const shirtSize = String(body.shirt_size || "").trim();
    const requestedFeeType = String(body.fee_type || "individual").trim();
    const studentProofUrl = body.student_proof_url ? String(body.student_proof_url).trim() : null;
    const rawGroupMembers = Array.isArray(body.group_members) ? body.group_members : null;
    const clientIdempotencyKey = body.idempotency_key ? String(body.idempotency_key).trim().slice(0, 110) : null;
    const existingRegId = body.reg_id ? String(body.reg_id).trim() : null;

    // 1. Strict Server-Side Input Validation
    if (fullName.length < 2 || fullName.length > 100) {
      return jsonResponse({ error: "Please enter a valid full name (2–100 characters)." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return jsonResponse({ error: "Please enter a valid email address." }, 400);
    }
    if (!["Male", "Female", "Prefer not to say", "Other"].includes(gender)) {
      return jsonResponse({ error: "Please select a valid gender." }, 400);
    }
    const age = calculateAgeOnRaceDay(dob);
    const minAgeByCat = { "21.1K": 18, "10K": 14, "5K": 5 };
    const minAge = minAgeByCat[category] || 5;
    if (age < minAge || age > 100) {
      return jsonResponse({ error: `Participant must be at least ${minAge} years old on 17 January 2027 for the ${category} category.` }, 400);
    }
    if (!/^[6-9]\d{9}$/.test(phone)) {
      return jsonResponse({ error: "Please enter a valid 10-digit Indian mobile number." }, 400);
    }
    if (!/^[6-9]\d{9}$/.test(emergencyContact) || emergencyContact === phone) {
      return jsonResponse({ error: "Please enter a valid 10-digit emergency contact number different from the participant's phone number." }, 400);
    }
    if (!["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].includes(bloodGroup)) {
      return jsonResponse({ error: "Please select a valid blood group." }, 400);
    }
    if (address.length < 10 || address.length > 350) {
      return jsonResponse({ error: "Please enter a complete residential address (10–350 characters)." }, 400);
    }
    if (!["XS / 34", "S / 36", "M / 38", "L / 40", "XL / 42", "XXL / 44"].includes(shirtSize)) {
      return jsonResponse({ error: "Please select a valid T-shirt size." }, 400);
    }

    let sanitizedGroupMembers = null;
    if (requestedFeeType === "student_group") {
      if (!studentProofUrl) {
        return jsonResponse({ error: "Student ID proof is required for Student Group registration." }, 400);
      }
      if (!rawGroupMembers || rawGroupMembers.length < 4) {
        return jsonResponse({ error: "Student Group requires at least 4 accompanying students (minimum 5 students total)." }, 400);
      }
      sanitizedGroupMembers = [];
      for (let i = 0; i < rawGroupMembers.length; i++) {
        const m = rawGroupMembers[i] || {};
        const mName = String(m.name || "").trim();
        const mPhone = cleanPhone(m.phone);
        const mShirt = String(m.shirt_size || "").trim();
        if (mName.length < 2 || !/^[6-9]\d{9}$/.test(mPhone) || !mShirt) {
          return jsonResponse({ error: `Please provide valid Name, 10-digit Mobile, and T-Shirt Size for Student #${i + 2}.` }, 400);
        }
        sanitizedGroupMembers.push({
          member_index: i + 2,
          name: mName,
          phone: mPhone,
          shirt_size: mShirt,
          bib_number: null
        });
      }
    }

    // 2. Server-Side Authoritative Price Calculation
    const pricing = await calculateServerFee(env, category, requestedFeeType, sanitizedGroupMembers);
    if (!pricing.valid) {
      return jsonResponse({ error: pricing.error || "Invalid category or fee configuration." }, 400);
    }
    const { effectiveFeeType, amountInr, amountPaise } = pricing;

    const sb = getSupabaseConfig(env);

    // 3. Check for Existing Registration (Order Reuse / Idempotency)
    let existingReg = null;
    if (existingRegId && /^[0-9a-f-]{36}$/i.test(existingRegId)) {
      const r = await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${existingRegId}&select=*`, {
        headers: sb.headers
      });
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length > 0) existingReg = rows[0];
      }
    }

    if (!existingReg && clientIdempotencyKey) {
      const r = await fetch(`${sb.supabaseUrl}/rest/v1/registrations?idempotency_key=eq.${encodeURIComponent(clientIdempotencyKey)}&select=*`, {
        headers: sb.headers
      });
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length > 0) existingReg = rows[0];
      }
    }

    // If existing registration found, reconcile its state before creating or reusing an order
    if (existingReg) {
      if (existingReg.payment_status === "verified" || existingReg.gateway_status === "captured") {
        return jsonResponse({
          alreadyVerified: true,
          regId: existingReg.id,
          reg_id: existingReg.id,
          regCode: existingReg.reg_code,
          reg_code: existingReg.reg_code,
          bibNumber: existingReg.bib_number,
          bib_number: existingReg.bib_number,
          registration: existingReg,
          record: existingReg
        });
      }

      // If existing registration already has a razorpay_order_id, check Razorpay first
      if (existingReg.razorpay_order_id) {
        const paymentsCheck = await razorpayRequest(env, `/orders/${existingReg.razorpay_order_id}/payments`);
        if (paymentsCheck.ok && Array.isArray(paymentsCheck.data?.items)) {
          const items = paymentsCheck.data.items;
          const capturedPayment = items.find((p) => p.status === "captured" && Number(p.amount) >= amountPaise);
          if (capturedPayment) {
            const finalized = await finalizeCapturedPayment(context, env, existingReg.id, capturedPayment, null);
            return jsonResponse({
              alreadyVerified: true,
              regId: existingReg.id,
              reg_id: existingReg.id,
              regCode: finalized.regCode,
              reg_code: finalized.regCode,
              bibNumber: finalized.bibNumber,
              bib_number: finalized.bibNumber,
              registration: finalized.record,
              record: finalized.record
            });
          }

          const inFlightPayment = items.find((p) => p.status === "authorized");
          if (inFlightPayment) {
            // Attempt immediate capture of authorized payment
            const capRes = await razorpayRequest(env, `/payments/${inFlightPayment.id}/capture`, {
              method: "POST",
              body: { amount: inFlightPayment.amount, currency: "INR" }
            });
            if (capRes.ok && capRes.data?.status === "captured") {
              const finalized = await finalizeCapturedPayment(context, env, existingReg.id, capRes.data, null);
              return jsonResponse({
                alreadyVerified: true,
                regId: existingReg.id,
                reg_id: existingReg.id,
                regCode: finalized.regCode,
                reg_code: finalized.regCode,
                bibNumber: finalized.bibNumber,
                bib_number: finalized.bibNumber,
                registration: finalized.record,
                record: finalized.record
              });
            }
            const pendingMsg = "Your previous payment attempt is authorized and awaiting bank confirmation. Please wait a moment while we verify it.";
            return jsonResponse({
              paymentPending: true,
              regId: existingReg.id,
              reg_id: existingReg.id,
              regCode: existingReg.reg_code,
              reg_code: existingReg.reg_code,
              orderId: existingReg.razorpay_order_id,
              order_id: existingReg.razorpay_order_id,
              error: pendingMsg,
              message: pendingMsg
            }, 409);
          }
        }

        // If the amount hasn't changed, update participant details and reuse the existing Razorpay Order ID
        if (Math.round(Number(existingReg.amount_payable) * 100) === amountPaise) {
          const nextAttempts = (Number(existingReg.payment_attempts) || 1) + 1;
          await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${existingReg.id}`, {
            method: "PATCH",
            headers: sb.headers,
            body: JSON.stringify({
              full_name: fullName,
              email,
              gender,
              dob,
              age,
              phone,
              emergency_contact: emergencyContact,
              blood_group: bloodGroup,
              address,
              hear_source: hearSource,
              blood_donation_interest: bloodDonationInterest,
              shirt_size: shirtSize,
              student_proof_url: studentProofUrl,
              group_members: sanitizedGroupMembers,
              gateway_status: "created",
              payment_attempts: nextAttempts,
              updated_at: new Date().toISOString()
            })
          });

          await logPaymentTransaction(env, {
            registrationId: existingReg.id,
            regCode: existingReg.reg_code,
            razorpayOrderId: existingReg.razorpay_order_id,
            eventType: "order.reused",
            status: "created",
            amountPaise,
            rawPayload: { attempt: nextAttempts }
          });

          return jsonResponse({
            keyId: env.RAZORPAY_KEY_ID.trim(),
            key_id: env.RAZORPAY_KEY_ID.trim(),
            orderId: existingReg.razorpay_order_id,
            order_id: existingReg.razorpay_order_id,
            amountPaise,
            amount: amountPaise,
            amountRupees: amountInr,
            amount_inr: amountInr,
            currency: "INR",
            regId: existingReg.id,
            reg_id: existingReg.id,
            regCode: existingReg.reg_code,
            reg_code: existingReg.reg_code,
            prefill: { name: fullName, email, contact: phone },
            reused: true
          });
        }
      }
    }

    // 4. Create or Update Registration Record in Supabase Before Calling Razorpay
    let targetReg = existingReg;
    if (!targetReg) {
      const insertPayload = {
        full_name: fullName,
        email,
        gender,
        dob,
        age,
        phone,
        emergency_contact: emergencyContact,
        blood_group: bloodGroup,
        address,
        hear_source: hearSource,
        blood_donation_interest: bloodDonationInterest,
        category,
        shirt_size: shirtSize,
        fee_type: effectiveFeeType,
        amount_payable: amountInr,
        payment_provider: "razorpay",
        utr_number: "PENDING_RAZORPAY",
        payment_proof_url: "RAZORPAY_CHECKOUT",
        student_proof_url: studentProofUrl,
        group_members: sanitizedGroupMembers,
        payment_status: "pending",
        gateway_status: "created",
        currency: "INR",
        idempotency_key: clientIdempotencyKey || `am27_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        payment_attempts: 1
      };

      const insRes = await fetch(`${sb.supabaseUrl}/rest/v1/registrations`, {
        method: "POST",
        headers: {
          ...sb.headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify(insertPayload)
      });

      if (!insRes.ok) {
        const errText = await insRes.text();
        return jsonResponse({ error: `Could not create registration record: ${errText}` }, 500);
      }
      const insertedRows = await insRes.json();
      targetReg = insertedRows[0];
    }

    // 5. Create Official Razorpay Order via Server API
    const rzpOrderRes = await razorpayRequest(env, "/orders", {
      method: "POST",
      body: {
        amount: amountPaise,
        currency: "INR",
        receipt: targetReg.reg_code,
        payment_capture: 1,
        notes: {
          reg_id: targetReg.id,
          reg_code: targetReg.reg_code,
          category,
          fee_type: effectiveFeeType,
          runner_name: fullName,
          runner_phone: phone
        }
      }
    });

    if (!rzpOrderRes.ok || !rzpOrderRes.data?.id) {
      await logPaymentTransaction(env, {
        registrationId: targetReg.id,
        regCode: targetReg.reg_code,
        eventType: "order.create_failed",
        status: "failed",
        amountPaise,
        errorCode: rzpOrderRes.errorCode,
        errorDescription: rzpOrderRes.error,
        rawPayload: rzpOrderRes.data
      });
      return jsonResponse({
        error: rzpOrderRes.error || "Unable to initialize payment order with Razorpay. Please try again."
      }, 502);
    }

    const rzpOrder = rzpOrderRes.data;

    // 6. Persist razorpay_order_id on the Registration Row
    const updateRes = await fetch(`${sb.supabaseUrl}/rest/v1/registrations?id=eq.${targetReg.id}`, {
      method: "PATCH",
      headers: sb.headers,
      body: JSON.stringify({
        category,
        fee_type: effectiveFeeType,
        amount_payable: amountInr,
        razorpay_order_id: rzpOrder.id,
        gateway_status: "created",
        updated_at: new Date().toISOString()
      })
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      return jsonResponse({ error: `Failed to link payment order: ${errText}` }, 500);
    }

    await logPaymentTransaction(env, {
      registrationId: targetReg.id,
      regCode: targetReg.reg_code,
      razorpayOrderId: rzpOrder.id,
      eventType: "order.created",
      status: "created",
      amountPaise,
      currency: "INR",
      rawPayload: {
        id: rzpOrder.id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        receipt: rzpOrder.receipt,
        status: rzpOrder.status
      }
    });

    return jsonResponse({
      keyId: env.RAZORPAY_KEY_ID.trim(),
      key_id: env.RAZORPAY_KEY_ID.trim(),
      orderId: rzpOrder.id,
      order_id: rzpOrder.id,
      amountPaise,
      amount: amountPaise,
      amountRupees: amountInr,
      amount_inr: amountInr,
      currency: "INR",
      regId: targetReg.id,
      reg_id: targetReg.id,
      regCode: targetReg.reg_code,
      reg_code: targetReg.reg_code,
      prefill: { name: fullName, email, contact: phone },
      reused: false
    });
  } catch (err) {
    return jsonResponse({
      error: err.message || "Unexpected error while creating payment order."
    }, 500);
  }
}

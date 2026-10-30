/**
 * Comprehensive Automated Verification Suite for Razorpay Payment Gateway Integration
 * Tests:
 * 1. Server-side price calculation (Early Bird, Regular, Student Group, Invalid inputs)
 * 2. Constant-time HMAC-SHA256 Checkout signature verification & tamper rejection
 * 3. Webhook raw-body HMAC-SHA256 verification & payload modification rejection
 * 4. Endpoint security guards (verify-payment, webhook, refund authorization)
 */

import assert from "node:assert/strict";
import {
  calculateServerFee,
  computeHmacSha256Hex,
  verifyHmacSha256
} from "../functions/api/_razorpay-utils.js";
import { onRequestPost as verifyPaymentPost } from "../functions/api/razorpay/verify-payment.js";
import { onRequestPost as webhookPost } from "../functions/api/razorpay/webhook.js";
import { onRequestPost as refundPost } from "../functions/api/razorpay/refund.js";

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    })
    .catch((err) => {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

console.log("==========================================================");
console.log("🔒 Running Razorpay Integration Security & Accuracy Tests");
console.log("==========================================================\n");

// 1. Server-Side Fee Calculation Tests
await test("Early Bird pricing: 21.1K = ₹700 (70000 paise), 10K = ₹550 (55000 paise), 5K = ₹300 (30000 paise)", async () => {
  const futureDeadline = new Date("2027-01-05T18:00:00+05:30");
  const beforeDeadlineNow = new Date("2026-11-15T12:00:00+05:30");

  const r21 = await calculateServerFee({
    category: "21.1K",
    feeType: "individual",
    groupMembers: null,
    earlyBirdDeadline: futureDeadline,
    now: beforeDeadlineNow
  });
  assert.equal(r21.valid, true);
  assert.equal(r21.effectiveFeeType, "early");
  assert.equal(r21.amountRupees, 700);
  assert.equal(r21.amountPaise, 70000);

  const r10 = await calculateServerFee({
    category: "10K",
    feeType: "individual",
    groupMembers: null,
    earlyBirdDeadline: futureDeadline,
    now: beforeDeadlineNow
  });
  assert.equal(r10.valid, true);
  assert.equal(r10.effectiveFeeType, "early");
  assert.equal(r10.amountRupees, 550);
  assert.equal(r10.amountPaise, 55000);

  const r5 = await calculateServerFee({
    category: "5K",
    feeType: "individual",
    groupMembers: null,
    earlyBirdDeadline: futureDeadline,
    now: beforeDeadlineNow
  });
  assert.equal(r5.valid, true);
  assert.equal(r5.effectiveFeeType, "early");
  assert.equal(r5.amountRupees, 300);
  assert.equal(r5.amountPaise, 30000);
});

await test("Regular pricing after Early Bird deadline: 21.1K = ₹750, 10K = ₹600, 5K = ₹350", async () => {
  const deadline = new Date("2027-01-05T18:00:00+05:30");
  const afterDeadlineNow = new Date("2027-01-06T09:00:00+05:30");

  // Even if frontend tries to pass feeType="early" after deadline, server enforces "regular"
  const r21 = await calculateServerFee({
    category: "21.1K",
    feeType: "early",
    groupMembers: null,
    earlyBirdDeadline: deadline,
    now: afterDeadlineNow
  });
  assert.equal(r21.valid, true);
  assert.equal(r21.effectiveFeeType, "regular");
  assert.equal(r21.amountRupees, 750);
  assert.equal(r21.amountPaise, 75000);

  const r10 = await calculateServerFee({
    category: "10K",
    feeType: "individual",
    groupMembers: null,
    earlyBirdDeadline: deadline,
    now: afterDeadlineNow
  });
  assert.equal(r10.amountRupees, 600);
  assert.equal(r10.amountPaise, 60000);

  const r5 = await calculateServerFee({
    category: "5K",
    feeType: "individual",
    groupMembers: null,
    earlyBirdDeadline: deadline,
    now: afterDeadlineNow
  });
  assert.equal(r5.amountRupees, 350);
  assert.equal(r5.amountPaise, 35000);
});

await test("Student Group pricing: ₹200/student, minimum 5 students enforced server-side", async () => {
  // 1 Leader + 4 Members = 5 students = ₹1,000 (100000 paise)
  const validGroup = await calculateServerFee({
    category: "10K",
    feeType: "student_group",
    groupMembers: [{ name: "S2" }, { name: "S3" }, { name: "S4" }, { name: "S5" }]
  });
  assert.equal(validGroup.valid, true);
  assert.equal(validGroup.totalStudents, 5);
  assert.equal(validGroup.amountRupees, 1000);
  assert.equal(validGroup.amountPaise, 100000);

  // 1 Leader + 6 Members = 7 students = ₹1,400 (140000 paise)
  const largerGroup = await calculateServerFee({
    category: "21.1K",
    feeType: "student_group",
    groupMembers: [{}, {}, {}, {}, {}, {}]
  });
  assert.equal(largerGroup.valid, true);
  assert.equal(largerGroup.totalStudents, 7);
  assert.equal(largerGroup.amountRupees, 1400);
  assert.equal(largerGroup.amountPaise, 140000);

  // 1 Leader + 2 Members = 3 students -> MUST REJECT
  const invalidSmallGroup = await calculateServerFee({
    category: "5K",
    feeType: "student_group",
    groupMembers: [{ name: "S2" }, { name: "S3" }]
  });
  assert.equal(invalidSmallGroup.valid, false);
});

await test("Invalid race category is rejected server-side", async () => {
  const res = await calculateServerFee({
    category: "42K_HACKED",
    feeType: "individual"
  });
  assert.equal(res.valid, false);
});

// 2. Cryptographic Signature Verification Tests
await test("HMAC-SHA256 checkout signature verification succeeds for authentic signature and rejects tampering", async () => {
  const secret = "test_secret_key_987654321";
  const orderId = "order_Pxyz123456789";
  const paymentId = "pay_Qabc987654321";
  const canonicalPayload = `${orderId}|${paymentId}`;

  const validSig = await computeHmacSha256Hex(canonicalPayload, secret);
  assert.equal(validSig.length, 64);

  // Authentic check
  const isOk = await verifyHmacSha256(canonicalPayload, validSig, secret);
  assert.equal(isOk, true);

  // Tampered payment_id
  const tamperedPaymentCheck = await verifyHmacSha256(`${orderId}|pay_FAKE000000`, validSig, secret);
  assert.equal(tamperedPaymentCheck, false);

  // Tampered order_id
  const tamperedOrderCheck = await verifyHmacSha256(`order_OTHER111|${paymentId}`, validSig, secret);
  assert.equal(tamperedOrderCheck, false);

  // Wrong secret
  const wrongSecretCheck = await verifyHmacSha256(canonicalPayload, validSig, "wrong_secret");
  assert.equal(wrongSecretCheck, false);

  // Flip 1 character in signature
  const flippedSig = (validSig[0] === "a" ? "b" : "a") + validSig.slice(1);
  const flippedCheck = await verifyHmacSha256(canonicalPayload, flippedSig, secret);
  assert.equal(flippedCheck, false);
});

// 3. Webhook Raw Body Signature Verification Tests
await test("Webhook signature verification validates exact raw body and rejects tampered JSON", async () => {
  const webhookSecret = "whsec_live_test_secret_key";
  const rawBody = JSON.stringify({
    entity: "event",
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_12345",
          order_id: "order_12345",
          amount: 70000,
          currency: "INR",
          status: "captured"
        }
      }
    }
  });

  const validWebhookSig = await computeHmacSha256Hex(rawBody, webhookSecret);
  assert.equal(await verifyHmacSha256(rawBody, validWebhookSig, webhookSecret), true);

  // Attacker modifies amount from 70000 to 100
  const tamperedBody = rawBody.replace("70000", "100");
  assert.equal(await verifyHmacSha256(tamperedBody, validWebhookSig, webhookSecret), false);
});

// 4. Endpoint Guard Tests
await test("POST /api/razorpay/verify-payment rejects invalid HMAC signature with HTTP 400", async () => {
  const req = new Request("https://angamalymarathon.com/api/razorpay/verify-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reg_id: "00000000-0000-0000-0000-000000000001",
      razorpay_order_id: "order_Test123",
      razorpay_payment_id: "pay_Test123",
      razorpay_signature: "0000000000000000000000000000000000000000000000000000000000000000"
    })
  });

  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test_srk",
    RAZORPAY_KEY_ID: "rzp_test_123",
    RAZORPAY_KEY_SECRET: "secret_test_123"
  };

  // Mock global fetch so audit log call doesn't hit network
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([]), { status: 200 });
  try {
    const res = await verifyPaymentPost({ request: req, env });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.verified, false);
    assert.match(body.error, /signature/i);
  } finally {
    globalThis.fetch = origFetch;
  }
});

await test("POST /api/razorpay/webhook rejects forged or missing X-Razorpay-Signature with HTTP 401", async () => {
  const req = new Request("https://angamalymarathon.com/api/razorpay/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Razorpay-Signature": "forged_signature_12345"
    },
    body: JSON.stringify({ event: "payment.captured" })
  });

  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test_srk",
    RAZORPAY_WEBHOOK_SECRET: "whsec_real_secret"
  };

  const res = await webhookPost({ request: req, env });
  assert.equal(res.status, 401);
});

await test("POST /api/razorpay/refund rejects unauthenticated requests with HTTP 401", async () => {
  const req = new Request("https://angamalymarathon.com/api/razorpay/refund", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reg_id: "00000000-0000-0000-0000-000000000001" })
  });

  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test_srk",
    RAZORPAY_KEY_ID: "rzp_test_123",
    RAZORPAY_KEY_SECRET: "secret_test_123"
  };

  const res = await refundPost({ request: req, env });
  assert.equal(res.status, 401);
});

console.log(`\n🎉 All ${passed} test suites completed!`);

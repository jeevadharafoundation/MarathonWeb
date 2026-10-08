/**
 * Registration form handler:
 * - Dynamic UPI setup
 * - Age calculation
 * - Client-side image compression
 * - Cloudflare R2 streaming upload
 * - Supabase database submission
 */

(function () {
  const cfg = window.ENV_CONFIG || {};
  const prices = {
    regular: { "21.1K": 650, "10K": 550, "5K": 350 },
    early: { "21.1K": 600, "10K": 500, "5K": 300 },
    student: { "21.1K": 200, "10K": 200, "5K": 200 }
  };
  const earlyBirdDeadline = new Date("2027-01-05T18:00:00+05:30");

  const form = document.getElementById("registrationForm");
  const category = document.getElementById("category");
  const feeType = document.getElementById("feeType");
  const shirt = document.getElementById("shirt");
  const sCategory = document.getElementById("sCategory");
  const sFeeType = document.getElementById("sFeeType");
  const sShirt = document.getElementById("sShirt");
  const sPay = document.getElementById("sPay");
  const sAmount = document.getElementById("sAmount");
  const upiAmount = document.getElementById("upiAmount");
  const studentProofWrap = document.getElementById("studentProofWrap");
  const studentProof = document.getElementById("studentProof");
  const feeHelp = document.getElementById("feeHelp");
  const submitBtn = document.getElementById("submitBtn");
  const statusBanner = document.getElementById("statusBanner");

  let upiSettings = {
    gpay: "marathon@upi",
    phonepe: "marathon@upi",
    paytm: "marathon@upi",
    supermoney: "marathon@upi",
    amazonpay: "marathon@upi"
  };

  const providerNames = {
    gpay: "Google Pay",
    phonepe: "PhonePe",
    paytm: "Paytm",
    supermoney: "SuperMoney",
    amazonpay: "Amazon Pay"
  };

  function categoryLabel(v) {
    return v === "21.1K" ? "Half Marathon – 21.1K" : v === "10K" ? "Mini Marathon – 10K" : "Fun Run / Walk – 5K";
  }

  function feeLabel(v) {
    return v === "early" ? "Early Bird" : v === "student" ? "Student" : "Regular";
  }

  function updateSummary() {
    const cat = category.value;
    const ft = feeType.value;
    const amount = prices[ft] ? prices[ft][cat] : 650;

    if (sCategory) sCategory.textContent = categoryLabel(cat);
    if (sFeeType) sFeeType.textContent = feeLabel(ft);
    if (sShirt) sShirt.textContent = shirt.value;
    if (sAmount) sAmount.textContent = "₹" + amount;
    if (upiAmount) upiAmount.textContent = "₹" + amount;

    const isStudent = ft === "student";
    if (studentProofWrap) studentProofWrap.style.display = isStudent ? "block" : "none";
    if (studentProof) studentProof.required = isStudent;

    refreshUpiPayment();
  }

  function refreshUpiPayment() {
    const provider = document.getElementById("paymentProvider")?.value || "gpay";
    const upiId = upiSettings[provider] || "marathon@upi";
    const amount = (sAmount ? sAmount.textContent : "₹650").replace("₹", "");

    const selectedProviderEl = document.getElementById("selectedProviderName");
    const selectedUpiIdEl = document.getElementById("selectedUpiId");
    const payNowBtn = document.getElementById("payNowBtn");

    if (selectedProviderEl) selectedProviderEl.textContent = providerNames[provider] || provider;
    if (selectedUpiIdEl) selectedUpiIdEl.textContent = upiId;
    if (sPay) sPay.textContent = providerNames[provider] || provider;

    if (payNowBtn) {
      const params = new URLSearchParams({
        pa: upiId,
        pn: "Angamaly Marathon 2027",
        am: amount,
        cu: "INR",
        tn: `${categoryLabel(category.value)} Reg`
      });
      payNowBtn.href = "upi://pay?" + params.toString();
    }
  }

  // Fetch Live UPI Settings from Supabase
  async function loadSettings() {
    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/event_settings?key=eq.upi_config&select=value`, {
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0 && data[0].value) {
          upiSettings = { ...upiSettings, ...data[0].value };
          refreshUpiPayment();
        }
      }
    } catch (err) {
      console.warn("Using offline UPI defaults:", err);
    }
  }

  // Event Listeners for UI
  category?.addEventListener("change", updateSummary);
  feeType?.addEventListener("change", updateSummary);
  shirt?.addEventListener("change", updateSummary);

  // Early Bird Expiration Check
  if (new Date() > earlyBirdDeadline) {
    const earlyOpt = feeType?.querySelector('option[value="early"]');
    if (earlyOpt) {
      earlyOpt.disabled = true;
      earlyOpt.textContent = "Early Bird Registration – Closed";
    }
    if (feeHelp) feeHelp.textContent = "Early Bird registration closed on 05/01/2027 at 6:00 PM IST.";
  }

  // Age calculation as on race day (17 Jan 2027)
  const dobInput = document.getElementById("dob");
  const ageInput = document.getElementById("age");
  dobInput?.addEventListener("change", function () {
    if (!this.value) return;
    const dob = new Date(this.value + "T00:00:00");
    const raceDay = new Date("2027-01-17T00:00:00+05:30");
    let age = raceDay.getFullYear() - dob.getFullYear();
    const m = raceDay.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && raceDay.getDate() < dob.getDate())) {
      age--;
    }
    if (ageInput) ageInput.value = Math.max(0, age);
  });

  // UPI App Selection Buttons
  document.querySelectorAll(".upi-app-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".upi-app-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const providerInput = document.getElementById("paymentProvider");
      if (providerInput) providerInput.value = btn.dataset.provider;
      refreshUpiPayment();
    });
  });

  // Race Selection Buttons on Landing Cards
  document.querySelectorAll(".race-select-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const selectedRace = btn.dataset.race;
      if (category) category.value = selectedRace;
      updateSummary();

      document.getElementById("register")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  });

  // Helper to upload a file to Cloudflare R2
  async function uploadToR2(file, folder = "receipts") {
    // Compress first if image
    let uploadFile = file;
    if (file.type.startsWith("image/") && window.compressImage) {
      uploadFile = await window.compressImage(file, { maxWidth: 1280, quality: 0.80 });
    }

    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("folder", folder);

    const uploadRes = await fetch(cfg.UPLOAD_ENDPOINT || "/api/upload", {
      method: "POST",
      body: formData
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error || `Upload failed with HTTP ${uploadRes.status}`);
    }

    const result = await uploadRes.json();
    return result.url;
  }

  function setStatus(msg, type = "info") {
    if (!statusBanner) return;
    statusBanner.style.display = "block";
    statusBanner.className = `status-banner status-${type}`;
    statusBanner.innerHTML = msg;
    statusBanner.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Handle Form Submission
  form?.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!this.reportValidity()) return;

    const paymentProofInput = document.getElementById("paymentProof");
    const paymentFile = paymentProofInput?.files?.[0];
    if (!paymentFile) {
      alert("Please select your payment screenshot / receipt.");
      return;
    }

    const originalBtnText = submitBtn ? submitBtn.innerHTML : "Submit Registration";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = "Processing Registration...";
    }

    try {
      setStatus("⏳ Compressing and uploading payment proof to secure Cloudflare R2...", "info");

      // 1. Upload Payment Proof to Cloudflare R2
      const paymentProofUrl = await uploadToR2(paymentFile, "receipts");

      // 2. Upload Student Proof if provided
      let studentProofUrl = null;
      const studentProofFile = studentProof?.files?.[0];
      if (feeType.value === "student" && studentProofFile) {
        setStatus("⏳ Uploading student ID proof...", "info");
        studentProofUrl = await uploadToR2(studentProofFile, "student-proofs");
      }

      setStatus("⏳ Saving your details into official registration roster...", "info");

      // 3. Prepare Payload for Supabase
      const cat = category.value;
      const ft = feeType.value;
      const expectedAmount = prices[ft] ? prices[ft][cat] : 650;

      const payload = {
        full_name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim().toLowerCase(),
        gender: document.getElementById("gender").value,
        dob: document.getElementById("dob").value,
        age: parseInt(document.getElementById("age").value || "0", 10),
        phone: document.getElementById("phone").value.trim(),
        emergency_contact: document.getElementById("emergency").value.trim(),
        blood_group: document.getElementById("blood").value,
        address: document.getElementById("address").value.trim(),
        hear_source: document.getElementById("source").value,
        blood_donation_interest: document.getElementById("bloodDonate").value,
        category: cat,
        shirt_size: shirt.value,
        fee_type: ft,
        amount_payable: expectedAmount,
        payment_provider: document.getElementById("paymentProvider").value,
        utr_number: document.getElementById("txn").value.trim(),
        payment_proof_url: paymentProofUrl,
        student_proof_url: studentProofUrl,
        payment_status: "pending"
      };

      // 4. Insert into Supabase table
      const dbRes = await fetch(`${cfg.SUPABASE_URL}/rest/v1/registrations`, {
        method: "POST",
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify(payload)
      });

      if (!dbRes.ok) {
        const errJson = await dbRes.json().catch(() => ({}));
        throw new Error(errJson.message || `Database save failed (${dbRes.status})`);
      }

      const inserted = await dbRes.json();
      const record = inserted[0] || payload;

      // 5. Success! Redirect to confirmation slip
      sessionStorage.setItem("lastRegistration", JSON.stringify(record));
      window.location.href = `confirmation.html?code=${encodeURIComponent(record.reg_code || "")}&id=${encodeURIComponent(record.id || "")}`;

    } catch (err) {
      console.error("Registration error:", err);
      setStatus(`❌ <strong>Registration Error:</strong> ${err.message}. Please try again or contact organizers.`, "error");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
      }
    }
  });

  // Init
  updateSummary();
  loadSettings();
})();

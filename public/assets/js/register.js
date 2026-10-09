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

    // Desktop Summary Elements
    if (sCategory) sCategory.textContent = categoryLabel(cat);
    if (sFeeType) sFeeType.textContent = feeLabel(ft);
    if (sShirt) sShirt.textContent = shirt.value;
    if (sAmount) sAmount.textContent = "₹" + amount;
    if (upiAmount) upiAmount.textContent = "₹" + amount;

    // Visual Category Tiles Sync
    const p21 = prices[ft] ? prices[ft]["21.1K"] : 650;
    const p10 = prices[ft] ? prices[ft]["10K"] : 550;
    const p5 = prices[ft] ? prices[ft]["5K"] : 350;
    const t21 = document.getElementById("tilePrice21");
    if (t21) t21.textContent = "₹" + p21;
    const t10 = document.getElementById("tilePrice10");
    if (t10) t10.textContent = "₹" + p10;
    const t5 = document.getElementById("tilePrice5");
    if (t5) t5.textContent = "₹" + p5;

    document.querySelectorAll(".cat-tile").forEach((tile) => {
      if (tile.dataset.cat === cat) {
        tile.classList.add("active");
      } else {
        tile.classList.remove("active");
      }
    });

    // Mobile Sticky Price Bar Sync
    const mStickyCat = document.getElementById("mStickyCategory");
    if (mStickyCat) mStickyCat.textContent = categoryLabel(cat);
    const mStickyFee = document.getElementById("mStickyFee");
    if (mStickyFee) mStickyFee.textContent = feeLabel(ft) + " Registration";
    const mStickyAmount = document.getElementById("mStickyAmount");
    if (mStickyAmount) {
      mStickyAmount.textContent = "₹" + amount;
      // Price Pulse Animation
      mStickyAmount.classList.remove("price-pulse");
      void mStickyAmount.offsetWidth;
      mStickyAmount.classList.add("price-pulse");
    }

    // Mobile Breakdown Sheet Sync
    const sheetCat = document.getElementById("sheetCategory");
    if (sheetCat) sheetCat.textContent = categoryLabel(cat);
    const sheetFee = document.getElementById("sheetFee");
    if (sheetFee) sheetFee.textContent = feeLabel(ft);
    const sheetShirt = document.getElementById("sheetShirt");
    if (sheetShirt) sheetShirt.textContent = shirt.value;
    const sheetAmount = document.getElementById("sheetAmount");
    if (sheetAmount) sheetAmount.textContent = "₹" + amount;

    // Step 2 Recap Strip Sync
    const recapCatName = document.getElementById("recapCatName");
    if (recapCatName) recapCatName.textContent = categoryLabel(cat);
    const recapTotalFee = document.getElementById("recapTotalFee");
    if (recapTotalFee) recapTotalFee.textContent = "₹" + amount;

    const isStudent = ft === "student";
    if (studentProofWrap) studentProofWrap.style.display = isStudent ? "block" : "none";
    if (studentProof) studentProof.required = isStudent;

    refreshUpiPayment();
  }

  const providerBrandColors = {
    gpay: { bg: "#4285f4", text: "#fff" },
    phonepe: { bg: "#5f259f", text: "#fff" },
    paytm: { bg: "#00baf2", text: "#fff" },
    supermoney: { bg: "#6c4cff", text: "#fff" },
    amazonpay: { bg: "#ff9900", text: "#111" }
  };

  function getAppSpecificUpiLink(provider, upiId, amount, note) {
    const isAndroid = /android/i.test(navigator.userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

    const params = new URLSearchParams({
      pa: upiId,
      pn: "Angamaly Marathon 2027",
      am: amount,
      cu: "INR",
      tn: note
    });
    const qs = params.toString();
    const genericUrl = "upi://pay?" + qs;

    if (isAndroid) {
      // Direct package intent for Android Chrome/Webview
      const androidPackages = {
        gpay: "com.google.android.apps.nbu.paisa.user",
        phonepe: "com.phonepe.app",
        paytm: "net.one97.paytm",
        supermoney: "money.super.app",
        amazonpay: "in.amazon.mShop.android.shopping"
      };
      if (androidPackages[provider]) {
        return `intent://pay?${qs}#Intent;scheme=upi;package=${androidPackages[provider]};end;`;
      }
    } else if (isIOS) {
      // iOS URL schemes
      const iosSchemes = {
        gpay: `tez://upi/pay?${qs}`,
        phonepe: `phonepe://pay?${qs}`,
        paytm: `paytmmp://pay?${qs}`,
        supermoney: `supermoney://pay?${qs}`,
        amazonpay: `amazonpay://pay?${qs}`
      };
      if (iosSchemes[provider]) {
        return iosSchemes[provider];
      }
    }

    return genericUrl;
  }

  function refreshUpiPayment() {
    const provider = document.getElementById("paymentProvider")?.value || "gpay";
    const upiId = upiSettings[provider] || "marathon@upi";
    const amount = (sAmount ? sAmount.textContent : "₹650").replace("₹", "");
    const note = `${categoryLabel(category.value)} Reg`;

    const selectedProviderEl = document.getElementById("selectedProviderName");
    const selectedUpiIdEl = document.getElementById("selectedUpiId");
    const payNowBtn = document.getElementById("payNowBtn");
    const payAnyUpiBtn = document.getElementById("payAnyUpiBtn");
    const upiQrImg = document.getElementById("upiQrImg");
    const sheetPay = document.getElementById("sheetPay");

    const pName = providerNames[provider] || provider;
    if (selectedProviderEl) selectedProviderEl.textContent = pName;
    if (selectedUpiIdEl) selectedUpiIdEl.textContent = upiId;
    if (sPay) sPay.textContent = pName;
    if (sheetPay) sheetPay.textContent = pName;

    const specificLink = getAppSpecificUpiLink(provider, upiId, amount, note);
    const genericLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent("Angamaly Marathon 2027")}&am=${encodeURIComponent(amount)}&cu=INR&tn=${encodeURIComponent(note)}`;

    if (payNowBtn) {
      payNowBtn.href = specificLink;
      payNowBtn.innerHTML = `⚡ Open ${pName} & Pay ₹${amount}`;
      const brand = providerBrandColors[provider] || { bg: "#0b66c3", text: "#fff" };
      payNowBtn.style.backgroundColor = brand.bg;
      payNowBtn.style.color = brand.text;
    }

    if (payAnyUpiBtn) {
      payAnyUpiBtn.href = genericLink;
    }

    // Update dynamic QR Code for instant phone camera scanning
    if (upiQrImg) {
      upiQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=2&data=${encodeURIComponent(genericLink)}`;
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
      const wasActive = btn.classList.contains("active");
      document.querySelectorAll(".upi-app-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const providerInput = document.getElementById("paymentProvider");
      if (providerInput) providerInput.value = btn.dataset.provider;
      refreshUpiPayment();

      // If user taps the active app button on mobile, launch that specific app directly!
      if (wasActive && /android|iphone|ipad|ipod/i.test(navigator.userAgent)) {
        const payBtn = document.getElementById("payNowBtn");
        if (payBtn && payBtn.href) {
          window.location.href = payBtn.href;
        }
      }
    });
  });

  // Copy UPI ID to Clipboard
  const copyUpiBtn = document.getElementById("copyUpiBtn");
  copyUpiBtn?.addEventListener("click", () => {
    const upiId = document.getElementById("selectedUpiId")?.textContent || "";
    if (!upiId) return;
    navigator.clipboard.writeText(upiId).then(() => {
      const orig = copyUpiBtn.innerHTML;
      copyUpiBtn.innerHTML = "✓ Copied!";
      copyUpiBtn.style.backgroundColor = "#dcfce7";
      copyUpiBtn.style.color = "#166534";
      setTimeout(() => {
        copyUpiBtn.innerHTML = orig;
        copyUpiBtn.style.backgroundColor = "";
        copyUpiBtn.style.color = "";
      }, 2000);
    }).catch(() => {
      alert("UPI ID: " + upiId);
    });
  });

  // Category Visual Tiles Interaction
  document.querySelectorAll(".cat-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      const selected = tile.dataset.cat;
      if (category) category.value = selected;
      updateSummary();
    });
  });

  // Mobile Hamburger Menu
  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const mobileMenuDrawer = document.getElementById("mobileMenuDrawer");
  if (mobileMenuBtn && mobileMenuDrawer) {
    mobileMenuBtn.addEventListener("click", () => {
      const isOpen = mobileMenuDrawer.classList.toggle("open");
      mobileMenuBtn.classList.toggle("open", isOpen);
    });
    mobileMenuDrawer.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        mobileMenuDrawer.classList.remove("open");
        mobileMenuBtn.classList.remove("open");
      });
    });
  }

  // Mobile Sticky Price Bar Scroll Visibility
  const mobileStickyPriceBar = document.getElementById("mobileStickyPriceBar");
  const registerSection = document.getElementById("register");

  function handleStickyBarVisibility() {
    if (window.innerWidth > 900 || !mobileStickyPriceBar || !registerSection) {
      if (mobileStickyPriceBar) mobileStickyPriceBar.classList.remove("visible");
      return;
    }
    const rect = registerSection.getBoundingClientRect();
    if (rect.top <= window.innerHeight * 0.75 && rect.bottom >= 120) {
      mobileStickyPriceBar.classList.add("visible");
    } else {
      mobileStickyPriceBar.classList.remove("visible");
    }
  }
  window.addEventListener("scroll", handleStickyBarVisibility, { passive: true });
  window.addEventListener("resize", handleStickyBarVisibility, { passive: true });

  // Mobile Breakdown Sheet Toggle
  const breakdownBackdrop = document.getElementById("breakdownBackdrop");
  const breakdownSheet = document.getElementById("breakdownSheet");
  const closeSheetBtn = document.getElementById("closeSheetBtn");
  const sheetPayShortcut = document.getElementById("sheetPayShortcut");

  function openBreakdownSheet() {
    if (breakdownBackdrop) breakdownBackdrop.classList.add("open");
    if (breakdownSheet) breakdownSheet.classList.add("open");
  }

  function closeBreakdownSheet() {
    if (breakdownBackdrop) breakdownBackdrop.classList.remove("open");
    if (breakdownSheet) breakdownSheet.classList.remove("open");
  }

  mobileStickyPriceBar?.addEventListener("click", () => {
    openBreakdownSheet();
  });
  closeSheetBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeBreakdownSheet();
  });
  breakdownBackdrop?.addEventListener("click", closeBreakdownSheet);

  // Stepper Elements and Navigation
  const stepPane1 = document.getElementById("stepPane1");
  const stepPane2 = document.getElementById("stepPane2");
  const stepIndicator1 = document.getElementById("stepIndicator1");
  const stepIndicator2 = document.getElementById("stepIndicator2");
  const stepLine = document.getElementById("stepLine");
  const btnNextToPayment = document.getElementById("btnNextToPayment");
  const btnBackToDetails = document.getElementById("btnBackToDetails");
  const recapRunnerName = document.getElementById("recapRunnerName");

  function validateStep1() {
    if (!stepPane1) return true;
    const requiredInputs = stepPane1.querySelectorAll("input[required], select[required], textarea[required]");
    for (const input of requiredInputs) {
      if (input.offsetParent === null && input.id !== "category") continue;
      if (!input.checkValidity()) {
        input.reportValidity();
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }
    }
    return true;
  }

  function goToStep2() {
    if (!validateStep1()) return;

    const nameVal = document.getElementById("name")?.value.trim() || "Participant";
    const cat = category?.value || "21.1K";
    const ft = feeType?.value || "regular";
    const amount = prices[ft] ? prices[ft][cat] : 650;

    if (recapRunnerName) recapRunnerName.textContent = nameVal;
    const recapCat = document.getElementById("recapCatName");
    if (recapCat) recapCat.textContent = categoryLabel(cat);
    const recapTotal = document.getElementById("recapTotalFee");
    if (recapTotal) recapTotal.textContent = "₹" + amount;

    if (stepPane1) stepPane1.classList.remove("active");
    if (stepPane2) stepPane2.classList.add("active");

    if (stepIndicator1) {
      stepIndicator1.classList.remove("active");
      stepIndicator1.classList.add("completed");
    }
    if (stepIndicator2) {
      stepIndicator2.classList.add("active");
    }
    if (stepLine) {
      stepLine.classList.add("completed");
    }

    document.getElementById("register")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goToStep1() {
    if (stepPane2) stepPane2.classList.remove("active");
    if (stepPane1) stepPane1.classList.add("active");

    if (stepIndicator1) {
      stepIndicator1.classList.remove("completed");
      stepIndicator1.classList.add("active");
    }
    if (stepIndicator2) {
      stepIndicator2.classList.remove("active");
    }
    if (stepLine) {
      stepLine.classList.remove("completed");
    }

    document.getElementById("register")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  btnNextToPayment?.addEventListener("click", goToStep2);
  btnBackToDetails?.addEventListener("click", goToStep1);

  sheetPayShortcut?.addEventListener("click", () => {
    closeBreakdownSheet();
    if (stepPane1 && stepPane1.classList.contains("active")) {
      goToStep2();
    } else {
      const txnInput = document.getElementById("txn");
      if (txnInput) {
        txnInput.scrollIntoView({ behavior: "smooth", block: "center" });
        txnInput.focus();
      }
    }
  });

  // Race Selection Buttons on Landing Cards
  document.querySelectorAll(".race-select-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const selectedRace = btn.dataset.race;
      if (category) category.value = selectedRace;
      updateSummary();
      if (stepPane2 && stepPane2.classList.contains("active")) {
        goToStep1();
      }

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

    // Verify Step 1 validity if somehow bypassed
    if (!validateStep1()) {
      goToStep1();
      return;
    }

    // Verify Step 2 validity
    const step2Inputs = stepPane2?.querySelectorAll("input[required], select[required], textarea[required]") || [];
    for (const input of step2Inputs) {
      if (!input.checkValidity()) {
        input.reportValidity();
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }

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

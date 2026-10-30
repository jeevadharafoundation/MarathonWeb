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
    regular: { "21.1K": 750, "10K": 600, "5K": 350 },
    early: { "21.1K": 700, "10K": 550, "5K": 300 },
    student_group: { "21.1K": 1000, "10K": 1000, "5K": 1000 }
  };
  let earlyBirdDeadline = new Date("2027-01-05T18:00:00+05:30");

  function isEarlyBirdActive() {
    return new Date() < earlyBirdDeadline;
  }

  function getEffectiveFeeType(val) {
    if (val === "individual") {
      return isEarlyBirdActive() ? "early" : "regular";
    }
    if (val === "student_group") {
      return "student_group";
    }
    return val || (isEarlyBirdActive() ? "early" : "regular");
  }

  function formatDeadlineDate(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) return "05 Jan 2027, 6:00 PM IST";
    const day = String(dateObj.getDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[dateObj.getMonth()];
    const year = dateObj.getFullYear();
    let hours = dateObj.getHours();
    const minutes = String(dateObj.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm} IST`;
  }

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
  const studentGroupWrap = document.getElementById("studentGroupWrap");
  const feeHelp = document.getElementById("feeHelp");
  const submitBtn = document.getElementById("submitBtn");
  const statusBanner = document.getElementById("statusBanner");

  let upiSettings = {
    gpay: "qr.jeevadhara@sib",
    phonepe: "qr.jeevadhara@sib",
    paytm: "qr.jeevadhara@sib",
    supermoney: "qr.jeevadhara@sib",
    amazonpay: "qr.jeevadhara@sib"
  };

  const providerNames = {
    gpay: "Google Pay",
    phonepe: "PhonePe",
    paytm: "Paytm",
    supermoney: "SuperMoney",
    amazonpay: "Amazon Pay"
  };

  function getGroupMemberCards() {
    return Array.from(document.querySelectorAll("#studentGroupGrid .group-member-card"));
  }

  function getGroupTotalStudents() {
    const cards = getGroupMemberCards();
    return 1 + (cards.length > 0 ? cards.length : 4);
  }

  function getCurrentPayableAmount() {
    const selFt = feeType ? feeType.value : "individual";
    if (selFt === "student_group") {
      return getGroupTotalStudents() * 200;
    }
    const cat = category ? category.value : "21.1K";
    const effectiveFt = getEffectiveFeeType(selFt);
    return prices[effectiveFt] ? prices[effectiveFt][cat] : 750;
  }

  function categoryLabel(v) {
    return v === "21.1K" ? "Half Marathon – 21.1KM" : v === "10K" ? "Mini Marathon – 10KM" : "Fun Run / Walk – 5KM";
  }

  function feeLabel(v) {
    const effective = getEffectiveFeeType(v);
    if (effective === "early") return "Individual (Early Bird)";
    if (effective === "regular") return "Individual Runner";
    if (effective === "student_group") return `Group of Students (${getGroupTotalStudents()} Students)`;
    return "Individual Runner";
  }

  // ==========================================
  // INPUT VALIDATION & REAL-TIME FEEDBACK HELPERS
  // ==========================================

  function setFieldError(fieldOrId, errorMsg) {
    const el = typeof fieldOrId === "string" ? document.getElementById(fieldOrId) : fieldOrId;
    if (!el) return;
    el.classList.add("is-invalid");

    if (el.id === "declarationCheck") {
      const wrap = document.getElementById("declarationWrap");
      if (wrap) {
        wrap.classList.add("is-invalid");
        let msgEl = wrap.parentElement.querySelector(`.field-error-msg[data-for="${el.id}"]`);
        if (!msgEl) {
          msgEl = document.createElement("span");
          msgEl.className = "field-error-msg";
          msgEl.setAttribute("data-for", el.id);
          wrap.insertAdjacentElement("afterend", msgEl);
        }
        msgEl.textContent = `⚠️ ${errorMsg}`;
        msgEl.style.display = "block";
        return;
      }
    }

    const parent = el.closest(".form-grid > div") || el.closest("#studentProofWrap") || el.parentElement;
    if (parent) {
      let msgEl = parent.querySelector(`.field-error-msg[data-for="${el.id}"]`);
      if (!msgEl) {
        msgEl = document.createElement("span");
        msgEl.className = "field-error-msg";
        msgEl.setAttribute("data-for", el.id);
        parent.appendChild(msgEl);
      }
      msgEl.textContent = `⚠️ ${errorMsg}`;
      msgEl.style.display = "block";
    }
  }

  function clearFieldError(fieldOrId) {
    const el = typeof fieldOrId === "string" ? document.getElementById(fieldOrId) : fieldOrId;
    if (!el) return;
    el.classList.remove("is-invalid");

    if (el.id === "declarationCheck") {
      const wrap = document.getElementById("declarationWrap");
      if (wrap) {
        wrap.classList.remove("is-invalid");
        const msgEl = wrap.parentElement.querySelector(`.field-error-msg[data-for="${el.id}"]`);
        if (msgEl) {
          msgEl.textContent = "";
          msgEl.style.display = "none";
        }
        return;
      }
    }

    const parent = el.closest(".form-grid > div") || el.closest("#studentProofWrap") || el.parentElement;
    if (parent) {
      const msgEl = parent.querySelector(`.field-error-msg[data-for="${el.id}"]`);
      if (msgEl) {
        msgEl.textContent = "";
        msgEl.style.display = "none";
      }
    }
  }

  function cleanPhoneNumber(val) {
    if (!val) return "";
    let cleaned = ("" + val).trim().replace(/[\s\-\(\)\.]/g, "");
    if (cleaned.startsWith("+91")) cleaned = cleaned.slice(3);
    else if (cleaned.startsWith("91") && cleaned.length === 12) cleaned = cleaned.slice(2);
    else if (cleaned.startsWith("0") && cleaned.length === 11) cleaned = cleaned.slice(1);
    return cleaned;
  }

  function isValidPhoneNumber(phone) {
    const cleaned = cleanPhoneNumber(phone);
    if (!/^[6-9]\d{9}$/.test(cleaned)) return false;
    // Reject repeated digits (e.g. 0000000000, 9999999999, 1111111111)
    if (/^(\d)\1{9}$/.test(cleaned)) return false;
    return true;
  }

  function isValidEmail(email) {
    if (!email) return false;
    const trimmed = email.trim();
    const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!re.test(trimmed)) return false;
    const parts = trimmed.split("@");
    if (parts.length !== 2) return false;
    const domainParts = parts[1].split(".");
    const tld = domainParts[domainParts.length - 1];
    return tld.length >= 2;
  }

  function isValidFullName(name) {
    if (!name) return false;
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 80) return false;
    if (!/^[\p{L}\s.'-]+$/u.test(trimmed)) return false;
    const letterCount = (trimmed.match(/\p{L}/gu) || []).length;
    return letterCount >= 2;
  }

  function getMinAgeForCategory(cat) {
    if (cat === "21.1K") return 18;
    if (cat === "10K") return 14;
    return 5;
  }

  function computeAgeOnRaceDay(dobStr) {
    if (!dobStr) return null;
    const parts = dobStr.split("-");
    if (parts.length !== 3) return null;
    const birthYear = parseInt(parts[0], 10);
    const birthMonth = parseInt(parts[1], 10);
    const birthDay = parseInt(parts[2], 10);
    if (isNaN(birthYear) || isNaN(birthMonth) || isNaN(birthDay)) return null;

    let age = 2027 - birthYear;
    if (birthMonth > 1 || (birthMonth === 1 && birthDay > 17)) {
      age--;
    }
    return age;
  }

  function validateName() {
    const el = document.getElementById("name");
    if (!el) return true;
    const val = el.value.trim();
    if (!val) {
      setFieldError(el, "Please enter your full name.");
      return false;
    }
    if (val.length < 3) {
      setFieldError(el, "Full name must be at least 3 characters.");
      return false;
    }
    if (!isValidFullName(val)) {
      setFieldError(el, "Please enter a valid name (letters, spaces, and hyphens only).");
      return false;
    }
    clearFieldError(el);
    return true;
  }

  function validateEmail() {
    const el = document.getElementById("email");
    if (!el) return true;
    const val = el.value.trim();
    if (!val) {
      setFieldError(el, "Please enter your email address.");
      return false;
    }
    if (!isValidEmail(val)) {
      setFieldError(el, "Please enter a valid email address (e.g. name@gmail.com).");
      return false;
    }
    clearFieldError(el);
    return true;
  }

  function validateGender() {
    const el = document.getElementById("gender");
    if (!el) return true;
    if (!el.value) {
      setFieldError(el, "Please select your gender.");
      return false;
    }
    clearFieldError(el);
    return true;
  }

  function updateAndValidateAge() {
    const dobEl = document.getElementById("dob");
    const ageEl = document.getElementById("age");
    if (!dobEl) return true;

    if (!dobEl.value) {
      if (ageEl) ageEl.value = "";
      setFieldError(dobEl, "Please select your date of birth.");
      return false;
    }

    const age = computeAgeOnRaceDay(dobEl.value);
    if (age === null || isNaN(age)) {
      setFieldError(dobEl, "Invalid date of birth format.");
      return false;
    }

    if (age < 0) {
      setFieldError(dobEl, "Date of birth cannot be in the future.");
      if (ageEl) ageEl.value = "";
      return false;
    }

    if (age > 95) {
      setFieldError(dobEl, "Please enter a realistic date of birth.");
      return false;
    }

    if (ageEl) ageEl.value = age;

    const currentCat = category?.value || "21.1K";
    const minAge = getMinAgeForCategory(currentCat);
    if (age < minAge) {
      setFieldError(
        dobEl,
        `Minimum age for ${categoryLabel(currentCat)} is ${minAge} years (calculated age: ${age} on race day).`
      );
      return false;
    }

    clearFieldError(dobEl);
    return true;
  }

  function validatePhone() {
    const el = document.getElementById("phone");
    if (!el) return true;
    const val = el.value.trim();
    if (!val) {
      setFieldError(el, "Please enter your 10-digit mobile number.");
      return false;
    }
    if (!isValidPhoneNumber(val)) {
      setFieldError(el, "Please enter a valid 10-digit Indian mobile number (starts with 6-9).");
      return false;
    }
    clearFieldError(el);
    return true;
  }

  function validateEmergency() {
    const el = document.getElementById("emergency");
    const phoneEl = document.getElementById("phone");
    if (!el) return true;
    const val = el.value.trim();
    if (!val) {
      setFieldError(el, "Please enter an emergency contact number.");
      return false;
    }
    if (!isValidPhoneNumber(val)) {
      setFieldError(el, "Please enter a valid 10-digit emergency contact number (starts with 6-9).");
      return false;
    }

    const cleanP = cleanPhoneNumber(phoneEl?.value || "");
    const cleanE = cleanPhoneNumber(val);
    if (cleanP && cleanE && cleanP === cleanE) {
      setFieldError(el, "Emergency contact must be a different number from runner's phone number.");
      return false;
    }

    clearFieldError(el);
    return true;
  }

  function validateBlood() {
    const el = document.getElementById("blood");
    if (!el) return true;
    if (!el.value) {
      setFieldError(el, "Please select your blood group.");
      return false;
    }
    clearFieldError(el);
    return true;
  }

  function validateAddress() {
    const el = document.getElementById("address");
    if (!el) return true;
    const val = el.value.trim();
    if (!val) {
      setFieldError(el, "Please enter your residential address.");
      return false;
    }
    if (val.length < 10) {
      setFieldError(el, "Please enter a complete residential address (minimum 10 characters).");
      return false;
    }
    if (!/\p{L}/u.test(val)) {
      setFieldError(el, "Address must contain valid words/letters.");
      return false;
    }
    clearFieldError(el);
    return true;
  }

  function validateSource() {
    const el = document.getElementById("source");
    if (!el) return true;
    if (!el.value) {
      setFieldError(el, "Please select how you heard about Angamaly Marathon.");
      return false;
    }
    clearFieldError(el);
    return true;
  }

  function validateShirt() {
    const el = document.getElementById("shirt");
    if (!el) return true;
    if (!el.value) {
      setFieldError(el, "Please select a T-shirt size.");
      return false;
    }
    clearFieldError(el);
    return true;
  }

  function validateStudentProof() {
    if (feeType?.value !== "student_group") return true;
    const el = document.getElementById("studentProof");
    if (!el) return true;
    const file = el.files?.[0];
    if (!file) {
      setFieldError(el, "Please upload Student ID proof for Applicant #1.");
      return false;
    }
    const MAX_STUDENT_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_STUDENT_SIZE) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      setFieldError(el, `Student ID proof exceeds 5 MB limit (selected: ${sizeMb} MB).`);
      return false;
    }
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
    if (!allowed.includes(ext) && !file.type.startsWith("image/") && file.type !== "application/pdf") {
      setFieldError(el, "Allowed formats for student proof: JPG, PNG, WebP or PDF.");
      return false;
    }
    clearFieldError(el);
    return true;
  }

  function createMemberCardHtml(index) {
    return `
      <div class="group-member-card" data-member-index="${index}">
        <div class="member-header">
          <span class="member-num-badge">Student #${index}</span>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="member-role">Team Member</span>
            <button type="button" class="member-remove-btn" title="Remove Student #${index}">✕ Remove</button>
          </div>
        </div>
        <div class="form-grid member-grid">
          <div>
            <label for="groupMemberName_${index}">Full Name *</label>
            <input type="text" id="groupMemberName_${index}" class="group-member-name" placeholder="Enter full name" maxlength="80">
          </div>
          <div>
            <label for="groupMemberPhone_${index}">Mobile (WhatsApp) *</label>
            <input type="tel" id="groupMemberPhone_${index}" class="group-member-phone" placeholder="10-digit mobile" maxlength="14" inputmode="tel">
          </div>
          <div>
            <label for="groupMemberShirt_${index}">T-Shirt Size *</label>
            <select id="groupMemberShirt_${index}" class="group-member-shirt">
              <option value="" selected disabled>Select size</option><option>XS / 34</option><option>S / 36</option><option>M / 38</option><option>L / 40</option><option>XL / 42</option><option>XXL / 44</option>
            </select>
          </div>
        </div>
      </div>
    `;
  }

  function updateMemberRemoveButtons() {
    const cards = getGroupMemberCards();
    cards.forEach((card) => {
      let removeBtn = card.querySelector(".member-remove-btn");
      if (cards.length > 4) {
        if (!removeBtn) {
          removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "member-remove-btn";
          removeBtn.innerHTML = "✕ Remove";
          removeBtn.title = "Remove this student";
          let header = card.querySelector(".member-header");
          let rightWrap = header?.querySelector("div");
          if (!rightWrap && header) {
            rightWrap = document.createElement("div");
            rightWrap.style.cssText = "display:flex;align-items:center;gap:10px";
            const role = header.querySelector(".member-role");
            if (role) rightWrap.appendChild(role);
            header.appendChild(rightWrap);
          }
          rightWrap?.appendChild(removeBtn);
          removeBtn.addEventListener("click", () => removeMemberCard(card));
        } else {
          removeBtn.style.display = "inline-flex";
        }
      } else {
        if (removeBtn) {
          removeBtn.style.display = "none";
        }
      }
    });
  }

  function reindexGroupMembers() {
    const cards = getGroupMemberCards();
    cards.forEach((card, idx) => {
      const mIdx = idx + 2;
      card.setAttribute("data-member-index", mIdx);
      const badge = card.querySelector(".member-num-badge");
      if (badge) badge.textContent = `Student #${mIdx}`;

      const nameInput = card.querySelector(".group-member-name");
      const phoneInput = card.querySelector(".group-member-phone");
      const shirtSelect = card.querySelector(".group-member-shirt");

      if (nameInput) {
        nameInput.id = `groupMemberName_${mIdx}`;
        const label = card.querySelector(`label[for^="groupMemberName"]`);
        if (label) label.setAttribute("for", `groupMemberName_${mIdx}`);
      }
      if (phoneInput) {
        phoneInput.id = `groupMemberPhone_${mIdx}`;
        const label = card.querySelector(`label[for^="groupMemberPhone"]`);
        if (label) label.setAttribute("for", `groupMemberPhone_${mIdx}`);
      }
      if (shirtSelect) {
        shirtSelect.id = `groupMemberShirt_${mIdx}`;
        const label = card.querySelector(`label[for^="groupMemberShirt"]`);
        if (label) label.setAttribute("for", `groupMemberShirt_${mIdx}`);
      }
    });

    updateMemberRemoveButtons();
    updateSummary();
  }

  function attachMemberCardListeners(card) {
    const nEl = card.querySelector(".group-member-name");
    const pEl = card.querySelector(".group-member-phone");
    const sEl = card.querySelector(".group-member-shirt");
    const rBtn = card.querySelector(".member-remove-btn");

    if (nEl) {
      nEl.addEventListener("input", () => clearFieldError(nEl));
      nEl.addEventListener("blur", () => {
        if (feeType?.value === "student_group") {
          const val = nEl.value.trim();
          const mIdx = card.getAttribute("data-member-index") || "Member";
          if (!val) setFieldError(nEl, `Please enter full name for Student #${mIdx}.`);
          else if (val.length < 3) setFieldError(nEl, `Full name for Student #${mIdx} must be at least 3 characters.`);
          else if (!isValidFullName(val)) setFieldError(nEl, `Student #${mIdx} name must contain valid letters and spaces.`);
          else clearFieldError(nEl);
        }
      });
    }

    if (pEl) {
      pEl.addEventListener("input", () => clearFieldError(pEl));
      pEl.addEventListener("blur", () => {
        if (feeType?.value === "student_group") {
          const val = pEl.value.trim();
          const mIdx = card.getAttribute("data-member-index") || "Member";
          if (!val) setFieldError(pEl, `Please enter 10-digit mobile number for Student #${mIdx}.`);
          else if (!isValidPhoneNumber(val)) setFieldError(pEl, `Please enter a valid 10-digit Indian mobile number for Student #${mIdx}.`);
          else clearFieldError(pEl);
        }
      });
    }

    if (sEl) {
      sEl.addEventListener("change", () => clearFieldError(sEl));
    }

    if (rBtn) {
      rBtn.addEventListener("click", () => removeMemberCard(card));
    }
  }

  function addMemberCard() {
    const grid = document.getElementById("studentGroupGrid");
    if (!grid) return;
    const currentCount = getGroupMemberCards().length;
    const nextIdx = currentCount + 2; // Member #1 is Team Leader
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = createMemberCardHtml(nextIdx).trim();
    const newCard = tempDiv.firstElementChild;
    grid.appendChild(newCard);
    attachMemberCardListeners(newCard);
    reindexGroupMembers();
    newCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function removeMemberCard(card) {
    const cards = getGroupMemberCards();
    if (cards.length <= 4) {
      alert("Group registration requires a minimum of 5 students (1 Team Leader + 4 accompanying students).");
      return;
    }
    card.remove();
    reindexGroupMembers();
  }

  function validateGroupMembers() {
    if (feeType?.value !== "student_group") return { valid: true, firstInvalid: null };
    const cards = getGroupMemberCards();
    if (cards.length < 4) {
      alert("Group registration requires a minimum of 5 students (1 Team Leader + at least 4 accompanying students).");
      return { valid: false, firstInvalid: null };
    }
    let isValid = true;
    let firstInvalidEl = null;

    cards.forEach((card) => {
      const mIdx = card.getAttribute("data-member-index") || "Member";
      const nameEl = card.querySelector(".group-member-name");
      const phoneEl = card.querySelector(".group-member-phone");
      const shirtEl = card.querySelector(".group-member-shirt");

      if (nameEl) {
        const val = nameEl.value.trim();
        if (!val) {
          setFieldError(nameEl, `Please enter full name for Student #${mIdx}.`);
          isValid = false;
          if (!firstInvalidEl) firstInvalidEl = nameEl;
        } else if (val.length < 3) {
          setFieldError(nameEl, `Full name for Student #${mIdx} must be at least 3 characters.`);
          isValid = false;
          if (!firstInvalidEl) firstInvalidEl = nameEl;
        } else if (!isValidFullName(val)) {
          setFieldError(nameEl, `Student #${mIdx} name must contain valid letters and spaces.`);
          isValid = false;
          if (!firstInvalidEl) firstInvalidEl = nameEl;
        } else {
          clearFieldError(nameEl);
        }
      }

      if (phoneEl) {
        const val = phoneEl.value.trim();
        if (!val) {
          setFieldError(phoneEl, `Please enter 10-digit mobile number for Student #${mIdx}.`);
          isValid = false;
          if (!firstInvalidEl) firstInvalidEl = phoneEl;
        } else if (!isValidPhoneNumber(val)) {
          setFieldError(phoneEl, `Please enter a valid 10-digit Indian mobile number for Student #${mIdx}.`);
          isValid = false;
          if (!firstInvalidEl) firstInvalidEl = phoneEl;
        } else {
          clearFieldError(phoneEl);
        }
      }

      if (shirtEl) {
        if (!shirtEl.value) {
          setFieldError(shirtEl, `Please select T-shirt size for Student #${mIdx}.`);
          isValid = false;
          if (!firstInvalidEl) firstInvalidEl = shirtEl;
        } else {
          clearFieldError(shirtEl);
        }
      }
    });

    return { valid: isValid, firstInvalid: firstInvalidEl };
  }

  function validatePaymentProof() {
    const el = document.getElementById("paymentProof");
    if (!el) return true;
    const file = el.files?.[0];
    if (!file) {
      setFieldError(el, "Please upload your payment screenshot / receipt.");
      return false;
    }
    const check = validatePaymentProofFile(file);
    if (!check.valid) {
      setFieldError(el, check.error);
      return false;
    }
    clearFieldError(el);
    return true;
  }

  function validateDeclaration() {
    const el = document.getElementById("declarationCheck");
    if (!el) return true;
    if (!el.checked) {
      setFieldError(el, "Please accept the participant declaration to proceed.");
      return false;
    }
    clearFieldError(el);
    return true;
  }

  function updateSummary() {
    const cat = category.value;
    const selFt = feeType.value; // "individual", "student_group"
    const effectiveFt = getEffectiveFeeType(selFt);
    const amount = getCurrentPayableAmount();

    // Baseline non-discounted comparison for strikethrough cutoff
    let baselineAmount = prices["regular"] ? prices["regular"][cat] : 750;
    if (selFt === "student_group") {
      baselineAmount = amount;
    }
    const hasDiscount = isEarlyBirdActive() && baselineAmount > amount;
    const discountDiff = baselineAmount - amount;

    // Desktop Summary Elements
    if (sCategory) sCategory.textContent = categoryLabel(cat);
    if (sFeeType) sFeeType.textContent = feeLabel(selFt);
    if (sShirt) sShirt.textContent = shirt.value || "—";

    if (sAmount) {
      if (hasDiscount) {
        sAmount.innerHTML = `<span class="price-strikethrough" style="font-size:16px;color:#cbd9ef;margin-right:6px">₹${baselineAmount}</span><span class="price-actual">₹${amount}</span>`;
      } else {
        sAmount.textContent = "₹" + amount;
      }
    }
    const sDiscountCallout = document.getElementById("sDiscountCallout");
    if (sDiscountCallout) {
      if (hasDiscount) {
        sDiscountCallout.style.display = "block";
        sDiscountCallout.textContent = `⚡ Early Bird Applied: Save ₹${discountDiff}!`;
      } else {
        sDiscountCallout.style.display = "none";
      }
    }
    if (upiAmount) upiAmount.textContent = "₹" + amount;

    // Visual Category Tiles Sync
    ["21.1K", "10K", "5K"].forEach((c) => {
      const tileId = c === "21.1K" ? "tilePrice21" : c === "10K" ? "tilePrice10" : "tilePrice5";
      const tEl = document.getElementById(tileId);
      if (tEl) {
        const curP = selFt === "student_group" ? amount : (prices[effectiveFt] ? prices[effectiveFt][c] : 750);
        let baseP = prices["regular"] ? prices["regular"][c] : 750;
        if (selFt === "student_group") {
          baseP = amount;
        }
        if (isEarlyBirdActive() && baseP > curP) {
          tEl.innerHTML = `<span class="price-strikethrough">₹${baseP}</span><span class="price-actual">₹${curP}</span>`;
        } else {
          tEl.textContent = "₹" + curP;
        }
      }
    });

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
    if (mStickyFee) mStickyFee.textContent = feeLabel(selFt) + " Registration";
    const mStickyAmount = document.getElementById("mStickyAmount");
    if (mStickyAmount) {
      if (hasDiscount) {
        mStickyAmount.innerHTML = `<span style="font-size:15px;color:#cbd9ef;text-decoration:line-through;margin-right:6px">₹${baselineAmount}</span><span>₹${amount}</span>`;
      } else {
        mStickyAmount.textContent = "₹" + amount;
      }
      // Price Pulse Animation
      mStickyAmount.classList.remove("price-pulse");
      void mStickyAmount.offsetWidth;
      mStickyAmount.classList.add("price-pulse");
    }

    // Mobile Breakdown Sheet Sync
    const sheetCat = document.getElementById("sheetCategory");
    if (sheetCat) sheetCat.textContent = categoryLabel(cat);
    const sheetFee = document.getElementById("sheetFee");
    if (sheetFee) sheetFee.textContent = feeLabel(selFt);
    const sheetShirt = document.getElementById("sheetShirt");
    if (sheetShirt) sheetShirt.textContent = shirt.value || "—";
    const sheetAmount = document.getElementById("sheetAmount");
    if (sheetAmount) {
      if (hasDiscount) {
        sheetAmount.innerHTML = `<span style="font-size:14px;color:#94a3b8;text-decoration:line-through;margin-right:6px">₹${baselineAmount}</span><span>₹${amount}</span>`;
      } else {
        sheetAmount.textContent = "₹" + amount;
      }
    }

    // Step 2 Recap Strip Sync
    const recapCatName = document.getElementById("recapCatName");
    if (recapCatName) recapCatName.textContent = categoryLabel(cat);
    const recapTotalFee = document.getElementById("recapTotalFee");
    if (recapTotalFee) {
      if (hasDiscount) {
        recapTotalFee.innerHTML = `<span style="font-size:14px;color:#888;text-decoration:line-through;margin-right:6px">₹${baselineAmount}</span><span>₹${amount}</span>`;
      } else {
        recapTotalFee.textContent = "₹" + amount;
      }
    }

    const isStudent = selFt === "student_group";
    if (studentProofWrap) studentProofWrap.style.display = isStudent ? "block" : "none";
    if (studentProof) {
      studentProof.required = isStudent;
      if (!isStudent) clearFieldError(studentProof);
    }

    const isGroup = selFt === "student_group";
    if (studentGroupWrap) studentGroupWrap.style.display = isGroup ? "block" : "none";
    const groupFeeBadge = document.getElementById("groupFeeBadge");
    if (groupFeeBadge && isGroup) {
      const totalStudents = getGroupTotalStudents();
      groupFeeBadge.textContent = `${totalStudents} Students • Total ₹${amount.toLocaleString("en-IN")}`;
    }
    if (!isGroup) {
      getGroupMemberCards().forEach((c) => {
        const nEl = c.querySelector(".group-member-name");
        const pEl = c.querySelector(".group-member-phone");
        const sEl = c.querySelector(".group-member-shirt");
        if (nEl) clearFieldError(nEl);
        if (pEl) clearFieldError(pEl);
        if (sEl) clearFieldError(sEl);
      });
    }

    refreshUpiPayment();

    const dobEl = document.getElementById("dob");
    if (dobEl && dobEl.value) {
      updateAndValidateAge();
    }
  }

  const providerBrandColors = {
    gpay: { bg: "#4285f4", text: "#fff" },
    phonepe: { bg: "#5f259f", text: "#fff" },
    paytm: { bg: "#00baf2", text: "#fff" },
    supermoney: { bg: "#6c4cff", text: "#fff" },
    amazonpay: { bg: "#ff9900", text: "#111" }
  };

  // Official South Indian Bank merchant QR parameters for qr.jeevadhara@sib
  const BANK_UPI_PARAMS = {
    pn: "JEEVADHARA RENAL CARE FOUNDATION",
    rawQrPn: "JEEVADHARA%RENAL%CARE%FOUNDATION",
    mc: "8398",
    cu: "INR",
    orgid: "159059",
    mode: "02",
    sign: "MEUCIQDu5Pm9O2JXlvlBMpB+Fbq1sp6fQgxM8fXmcSPooa+UbAIgQMNLKlU8QMcxrg8OqW6EC7wTKlRaW5S4aEyzy9uE+OI="
  };

  function buildExactAmountQrPayload(upiId, amount) {
    return `upi://pay?pa=${String(upiId || "qr.jeevadhara@sib").trim()}&pn=${BANK_UPI_PARAMS.rawQrPn}&mc=${BANK_UPI_PARAMS.mc}&cu=${BANK_UPI_PARAMS.cu}&orgid=${BANK_UPI_PARAMS.orgid}&mode=${BANK_UPI_PARAMS.mode}&am=${amount}&sign=${BANK_UPI_PARAMS.sign}`;
  }

  let isCheckoutInFlight = false;
  let activePollingTimer = null;

  function refreshUpiPayment() {
    const numAmount = getCurrentPayableAmount();
    const amount = String(numAmount);

    const selectedProviderEl = document.getElementById("selectedProviderName");
    const sheetPay = document.getElementById("sheetPay");

    if (selectedProviderEl) selectedProviderEl.textContent = "Razorpay Verified Checkout";
    if (sPay) sPay.textContent = "Razorpay Online";
    if (sheetPay) sheetPay.textContent = "Razorpay Online";
    if (upiAmount) upiAmount.textContent = "₹" + amount;

    if (submitBtn && !isCheckoutInFlight) {
      submitBtn.innerHTML = `🔒 Pay ₹${amount} & Confirm Registration`;
    }
  }

  function updateDeadlineNoticeText() {
    const noticeDateEl = document.getElementById("sDeadlineDateText");
    if (noticeDateEl) {
      noticeDateEl.textContent = formatDeadlineDate(earlyBirdDeadline);
    }
    const noticeEl = document.getElementById("sDeadlineNotice");
    if (noticeEl) {
      if (isEarlyBirdActive()) {
        noticeEl.innerHTML = `Early Bird rates apply until <strong id="sDeadlineDateText">${formatDeadlineDate(earlyBirdDeadline)}</strong>. Valid Student ID required for student group discount.`;
      } else {
        noticeEl.innerHTML = `Standard registration rates are active. Valid Student ID required for student group discount.`;
      }
    }
  }

  function updateFeeTypeOptionLabels() {
    if (!feeType) return;
    const isEarly = isEarlyBirdActive();
    const indOpt = feeType.querySelector('option[value="individual"]');
    if (indOpt) {
      indOpt.textContent = isEarly
        ? "Individual Runner (Early Bird Offer)"
        : "Individual Runner";
    }
    const grpOpt = feeType.querySelector('option[value="student_group"]');
    if (grpOpt) {
      grpOpt.textContent = "Group of Students – Min 5 Students (₹200 per student)";
    }
    // Home page race cards: highlight Early Bird price while active
    document.querySelectorAll(".race-price").forEach((el) => {
      const reg = el.dataset.regular, early = el.dataset.early;
      el.innerHTML = isEarly
        ? `<span class="eb-tag">Early Bird</span><span class="eb-price">₹${early}</span><span class="old">₹${reg}</span>`
        : `₹${reg}`;
    });
    if (feeHelp) {
      feeHelp.textContent = isEarly
        ? `⚡ Early Bird discount is automatically applied (valid until ${formatDeadlineDate(earlyBirdDeadline)})!`
        : "Standard registration rates are active.";
    }
  }

  // Fetch Live Event Settings (UPI & Early Bird Deadline) from Supabase
  async function loadSettings() {
    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/event_settings?select=key,value`, {
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          data.forEach((item) => {
            if (item.key === "upi_config" && item.value) {
              upiSettings = { ...upiSettings, ...item.value };
            }
            if (item.key === "event_info" && item.value && item.value.early_bird_deadline) {
              earlyBirdDeadline = new Date(item.value.early_bird_deadline);
            }
          });
          updateDeadlineNoticeText();
          updateFeeTypeOptionLabels();
          updateSummary();
          refreshUpiPayment();
        }
      }
    } catch (err) {
      console.warn("Using offline event settings defaults:", err);
    }
  }

  // Event Listeners for UI
  category?.addEventListener("change", updateSummary);
  feeType?.addEventListener("change", updateSummary);
  shirt?.addEventListener("change", updateSummary);

  // Date of birth calculation and real-time validation
  const dobInput = document.getElementById("dob");
  dobInput?.addEventListener("input", updateAndValidateAge);
  dobInput?.addEventListener("change", updateAndValidateAge);
  dobInput?.addEventListener("blur", updateAndValidateAge);

  // Real-time error clearing and field blur listeners
  ["name", "email", "gender", "blood", "address", "source", "shirt", "studentProof"].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => clearFieldError(el));
    el?.addEventListener("change", () => clearFieldError(el));
  });

  const phoneEl = document.getElementById("phone");
  const emergencyEl = document.getElementById("emergency");
  phoneEl?.addEventListener("input", () => {
    clearFieldError(phoneEl);
    if (emergencyEl && emergencyEl.value.trim()) {
      const cP = cleanPhoneNumber(phoneEl.value);
      const cE = cleanPhoneNumber(emergencyEl.value);
      if (cP && cE && cP !== cE) {
        clearFieldError(emergencyEl);
      }
    }
  });
  emergencyEl?.addEventListener("input", () => {
    clearFieldError(emergencyEl);
  });

  document.getElementById("name")?.addEventListener("blur", validateName);
  document.getElementById("email")?.addEventListener("blur", validateEmail);
  phoneEl?.addEventListener("blur", validatePhone);
  emergencyEl?.addEventListener("blur", validateEmergency);
  document.getElementById("address")?.addEventListener("blur", validateAddress);

  // Initialize dynamic group member cards, button and listeners
  getGroupMemberCards().forEach((card) => attachMemberCardListeners(card));
  updateMemberRemoveButtons();
  document.getElementById("btnAddGroupMember")?.addEventListener("click", addMemberCard);

  const declarationCheckEl = document.getElementById("declarationCheck");
  declarationCheckEl?.addEventListener("change", function () {
    if (this.checked) clearFieldError(this);
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

  // Download Exact-Amount Dynamic QR Code Card for Mobile Gallery Scan
  const downloadQrBtn = document.getElementById("downloadQrBtn");
  downloadQrBtn?.addEventListener("click", async () => {
    const provider = document.getElementById("paymentProvider")?.value || "gpay";
    const upiId = upiSettings[provider] || "qr.jeevadhara@sib";
    const amount = String(getCurrentPayableAmount());
    const catVal = category ? category.value : "21.1K";
    const qrPayload = buildExactAmountQrPayload(upiId, amount);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=2&data=${encodeURIComponent(qrPayload)}`;

    const origText = downloadQrBtn.innerHTML;
    downloadQrBtn.disabled = true;
    downloadQrBtn.innerHTML = "⏳ Saving QR Code...";

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = qrUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 800;
      const ctx = canvas.getContext("2d");

      // White card background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Top brand header
      ctx.fillStyle = "#062e68";
      ctx.fillRect(0, 0, canvas.width, 115);

      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.font = "bold 26px system-ui, -apple-system, sans-serif";
      ctx.fillText("ANGAMALY MARATHON 2027", canvas.width / 2, 52);

      ctx.fillStyle = "#93c5fd";
      ctx.font = "bold 17px system-ui, -apple-system, sans-serif";
      ctx.fillText("JEEVADHARA RENAL CARE FOUNDATION", canvas.width / 2, 86);

      // Amount Pill
      ctx.fillStyle = "#eef5ff";
      ctx.fillRect(90, 140, 460, 72);
      ctx.strokeStyle = "#bfd7f5";
      ctx.lineWidth = 2;
      ctx.strokeRect(90, 140, 460, 72);

      ctx.fillStyle = "#0b66c3";
      ctx.font = "bold 30px system-ui, -apple-system, sans-serif";
      ctx.fillText(`Pay ₹${amount}  •  ${catVal}`, canvas.width / 2, 186);

      // QR Code in center with clean quiet zone
      ctx.drawImage(img, 110, 235, 420, 420);

      // Footer instructions
      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 18px monospace";
      ctx.fillText(`UPI ID: ${upiId}`, canvas.width / 2, 695);

      ctx.fillStyle = "#475569";
      ctx.font = "600 15px system-ui, -apple-system, sans-serif";
      ctx.fillText("Open GPay / PhonePe / Paytm → Scan QR → Upload from Gallery", canvas.width / 2, 735);

      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `Angamaly-Marathon-QR-Rs${amount}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      downloadQrBtn.innerHTML = `✓ Saved ₹${amount} QR to Phone!`;
      setTimeout(() => {
        downloadQrBtn.disabled = false;
        refreshUpiPayment();
      }, 2500);
    } catch (err) {
      // Fallback: open QR image directly so user can long-press / save
      window.open(qrUrl, "_blank");
      downloadQrBtn.disabled = false;
      downloadQrBtn.innerHTML = origText;
    }
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
    const vName = validateName();
    const vEmail = validateEmail();
    const vGender = validateGender();
    const vAge = updateAndValidateAge();
    const vPhone = validatePhone();
    const vEmerg = validateEmergency();
    const vBlood = validateBlood();
    const vAddress = validateAddress();
    const vSource = validateSource();
    const vShirt = validateShirt();
    const vStudent = validateStudentProof();
    const groupCheck = validateGroupMembers();

    const fieldsInOrder = [
      { valid: vName, el: document.getElementById("name") },
      { valid: vEmail, el: document.getElementById("email") },
      { valid: vGender, el: document.getElementById("gender") },
      { valid: vAge, el: document.getElementById("dob") },
      { valid: vPhone, el: document.getElementById("phone") },
      { valid: vEmerg, el: document.getElementById("emergency") },
      { valid: vBlood, el: document.getElementById("blood") },
      { valid: vAddress, el: document.getElementById("address") },
      { valid: vSource, el: document.getElementById("source") },
      { valid: vShirt, el: document.getElementById("shirt") },
      { valid: vStudent, el: document.getElementById("studentProof") },
      { valid: groupCheck.valid, el: groupCheck.firstInvalid }
    ];

    const firstInvalid = fieldsInOrder.find((f) => !f.valid);
    if (firstInvalid && firstInvalid.el) {
      firstInvalid.el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        try { firstInvalid.el.focus(); } catch (e) {}
      }, 250);
      return false;
    }

    return true;
  }

  function validateStep2() {
    const vDecl = validateDeclaration();
    if (!vDecl) {
      const declEl = document.getElementById("declarationCheck");
      if (declEl) {
        declEl.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          try { declEl.focus(); } catch (e) {}
        }, 250);
      }
      return false;
    }
    return true;
  }

  function goToStep2() {
    if (!validateStep1()) return;

    const nameVal = document.getElementById("name")?.value.trim() || "Participant";
    const cat = category?.value || "21.1K";
    const selFt = feeType?.value || "individual";
    const amount = getCurrentPayableAmount();
    let baselineAmount = selFt === "student_group" ? amount : (prices["regular"] ? prices["regular"][cat] : 750);
    const hasDiscount = isEarlyBirdActive() && baselineAmount > amount;

    if (recapRunnerName) recapRunnerName.textContent = nameVal;
    const recapCat = document.getElementById("recapCatName");
    if (recapCat) recapCat.textContent = categoryLabel(cat);
    const recapTotal = document.getElementById("recapTotalFee");
    if (recapTotal) {
      if (hasDiscount) {
        recapTotal.innerHTML = `<span style="font-size:14px;color:#888;text-decoration:line-through;margin-right:6px">₹${baselineAmount}</span><span>₹${amount}</span>`;
      } else {
        recapTotal.textContent = "₹" + amount;
      }
    }

    if (stepPane1) stepPane1.classList.remove("active");
    if (stepPane2) stepPane2.classList.add("active");
    refreshUpiPayment();

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
      submitBtn?.scrollIntoView({ behavior: "smooth", block: "center" });
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

  // Helper to upload a file to Cloudflare R2 (used for Student ID Proof)
  async function uploadToR2(file, folder = "student-proofs") {
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

  // ==========================================
  // RAZORPAY CHECKOUT, IDEMPOTENCY & RECOVERY
  // ==========================================

  const ACTIVE_CHECKOUT_STORAGE_KEY = "am27_active_checkout";
  const paymentRecoveryBanner = document.getElementById("paymentRecoveryBanner");
  const recoveryBannerTitle = document.getElementById("recoveryBannerTitle");
  const recoveryBannerMsg = document.getElementById("recoveryBannerMsg");
  const recoveryBannerMeta = document.getElementById("recoveryBannerMeta");
  const btnCheckPaymentStatus = document.getElementById("btnCheckPaymentStatus");
  const btnClearPendingSession = document.getElementById("btnClearPendingSession");

  function loadActiveCheckoutSession() {
    try {
      const raw = localStorage.getItem(ACTIVE_CHECKOUT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.regId) return null;
      // Expire local session after 24 hours
      if (parsed.createdAt && Date.now() - parsed.createdAt > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(ACTIVE_CHECKOUT_STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function saveActiveCheckoutSession(sessionObj) {
    try {
      localStorage.setItem(ACTIVE_CHECKOUT_STORAGE_KEY, JSON.stringify({
        ...sessionObj,
        createdAt: sessionObj.createdAt || Date.now()
      }));
    } catch (_) {}
  }

  function clearActiveCheckoutSession() {
    try {
      localStorage.removeItem(ACTIVE_CHECKOUT_STORAGE_KEY);
    } catch (_) {}
    if (activePollingTimer) {
      clearTimeout(activePollingTimer);
      activePollingTimer = null;
    }
    if (paymentRecoveryBanner) {
      paymentRecoveryBanner.style.display = "none";
    }
  }

  function generateUUID() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "am27-" + Date.now() + "-" + Math.random().toString(36).slice(2, 11);
  }

  /**
   * Returns a stable idempotency key & existing regId if the runner retries with
   * the same category, feeType, student count, email, and phone.
   */
  function getCheckoutIdempotencyContext(currentContext) {
    const existing = loadActiveCheckoutSession();
    if (
      existing &&
      existing.idempotencyKey &&
      existing.email === currentContext.email &&
      existing.phone === currentContext.phone &&
      existing.category === currentContext.category &&
      existing.feeType === currentContext.feeType &&
      existing.studentCount === currentContext.studentCount
    ) {
      return {
        idempotencyKey: existing.idempotencyKey,
        regId: existing.regId || null,
        studentProofUrl: existing.studentProofUrl || null
      };
    }
    return {
      idempotencyKey: generateUUID(),
      regId: null,
      studentProofUrl: null
    };
  }

  function showRecoveryBanner({ title, message, meta, variant = "warning" }) {
    if (!paymentRecoveryBanner) return;
    paymentRecoveryBanner.style.display = "block";
    if (variant === "error") {
      paymentRecoveryBanner.style.background = "#fef2f2";
      paymentRecoveryBanner.style.borderColor = "#f87171";
      if (recoveryBannerTitle) recoveryBannerTitle.style.color = "#991b1b";
      if (recoveryBannerMsg) recoveryBannerMsg.style.color = "#7f1d1d";
    } else if (variant === "success") {
      paymentRecoveryBanner.style.background = "#f0fdf4";
      paymentRecoveryBanner.style.borderColor = "#4ade80";
      if (recoveryBannerTitle) recoveryBannerTitle.style.color = "#166534";
      if (recoveryBannerMsg) recoveryBannerMsg.style.color = "#14532d";
    } else {
      paymentRecoveryBanner.style.background = "#fffbeb";
      paymentRecoveryBanner.style.borderColor = "#f59e0b";
      if (recoveryBannerTitle) recoveryBannerTitle.style.color = "#92400e";
      if (recoveryBannerMsg) recoveryBannerMsg.style.color = "#78350f";
    }
    if (recoveryBannerTitle) recoveryBannerTitle.textContent = title;
    if (recoveryBannerMsg) recoveryBannerMsg.innerHTML = message;
    if (recoveryBannerMeta) recoveryBannerMeta.textContent = meta || "";
  }

  function redirectToConfirmation(registrationRecord) {
    clearActiveCheckoutSession();
    try {
      sessionStorage.setItem("lastRegistration", JSON.stringify(registrationRecord));
    } catch (_) {}
    const codeParam = encodeURIComponent(registrationRecord?.reg_code || "");
    const idParam = encodeURIComponent(registrationRecord?.id || "");
    window.location.href = `confirmation.html?code=${codeParam}&id=${idParam}`;
  }

  /**
   * Queries /api/razorpay/payment-status to reconcile with Razorpay server-side.
   */
  async function checkOrderPaymentStatus(regId, orderId, { silent = false } = {}) {
    if (!regId && !orderId) return null;
    if (!silent && btnCheckPaymentStatus) {
      btnCheckPaymentStatus.disabled = true;
      btnCheckPaymentStatus.textContent = "⏳ Checking with Razorpay...";
    }
    try {
      const endpoint = cfg.RAZORPAY_STATUS_ENDPOINT || "/api/razorpay/payment-status";
      const qs = new URLSearchParams();
      if (regId) qs.set("reg_id", regId);
      if (orderId) qs.set("order_id", orderId);

      const res = await fetch(`${endpoint}?${qs.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (!silent) {
          setStatus(`⚠️ Could not check status right now (${data.error || "Network error"}). Please try again in a few seconds.`, "error");
        }
        return null;
      }

      if (data.verified && data.registration) {
        showRecoveryBanner({
          title: "✅ Payment Confirmed & Bib Assigned!",
          message: `Your payment has been verified! Assigning Bib <strong>#${data.registration.bib_number || "Assigned"}</strong> and redirecting to your confirmation slip...`,
          meta: `Ref: ${data.registration.reg_code || ""} • Order: ${data.registration.razorpay_order_id || ""}`,
          variant: "success"
        });
        setStatus("✅ <strong>Payment Confirmed!</strong> Redirecting to your official confirmation receipt...", "info");
        setTimeout(() => redirectToConfirmation(data.registration), 700);
        return data;
      }

      const st = data.status || "created";
      const regCode = data.registration?.reg_code || "";
      const ordId = data.registration?.razorpay_order_id || orderId || "";

      if (st === "pending" || st === "authorized") {
        showRecoveryBanner({
          title: "⏳ Payment Verification in Progress",
          message: "Your payment is being processed by your bank / UPI app. <strong>Please do not pay again</strong> while verification is underway. We are automatically checking with Razorpay.",
          meta: `Ref: ${regCode} • Order: ${ordId} • Status: ${st.toUpperCase()}`,
          variant: "warning"
        });
        if (!silent) {
          setStatus(
            `⏳ <strong>Payment Verification in Progress (${regCode}):</strong> Your bank / UPI transaction is still pending confirmation. If money was debited, do not initiate another payment — we will update this status automatically or you can view your <a href="confirmation.html?code=${encodeURIComponent(regCode)}&id=${encodeURIComponent(regId || "")}" style="color:var(--blue);font-weight:800;text-decoration:underline">Confirmation Status Page</a>.`,
            "info"
          );
        }
      } else if (st === "failed" || st === "cancelled") {
        showRecoveryBanner({
          title: "⚠️ Previous Payment Attempt Not Completed",
          message: data.message || "No successful payment was recorded for this order. If money was NOT debited, you may safely click the Pay button below to retry. If money WAS debited, click 'Check Payment Status' to reconcile with Razorpay.",
          meta: `Ref: ${regCode} • Order: ${ordId} • Status: ${st.toUpperCase()}`,
          variant: "error"
        });
        if (!silent) {
          setStatus(`ℹ️ Razorpay reports status: <strong>${st.toUpperCase()}</strong>. ${data.message || "You may safely retry payment below."}`, "info");
        }
      }

      return data;
    } catch (err) {
      if (!silent) {
        setStatus("⚠️ Network error while checking payment status. Please check your internet connection and click 'Check Payment Status' again.", "error");
      }
      return null;
    } finally {
      if (!silent && btnCheckPaymentStatus) {
        btnCheckPaymentStatus.disabled = false;
        btnCheckPaymentStatus.textContent = "🔄 Check Payment Status";
      }
    }
  }

  /**
   * Controlled background polling for pending UPI / delayed capture states.
   */
  function startPaymentStatusPolling(regId, orderId, maxAttempts = 10) {
    if (activePollingTimer) {
      clearTimeout(activePollingTimer);
      activePollingTimer = null;
    }
    const delaysMs = [4000, 5000, 6000, 8000, 10000, 12000, 15000, 15000, 15000, 15000];
    let attempt = 0;

    async function pollNext() {
      attempt++;
      const result = await checkOrderPaymentStatus(regId, orderId, { silent: true });
      if (result && result.verified && result.registration) {
        return; // Redirect handled inside checkOrderPaymentStatus
      }
      if (result && (result.status === "failed" || result.status === "expired")) {
        isCheckoutInFlight = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          refreshUpiPayment();
        }
        return;
      }
      if (attempt < maxAttempts) {
        const waitMs = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)];
        activePollingTimer = setTimeout(pollNext, waitMs);
      } else {
        isCheckoutInFlight = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          refreshUpiPayment();
        }
        const saved = loadActiveCheckoutSession();
        const regCode = saved?.regCode || "";
        setStatus(
          `⏳ <strong>Payment Verification Still Pending:</strong> Your bank has not yet confirmed capture. <strong>If money was debited from your account, please do NOT pay again.</strong> Click <strong>"🔄 Check Payment Status"</strong> above or open your <a href="confirmation.html?code=${encodeURIComponent(regCode)}&id=${encodeURIComponent(regId || "")}" style="color:var(--blue);font-weight:800;text-decoration:underline">Registration Status Slip</a> — your Bib will be assigned automatically once confirmed.`,
          "info"
        );
      }
    }

    activePollingTimer = setTimeout(pollNext, delaysMs[0]);
  }

  /**
   * Verifies Razorpay Checkout signature with our backend (/api/razorpay/verify-payment)
   * with automatic retry on transient network drops.
   */
  async function verifyPaymentWithBackend(rzpResponse, sessionMeta) {
    const verifyEndpoint = cfg.RAZORPAY_VERIFY_ENDPOINT || "/api/razorpay/verify-payment";
    const bodyPayload = {
      reg_id: sessionMeta.regId,
      razorpay_order_id: rzpResponse.razorpay_order_id || sessionMeta.orderId,
      razorpay_payment_id: rzpResponse.razorpay_payment_id,
      razorpay_signature: rzpResponse.razorpay_signature
    };

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        setStatus(
          attempt === 1
            ? "🔒 Verifying payment signature with Razorpay & assigning your official Bib number..."
            : `🔒 Re-verifying payment with server (attempt ${attempt}/${maxRetries})...`,
          "info"
        );

        const res = await fetch(verifyEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyPayload)
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok && data.verified && data.registration) {
          setStatus(
            `✅ <strong>Payment Verified!</strong> Official Bib <strong>#${data.registration.bib_number || "Assigned"}</strong> assigned. Redirecting to your confirmation receipt...`,
            "info"
          );
          redirectToConfirmation(data.registration);
          return;
        }

        if (res.ok && (data.status === "pending" || data.status === "authorized")) {
          showRecoveryBanner({
            title: "⏳ Payment Authorized — Awaiting Final Bank Capture",
            message: data.message || "Your payment is authorized and awaiting final bank confirmation. Please wait while we automatically check status.",
            meta: `Ref: ${sessionMeta.regCode || ""} • Payment ID: ${rzpResponse.razorpay_payment_id}`,
            variant: "warning"
          });
          setStatus(`⏳ ${data.message || "Payment verification in progress..."}`, "info");
          startPaymentStatusPolling(sessionMeta.regId, sessionMeta.orderId);
          return;
        }

        if (res.status >= 400 && res.status < 500) {
          // Definite validation/payment error from backend
          isCheckoutInFlight = false;
          if (submitBtn) {
            submitBtn.disabled = false;
            refreshUpiPayment();
          }
          setStatus(`❌ <strong>Payment Verification Notice:</strong> ${data.error || "Could not verify payment."}`, "error");
          showRecoveryBanner({
            title: "⚠️ Payment Verification Issue",
            message: `${data.error || "Verification did not succeed."} If money was debited from your bank account, click 'Check Payment Status' to reconcile with Razorpay before retrying.`,
            meta: `Ref: ${sessionMeta.regCode || ""} • Payment ID: ${rzpResponse.razorpay_payment_id || "—"}`,
            variant: "error"
          });
          return;
        }
      } catch (netErr) {
        console.warn(`Payment verification network attempt ${attempt} failed:`, netErr);
      }

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }

    // If all 3 network retries failed (e.g. mobile internet dropped while switching back from UPI app),
    // switch to controlled polling & recovery banner so the user's payment is safely recovered!
    showRecoveryBanner({
      title: "⏳ Network Interrupted After Payment — Recovering Status",
      message: "Your internet connection briefly dropped while confirming payment. <strong>Do not pay again!</strong> We are automatically recovering your payment status from Razorpay.",
      meta: `Ref: ${sessionMeta.regCode || ""} • Payment ID: ${rzpResponse.razorpay_payment_id || ""}`,
      variant: "warning"
    });
    setStatus(
      "⏳ <strong>Connection interrupted during confirmation:</strong> Automatically reconciling your payment with Razorpay. Please wait or click 'Check Payment Status'...",
      "info"
    );
    startPaymentStatusPolling(sessionMeta.regId, sessionMeta.orderId);
  }

  btnCheckPaymentStatus?.addEventListener("click", () => {
    const saved = loadActiveCheckoutSession();
    if (saved && (saved.regId || saved.orderId)) {
      checkOrderPaymentStatus(saved.regId, saved.orderId, { silent: false });
    }
  });

  btnClearPendingSession?.addEventListener("click", () => {
    const saved = loadActiveCheckoutSession();
    if (saved) {
      const ok = window.confirm(
        "Are you sure you want to clear this saved session and start a new registration? Only do this if no money was debited from your bank account."
      );
      if (!ok) return;
    }
    clearActiveCheckoutSession();
    isCheckoutInFlight = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      refreshUpiPayment();
    }
    if (statusBanner) statusBanner.style.display = "none";
  });

  /**
   * Automatic recovery on page load if the user refreshed or closed tab during checkout.
   */
  async function checkPendingRazorpaySessionOnLoad() {
    const saved = loadActiveCheckoutSession();
    if (!saved || (!saved.regId && !saved.orderId)) return;

    showRecoveryBanner({
      title: "🔄 Checking Previous Registration Payment Status...",
      message: `We found an unfinished checkout session for <strong>${saved.fullName || "Participant"}</strong> (${saved.regCode || saved.orderId}). Verifying live status with Razorpay...`,
      meta: `Ref: ${saved.regCode || "—"} • Order: ${saved.orderId || "—"}`,
      variant: "warning"
    });

    const result = await checkOrderPaymentStatus(saved.regId, saved.orderId, { silent: true });
    if (!result) return;

    if (result.verified && result.registration) {
      return; // Redirects to confirmation.html
    }

    if (result.status === "pending" || result.status === "authorized") {
      // Automatically switch UI to Step 2 so the user sees the live recovery banner and does not double-pay
      if (stepPane1 && stepPane2) {
        stepPane1.classList.remove("active");
        stepPane2.classList.add("active");
      }
      startPaymentStatusPolling(saved.regId, saved.orderId, 8);
    } else if (result.status === "created" || result.status === "failed" || result.status === "cancelled") {
      showRecoveryBanner({
        title: "ℹ️ Unfinished Registration Checkout Found",
        message: `Your previous registration draft (<strong>${saved.regCode || ""}</strong> for <strong>${saved.fullName || "Runner"}</strong>) was not paid. Click <strong>"🔄 Check Payment Status"</strong> if money was debited, or fill the form to retry payment safely.`,
        meta: `Ref: ${saved.regCode || "—"} • Order: ${saved.orderId || "—"}`,
        variant: "warning"
      });
    }
  }

  // Handle Form Submission -> Create Server-Side Razorpay Order & Launch Official Checkout
  form?.addEventListener("submit", async function (e) {
    e.preventDefault();

    // Prevent double-click or concurrent payment attempts
    if (isCheckoutInFlight) {
      setStatus("⏳ Payment checkout is already in progress. Please complete or close the active Razorpay window.", "info");
      return;
    }

    // Verify Step 1 validity
    if (!validateStep1()) {
      goToStep1();
      return;
    }

    // Verify Step 2 validity (Declaration checkbox)
    if (!validateStep2()) {
      return;
    }

    if (typeof window.Razorpay !== "function") {
      setStatus(
        "❌ <strong>Payment Gateway Script Blocked:</strong> Could not load Razorpay Checkout (`checkout.razorpay.com`). Please check your internet connection or disable any ad-blocker and refresh the page.",
        "error"
      );
      return;
    }

    isCheckoutInFlight = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = "🔒 Initializing Secure Razorpay Order...";
    }

    try {
      const cat = category.value;
      const selFt = feeType.value;
      const effectiveFt = getEffectiveFeeType(selFt);
      const cleanEmail = document.getElementById("email").value.trim().toLowerCase();
      const cleanPhone = cleanPhoneNumber(document.getElementById("phone").value);
      const fullName = document.getElementById("name").value.trim();

      let groupMembersData = null;
      if (selFt === "student_group") {
        groupMembersData = [];
        const cards = getGroupMemberCards();
        cards.forEach((card, idx) => {
          const mIdx = idx + 2;
          const nameEl = card.querySelector(".group-member-name");
          const phoneEl = card.querySelector(".group-member-phone");
          const shirtEl = card.querySelector(".group-member-shirt");
          groupMembersData.push({
            member_index: mIdx,
            name: nameEl?.value.trim() || "",
            phone: cleanPhoneNumber(phoneEl?.value || ""),
            shirt_size: shirtEl?.value || "M / 38",
            bib_number: null
          });
        });
      }

      const studentCount = selFt === "student_group" ? (1 + (groupMembersData ? groupMembersData.length : 0)) : 1;

      // Determine idempotency key & reusable registration ID if retrying same registration
      const idemCtx = getCheckoutIdempotencyContext({
        email: cleanEmail,
        phone: cleanPhone,
        category: cat,
        feeType: effectiveFt,
        studentCount
      });

      // Upload Student ID Proof if student_group and not already uploaded in this session
      let studentProofUrl = idemCtx.studentProofUrl;
      const studentProofFile = studentProof?.files?.[0];
      if (selFt === "student_group" && studentProofFile && !studentProofUrl) {
        setStatus("⏳ Uploading Student ID proof to secure storage...", "info");
        studentProofUrl = await uploadToR2(studentProofFile, "student-proofs");
      }

      setStatus("🔒 Creating secure payment order with Razorpay...", "info");

      const createOrderEndpoint = cfg.RAZORPAY_CREATE_ORDER_ENDPOINT || "/api/razorpay/create-order";
      const orderReqPayload = {
        reg_id: idemCtx.regId,
        idempotency_key: idemCtx.idempotencyKey,
        full_name: fullName,
        email: cleanEmail,
        gender: document.getElementById("gender").value,
        dob: document.getElementById("dob").value,
        age: parseInt(document.getElementById("age").value || "0", 10),
        phone: cleanPhone,
        emergency_contact: cleanPhoneNumber(document.getElementById("emergency").value),
        blood_group: document.getElementById("blood").value,
        address: document.getElementById("address").value.trim(),
        hear_source: document.getElementById("source").value,
        blood_donation_interest: document.getElementById("bloodDonate").value,
        category: cat,
        shirt_size: shirt.value,
        fee_type: selFt,
        student_proof_url: studentProofUrl,
        group_members: groupMembersData
      };

      const orderRes = await fetch(createOrderEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderReqPayload)
      });

      const orderData = await orderRes.json().catch(() => ({}));

      if (!orderRes.ok) {
        // Handle case where payment is already pending/authorized on Razorpay
        if (orderRes.status === 409 && orderData.paymentPending) {
          saveActiveCheckoutSession({
            regId: orderData.regId,
            regCode: orderData.regCode,
            orderId: orderData.orderId,
            idempotencyKey: idemCtx.idempotencyKey,
            studentProofUrl,
            email: cleanEmail,
            phone: cleanPhone,
            fullName,
            category: cat,
            feeType: effectiveFt,
            studentCount
          });
          showRecoveryBanner({
            title: "⏳ Payment Verification Already in Progress",
            message: orderData.error || "A payment for this registration is currently awaiting confirmation. Please do not pay again while we verify status.",
            meta: `Ref: ${orderData.regCode || ""} • Order: ${orderData.orderId || ""}`,
            variant: "warning"
          });
          setStatus(`⏳ ${orderData.error}`, "info");
          startPaymentStatusPolling(orderData.regId, orderData.orderId);
          return;
        }
        throw new Error(orderData.error || `Failed to create payment order (HTTP ${orderRes.status})`);
      }

      // If backend reconciled and discovered the registration was already paid & verified
      if (orderData.alreadyVerified && orderData.registration) {
        setStatus("✅ <strong>Payment Already Confirmed!</strong> Redirecting to your confirmation slip...", "info");
        redirectToConfirmation(orderData.registration);
        return;
      }

      const sessionMeta = {
        regId: orderData.regId,
        regCode: orderData.regCode,
        orderId: orderData.orderId,
        idempotencyKey: idemCtx.idempotencyKey,
        studentProofUrl,
        email: cleanEmail,
        phone: cleanPhone,
        fullName,
        category: cat,
        feeType: effectiveFt,
        studentCount,
        amountRupees: orderData.amountRupees
      };
      saveActiveCheckoutSession(sessionMeta);

      // Update UI display if server calculated amount differs (e.g. Early Bird deadline just passed)
      if (orderData.amountRupees && upiAmount) {
        upiAmount.textContent = "₹" + orderData.amountRupees;
      }

      setStatus(
        `🔒 Opening official Razorpay Checkout for <strong>₹${orderData.amountRupees}</strong> (Ref: <strong>${orderData.regCode}</strong>)...`,
        "info"
      );

      let paymentHandledByCallback = false;

      const rzpOptions = {
        key: orderData.keyId,
        amount: orderData.amountPaise,
        currency: orderData.currency || "INR",
        name: "Angamaly Marathon 2027",
        description: `${categoryLabel(cat)} (${orderData.regCode})`,
        order_id: orderData.orderId,
        prefill: {
          name: orderData.prefill?.name || fullName,
          email: orderData.prefill?.email || cleanEmail,
          contact: orderData.prefill?.contact || cleanPhone
        },
        notes: {
          reg_id: String(orderData.regId || ""),
          reg_code: String(orderData.regCode || ""),
          category: String(cat || "")
        },
        theme: {
          color: "#063b83"
        },
        retry: {
          enabled: true,
          max_count: 3
        },
        handler: async function (response) {
          paymentHandledByCallback = true;
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = "🔒 Verifying Payment & Assigning Bib...";
          }
          await verifyPaymentWithBackend(response, sessionMeta);
        },
        modal: {
          confirm_close: true,
          ondismiss: async function () {
            if (paymentHandledByCallback) return;

            // Critical rule: Reconcile with Razorpay first before marking cancelled or asking to retry!
            setStatus("🔄 Checking with Razorpay whether your payment was completed...", "info");
            try {
              const statusEndpoint = cfg.RAZORPAY_STATUS_ENDPOINT || "/api/razorpay/payment-status";
              const res = await fetch(statusEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  reg_id: sessionMeta.regId,
                  order_id: sessionMeta.orderId,
                  client_event: "cancelled"
                })
              });
              const recData = await res.json().catch(() => ({}));

              if (recData.verified && recData.registration) {
                setStatus("✅ <strong>Payment Confirmed!</strong> Redirecting to your confirmation receipt...", "info");
                redirectToConfirmation(recData.registration);
                return;
              }

              if (recData.status === "pending" || recData.status === "authorized") {
                showRecoveryBanner({
                  title: "⏳ Payment Verification in Progress",
                  message: "Your payment is pending confirmation from your bank / UPI app. Please wait — do not initiate another payment.",
                  meta: `Ref: ${sessionMeta.regCode} • Order: ${sessionMeta.orderId}`,
                  variant: "warning"
                });
                setStatus("⏳ Payment verification in progress with Razorpay...", "info");
                startPaymentStatusPolling(sessionMeta.regId, sessionMeta.orderId);
                return;
              }
            } catch (_) {}

            isCheckoutInFlight = false;
            if (submitBtn) {
              submitBtn.disabled = false;
              refreshUpiPayment();
            }
            showRecoveryBanner({
              title: "ℹ️ Checkout Window Closed",
              message: `Your registration draft (<strong>${sessionMeta.regCode}</strong>) is saved. If money was debited from your bank account, click <strong>"🔄 Check Payment Status"</strong>. Otherwise, you can click the Pay button below to retry safely without creating a duplicate registration.`,
              meta: `Ref: ${sessionMeta.regCode} • Order: ${sessionMeta.orderId}`,
              variant: "warning"
            });
            setStatus(
              `ℹ️ Checkout was closed before completion. You can safely click <strong>"Pay ₹${orderData.amountRupees} & Confirm Registration"</strong> to retry, or click <strong>"Check Payment Status"</strong> if money was debited.`,
              "info"
            );
          }
        }
      };

      const rzp = new window.Razorpay(rzpOptions);

      rzp.on("payment.failed", async function (failResp) {
        const errObj = failResp?.error || {};
        const friendlyDesc =
          errObj.description ||
          errObj.reason ||
          "Your bank or payment provider declined the transaction.";

        // Notify backend to reconcile first and log the failure safely
        try {
          const statusEndpoint = cfg.RAZORPAY_STATUS_ENDPOINT || "/api/razorpay/payment-status";
          await fetch(statusEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reg_id: sessionMeta.regId,
              order_id: sessionMeta.orderId,
              client_event: "failed",
              error_description: friendlyDesc
            })
          });
        } catch (_) {}

        showRecoveryBanner({
          title: "⚠️ Payment Attempt Declined / Failed",
          message: `${friendlyDesc} <br><strong>Note:</strong> No duplicate charge has been made. You can retry inside the Razorpay window or click the Pay button below to retry safely.`,
          meta: `Ref: ${sessionMeta.regCode} • Order: ${sessionMeta.orderId}`,
          variant: "error"
        });
        setStatus(
          `⚠️ <strong>Payment Attempt Failed:</strong> ${friendlyDesc} You may safely retry using another UPI app, card, or NetBanking.`,
          "error"
        );
      });

      rzp.open();
    } catch (err) {
      console.error("Razorpay checkout initialization error:", err);
      isCheckoutInFlight = false;
      setStatus(`❌ <strong>Payment Initialization Error:</strong> ${err.message || "Unable to connect to payment gateway"}. Please try again.`, "error");
      if (submitBtn) {
        submitBtn.disabled = false;
        refreshUpiPayment();
      }
    }
  });

  // Init
  updateSummary();
  loadSettings();
  checkPendingRazorpaySessionOnLoad();
})();

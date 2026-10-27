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
    regular: { "21.1K": 850, "10K": 650, "5K": 450 },
    early: { "21.1K": 750, "10K": 550, "5K": 350 },
    student_early: { "21.1K": 300, "10K": 300, "5K": 300 },
    student: { "21.1K": 350, "10K": 350, "5K": 350 },
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
    if (val === "student") {
      return isEarlyBirdActive() ? "student_early" : "student";
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
    return prices[effectiveFt] ? prices[effectiveFt][cat] : 850;
  }

  function categoryLabel(v) {
    return v === "21.1K" ? "Half Marathon – 21.1KM" : v === "10K" ? "Mini Marathon – 10KM" : "Fun Run / Walk – 5KM";
  }

  function feeLabel(v) {
    const effective = getEffectiveFeeType(v);
    if (effective === "early") return "Individual (Early Bird)";
    if (effective === "regular") return "Individual Runner";
    if (effective === "student_early") return "Student (Early Bird)";
    if (effective === "student") return "Student (Normal)";
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
    if (feeType?.value !== "student" && feeType?.value !== "student_group") return true;
    const el = document.getElementById("studentProof");
    if (!el) return true;
    const file = el.files?.[0];
    if (!file) {
      const msg = feeType.value === "student_group"
        ? "Please upload Student ID proof for Applicant #1."
        : "Please upload your student ID card or proof to claim student discount.";
      setFieldError(el, msg);
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
    const selFt = feeType.value; // "individual", "student", "student_group"
    const effectiveFt = getEffectiveFeeType(selFt);
    const amount = getCurrentPayableAmount();

    // Baseline non-discounted comparison for strikethrough cutoff
    let baselineAmount = prices["regular"] ? prices["regular"][cat] : 850;
    if (selFt === "student") {
      baselineAmount = prices["student"] ? prices["student"][cat] : 350;
    } else if (selFt === "student_group") {
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
        const curP = selFt === "student_group" ? amount : (prices[effectiveFt] ? prices[effectiveFt][c] : 850);
        let baseP = prices["regular"] ? prices["regular"][c] : 850;
        if (selFt === "student") {
          baseP = prices["student"] ? prices["student"][c] : 350;
        } else if (selFt === "student_group") {
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

    const isStudent = selFt === "student" || selFt === "student_group";
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

  function getAppSpecificUpiLink(provider, upiId, amount, note) {
    const isAndroid = /android/i.test(navigator.userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

    const params = new URLSearchParams({
      pa: upiId,
      pn: "Angamaly Marathon 2027",
      am: String(amount),
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
        return `intent://pay?${qs}#Intent;scheme=upi;package=${androidPackages[provider]};S.browser_fallback_url=${encodeURIComponent(genericUrl)};end;`;
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
    const upiId = upiSettings[provider] || "qr.jeevadhara@sib";
    const numAmount = getCurrentPayableAmount();
    const amount = String(numAmount);
    const catVal = category ? category.value : "Marathon";
    const note = `Angamaly Marathon ${catVal} Reg`;

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
    if (upiAmount) upiAmount.textContent = "₹" + amount;

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

  function updateDeadlineNoticeText() {
    const noticeDateEl = document.getElementById("sDeadlineDateText");
    if (noticeDateEl) {
      noticeDateEl.textContent = formatDeadlineDate(earlyBirdDeadline);
    }
    const noticeEl = document.getElementById("sDeadlineNotice");
    if (noticeEl) {
      if (isEarlyBirdActive()) {
        noticeEl.innerHTML = `Early Bird rates apply until <strong id="sDeadlineDateText">${formatDeadlineDate(earlyBirdDeadline)}</strong>. Valid Student ID required for student discount.`;
      } else {
        noticeEl.innerHTML = `Standard registration rates are active. Valid Student ID required for student discount.`;
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
    const stdOpt = feeType.querySelector('option[value="student"]');
    if (stdOpt) {
      stdOpt.textContent = isEarly
        ? "Student – Individual (Early Bird ₹300, ID Required)"
        : "Student – Individual (₹350, ID Required)";
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
    const vProof = validatePaymentProof();
    const vDecl = validateDeclaration();

    const fieldsInOrder = [
      { valid: vProof, el: document.getElementById("paymentProof") },
      { valid: vDecl, el: document.getElementById("declarationCheck") }
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

  function goToStep2() {
    if (!validateStep1()) return;

    const nameVal = document.getElementById("name")?.value.trim() || "Participant";
    const cat = category?.value || "21.1K";
    const selFt = feeType?.value || "individual";
    const effectiveFt = getEffectiveFeeType(selFt);
    const amount = prices[effectiveFt] ? prices[effectiveFt][cat] : 850;
    let baselineAmount = prices["regular"] ? prices["regular"][cat] : 850;
    if (selFt === "student") {
      baselineAmount = prices["student"] ? prices["student"][cat] : 350;
    }
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
      const proofInput = document.getElementById("paymentProof");
      if (proofInput) {
        proofInput.scrollIntoView({ behavior: "smooth", block: "center" });
        proofInput.focus();
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

  // Payment Screenshot File Verification (Max 1MB, JPG/PNG/WebP only)
  const paymentProofInput = document.getElementById("paymentProof");
  const MAX_PAYMENT_PROOF_SIZE = 1 * 1024 * 1024; // 1 MB
  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const ALLOWED_IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

  function validatePaymentProofFile(file) {
    if (!file) {
      return { valid: false, error: "Please select your payment screenshot / receipt." };
    }

    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    const isMimeOk = file.type && ALLOWED_IMAGE_TYPES.includes(file.type);
    const isExtOk = ALLOWED_IMAGE_EXTS.includes(ext);

    if (!isMimeOk && !isExtOk) {
      return {
        valid: false,
        error: "Invalid file type. Please upload a valid image screenshot in JPG, PNG, or WebP format (PDFs and other document formats are not accepted for payment receipts)."
      };
    }

    if (file.size > MAX_PAYMENT_PROOF_SIZE) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      return {
        valid: false,
        error: `Payment screenshot exceeds the 1 MB limit (selected: ${sizeMb} MB). Please choose an image within 1 MB.`
      };
    }

    return { valid: true };
  }

  paymentProofInput?.addEventListener("change", function () {
    const file = this.files?.[0];
    if (!file) return;

    const check = validatePaymentProofFile(file);
    if (!check.valid) {
      setFieldError(this, check.error);
      this.value = "";
    } else {
      clearFieldError(this);
    }
  });

  // Helper to upload a file to Cloudflare R2
  async function uploadToR2(file, folder = "receipts") {
    // Compress first if image
    let uploadFile = file;
    if (file.type.startsWith("image/") && window.compressImage) {
      uploadFile = await window.compressImage(file, { maxWidth: 1280, quality: 0.80 });
    }

    // Double check 1MB limit for receipts
    if (folder === "receipts" && uploadFile.size > MAX_PAYMENT_PROOF_SIZE) {
      throw new Error(`File size is ${(uploadFile.size / (1024 * 1024)).toFixed(2)} MB, which exceeds the 1 MB limit.`);
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
    if (!validateStep2()) {
      return;
    }

    const paymentFile = paymentProofInput?.files?.[0];
    const proofCheck = validatePaymentProofFile(paymentFile);
    if (!proofCheck.valid) {
      setFieldError(paymentProofInput, proofCheck.error);
      paymentProofInput?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      if ((feeType.value === "student" || feeType.value === "student_group") && studentProofFile) {
        setStatus("⏳ Uploading student ID proof...", "info");
        studentProofUrl = await uploadToR2(studentProofFile, "student-proofs");
      }

      setStatus("⏳ Saving your details into official registration roster...", "info");

      // 3. Prepare Payload for Supabase
      const cat = category.value;
      const selFt = feeType.value;
      const effectiveFt = getEffectiveFeeType(selFt);
      const expectedAmount = getCurrentPayableAmount();

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

      const payload = {
        full_name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim().toLowerCase(),
        gender: document.getElementById("gender").value,
        dob: document.getElementById("dob").value,
        age: parseInt(document.getElementById("age").value || "0", 10),
        phone: cleanPhoneNumber(document.getElementById("phone").value),
        emergency_contact: cleanPhoneNumber(document.getElementById("emergency").value),
        blood_group: document.getElementById("blood").value,
        address: document.getElementById("address").value.trim(),
        hear_source: document.getElementById("source").value,
        blood_donation_interest: document.getElementById("bloodDonate").value,
        category: cat,
        shirt_size: shirt.value,
        fee_type: effectiveFt,
        amount_payable: expectedAmount,
        payment_provider: document.getElementById("paymentProvider").value,
        utr_number: document.getElementById("txn")?.value?.trim() || "IN_PROOF",
        payment_proof_url: paymentProofUrl,
        student_proof_url: studentProofUrl,
        group_members: groupMembersData,
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

      // Realtime Google Sheets backup dispatch (fire-and-forget, non-blocking)
      try {
        fetch("/api/backup-to-sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "INSERT", record: record }),
          keepalive: true
        }).catch(() => {});
      } catch (_) {}

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

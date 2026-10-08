/**
 * Admin Portal Logic:
 * - Supabase Auth session management
 * - Real-time metrics & T-shirt matrix calculation
 * - Search, filter, and R2 receipt modal inspection
 * - One-click approval with automated Resend confirmation email
 * - CSV export for bib printers & timing chips
 */

(function () {
  const cfg = window.ENV_CONFIG || {};

  let allRegistrations = [];
  let currentSession = null;
  let activeModalReg = null;

  // DOM Elements
  const loginView = document.getElementById("loginView");
  const dashView = document.getElementById("dashView");
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const loginError = document.getElementById("loginError");
  const adminHeaderActions = document.getElementById("adminHeaderActions");
  const adminUserPill = document.getElementById("adminUserPill");

  const kpiTotal = document.getElementById("kpiTotal");
  const kpiPending = document.getElementById("kpiPending");
  const kpiVerified = document.getElementById("kpiVerified");
  const kpiRevenue = document.getElementById("kpiRevenue");
  const progressBarFill = document.getElementById("progressBarFill");
  const progressPercent = document.getElementById("progressPercent");
  const registeredCountLabel = document.getElementById("registeredCountLabel");
  const slotsRemaining = document.getElementById("slotsRemaining");

  const tableSearch = document.getElementById("tableSearch");
  const filterStatus = document.getElementById("filterStatus");
  const filterCategory = document.getElementById("filterCategory");
  const tbody = document.getElementById("registrationsTbody");
  const btnExportCsv = document.getElementById("btnExportCsv");

  // Modal Elements
  const proofModal = document.getElementById("proofModal");
  const modalRunnerName = document.getElementById("modalRunnerName");
  const modalMeta = document.getElementById("modalMeta");
  const modalImg = document.getElementById("modalImg");
  const modalFullImgLink = document.getElementById("modalFullImgLink");
  const modalStudentProofWrap = document.getElementById("modalStudentProofWrap");
  const modalStudentLink = document.getElementById("modalStudentLink");
  const modalBibInput = document.getElementById("modalBibInput");
  const modalVerifyBtn = document.getElementById("modalVerifyBtn");
  const modalRejectBtn = document.getElementById("modalRejectBtn");

  // 1. Authentication Handlers
  async function signIn(email, password) {
    loginError.textContent = "";
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing In...";

    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error_description || data.msg || "Authentication failed");
      }

      currentSession = data;
      localStorage.setItem("marathon_admin_session", JSON.stringify(data));
      showDashboard();
    } catch (err) {
      loginError.textContent = err.message;
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign In to Dashboard";
    }
  }

  function signOut() {
    currentSession = null;
    localStorage.removeItem("marathon_admin_session");
    loginView.style.display = "grid";
    dashView.style.display = "none";
    adminHeaderActions.style.display = "none";
  }

  function checkExistingSession() {
    const saved = localStorage.getItem("marathon_admin_session");
    if (saved) {
      try {
        currentSession = JSON.parse(saved);
        if (currentSession && currentSession.access_token) {
          showDashboard();
          return;
        }
      } catch (e) {}
    }
    loginView.style.display = "grid";
    dashView.style.display = "none";
  }

  function showDashboard() {
    loginView.style.display = "none";
    dashView.style.display = "block";
    adminHeaderActions.style.display = "flex";
    if (currentSession?.user?.email) {
      adminUserPill.textContent = currentSession.user.email;
    }
    loadRegistrations();
  }

  // 2. Data Fetching
  async function loadRegistrations() {
    if (!currentSession) return;
    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/registrations?order=created_at.desc`, {
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${currentSession.access_token}`
        }
      });

      if (!res.ok) {
        if (res.status === 401) {
          alert("Session expired. Please sign in again.");
          signOut();
          return;
        }
        throw new Error(`Failed to load data: ${res.status}`);
      }

      allRegistrations = await res.json();
      updateMetrics();
      renderTable();
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:red;padding:24px">Error loading registrations: ${err.message}</td></tr>`;
    }
  }

  // 3. KPI & Matrix Metrics
  function updateMetrics() {
    const total = allRegistrations.length;
    let pending = 0;
    let verified = 0;
    let revenue = 0;

    const shirts = { "XS / 34": 0, "S / 36": 0, "M / 38": 0, "L / 40": 0, "XL / 42": 0, "XXL / 44": 0 };

    allRegistrations.forEach((r) => {
      if (r.payment_status === "verified") {
        verified++;
        revenue += parseFloat(r.amount_payable || 0);
        if (shirts[r.shirt_size] !== undefined) {
          shirts[r.shirt_size]++;
        }
      } else if (r.payment_status === "pending") {
        pending++;
      }
    });

    if (kpiTotal) kpiTotal.textContent = total;
    if (kpiPending) kpiPending.textContent = pending;
    if (kpiVerified) kpiVerified.textContent = verified;
    if (kpiRevenue) kpiRevenue.textContent = "₹" + revenue.toLocaleString("en-IN");

    // Target Progress towards 3,000
    const target = cfg.MAX_PARTICIPANTS || 3000;
    const pct = Math.min(100, Math.round((verified / target) * 100));
    if (progressPercent) progressPercent.textContent = pct + "%";
    if (progressBarFill) progressBarFill.style.width = pct + "%";
    if (registeredCountLabel) registeredCountLabel.textContent = `${verified} Verified & Confirmed`;
    if (slotsRemaining) slotsRemaining.textContent = Math.max(0, target - verified).toLocaleString("en-IN");

    // T-shirt counts
    document.getElementById("shirtXS").textContent = shirts["XS / 34"] || 0;
    document.getElementById("shirtS").textContent = shirts["S / 36"] || 0;
    document.getElementById("shirtM").textContent = shirts["M / 38"] || 0;
    document.getElementById("shirtL").textContent = shirts["L / 40"] || 0;
    document.getElementById("shirtXL").textContent = shirts["XL / 42"] || 0;
    document.getElementById("shirtXXL").textContent = shirts["XXL / 44"] || 0;
  }

  // 4. Render Table
  function renderTable() {
    const query = (tableSearch?.value || "").toLowerCase().trim();
    const stFilter = filterStatus?.value || "";
    const catFilter = filterCategory?.value || "";

    const filtered = allRegistrations.filter((r) => {
      if (stFilter && r.payment_status !== stFilter) return false;
      if (catFilter && r.category !== catFilter) return false;
      if (query) {
        const hay = `${r.full_name} ${r.email} ${r.phone} ${r.reg_code} ${r.utr_number} ${r.bib_number || ""}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--muted)">No matching registrations found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered
      .map((r) => {
        const statusBadge =
          r.payment_status === "verified"
            ? `<span class="badge-status status-verified">Verified</span>`
            : r.payment_status === "rejected"
            ? `<span class="badge-status status-rejected">Rejected</span>`
            : `<span class="badge-status status-pending">Pending</span>`;

        const waText = encodeURIComponent(
          `Hi ${r.full_name}, this is from Angamaly Marathon 2027 regarding your registration (${r.reg_code}).`
        );
        const cleanPhone = (r.phone || "").replace(/[^0-9]/g, "");

        return `
        <tr>
          <td><strong>${r.reg_code || "—"}</strong><br><small style="color:var(--muted)">${new Date(r.created_at).toLocaleDateString()}</small></td>
          <td>
            <strong>${r.full_name}</strong><br>
            <small style="color:var(--muted)">📱 ${r.phone} • 🩸 ${r.blood_group}</small><br>
            <small style="color:var(--muted)">✉️ ${r.email}</small>
          </td>
          <td>
            <span style="font-weight:800;color:var(--blue)">${r.category}</span><br>
            <small style="color:var(--muted)">Size: ${r.shirt_size}</small>
          </td>
          <td>
            <strong>₹${r.amount_payable}</strong> (${r.payment_provider})<br>
            <code style="font-size:12px;background:#f0f4f9;padding:2px 5px;border-radius:4px">${r.utr_number || "—"}</code>
          </td>
          <td>
            <button class="thumb-btn" onclick="openProofModal('${r.id}')">🔍 View R2 Proof</button>
          </td>
          <td>${statusBadge}</td>
          <td><strong>${r.bib_number || "—"}</strong></td>
          <td>
            <div class="action-btn-row">
              <button class="btn-verify" onclick="quickVerify('${r.id}')" title="Verify & Send Email">✓ Approve</button>
              <a class="btn-wa" href="https://wa.me/91${cleanPhone}?text=${waText}" target="_blank" title="WhatsApp Runner">WA</a>
              <button class="btn-reject" onclick="quickReject('${r.id}')" title="Reject">✕</button>
            </div>
          </td>
        </tr>
      `;
      })
      .join("");
  }

  // 5. Verification Modal & Actions
  window.openProofModal = function (id) {
    const reg = allRegistrations.find((item) => item.id === id);
    if (!reg) return;
    activeModalReg = reg;

    modalRunnerName.textContent = `${reg.full_name} • ${reg.reg_code}`;
    modalMeta.textContent = `Race: ${reg.category} | UTR: ${reg.utr_number} | Amount: ₹${reg.amount_payable} | Status: ${reg.payment_status}`;
    modalImg.src = reg.payment_proof_url;
    modalFullImgLink.href = reg.payment_proof_url;

    // Suggest Next Bib Number if empty
    if (!reg.bib_number) {
      const prefix = reg.category === "21.1K" ? "HM-" : reg.category === "10K" ? "MM-" : "FR-";
      const existingCount = allRegistrations.filter((x) => x.category === reg.category && x.bib_number).length + 1001;
      modalBibInput.value = `${prefix}${existingCount}`;
    } else {
      modalBibInput.value = reg.bib_number;
    }

    if (reg.student_proof_url) {
      modalStudentProofWrap.style.display = "block";
      modalStudentLink.href = reg.student_proof_url;
    } else {
      modalStudentProofWrap.style.display = "none";
    }

    proofModal.style.display = "grid";
  };

  window.closeModal = function () {
    proofModal.style.display = "none";
    activeModalReg = null;
  };

  async function callConfirmApi(regId, bibNumber) {
    const res = await fetch(cfg.CONFIRM_ENDPOINT || "/api/confirm-registration", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentSession.access_token}`
      },
      body: JSON.stringify({
        regId,
        bibNumber,
        sendEmail: true
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed with status ${res.status}`);
    }
    return res.json();
  }

  window.quickVerify = async function (id) {
    const reg = allRegistrations.find((x) => x.id === id);
    if (!reg) return;

    const prefix = reg.category === "21.1K" ? "HM-" : reg.category === "10K" ? "MM-" : "FR-";
    const existingCount = allRegistrations.filter((x) => x.category === reg.category && x.bib_number).length + 1001;
    const defaultBib = reg.bib_number || `${prefix}${existingCount}`;

    const bib = prompt(`Assign Bib Number for ${reg.full_name}:`, defaultBib);
    if (!bib) return;

    try {
      await callConfirmApi(id, bib);
      alert(`✓ ${reg.full_name} verified! Confirmation email dispatched.`);
      loadRegistrations();
    } catch (e) {
      alert(`Error approving registration: ${e.message}`);
    }
  };

  window.quickReject = async function (id) {
    const reg = allRegistrations.find((x) => x.id === id);
    if (!reg) return;

    const reason = prompt(`Reason for rejecting ${reg.full_name}:`, "Payment reference / screenshot mismatch");
    if (reason === null) return;

    try {
      const res = await fetch(cfg.REJECT_ENDPOINT || "/api/reject-registration", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentSession.access_token}`
        },
        body: JSON.stringify({ regId: id, reason })
      });
      if (!res.ok) throw new Error("Rejection request failed");
      alert(`Registration marked as rejected.`);
      loadRegistrations();
    } catch (e) {
      alert(`Error rejecting registration: ${e.message}`);
    }
  };

  modalVerifyBtn?.addEventListener("click", async () => {
    if (!activeModalReg) return;
    const bib = modalBibInput.value.trim();
    if (!bib) {
      alert("Please enter a valid Bib Number");
      return;
    }
    modalVerifyBtn.disabled = true;
    modalVerifyBtn.textContent = "Verifying & Sending Email...";

    try {
      await callConfirmApi(activeModalReg.id, bib);
      alert(`✓ Verified and email sent!`);
      closeModal();
      loadRegistrations();
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      modalVerifyBtn.disabled = false;
      modalVerifyBtn.textContent = "✓ Approve & Send Resend Email";
    }
  });

  modalRejectBtn?.addEventListener("click", () => {
    if (!activeModalReg) return;
    const regId = activeModalReg.id;
    closeModal();
    quickReject(regId);
  });

  // 6. CSV Export for Race Timing Chips & Bib Printing
  btnExportCsv?.addEventListener("click", () => {
    if (allRegistrations.length === 0) {
      alert("No data available to export.");
      return;
    }

    const headers = [
      "Bib Number",
      "Registration Code",
      "Full Name",
      "Category",
      "Gender",
      "DOB",
      "Age",
      "Phone",
      "Email",
      "Emergency Contact",
      "Blood Group",
      "T-Shirt Size",
      "Fee Type",
      "Amount",
      "Payment Status",
      "UTR Number",
      "Address",
      "Registration Date"
    ];

    const rows = allRegistrations.map((r) => [
      `"${r.bib_number || ""}"`,
      `"${r.reg_code || ""}"`,
      `"${(r.full_name || "").replace(/"/g, '""')}"`,
      `"${r.category || ""}"`,
      `"${r.gender || ""}"`,
      `"${r.dob || ""}"`,
      `"${r.age || ""}"`,
      `"${r.phone || ""}"`,
      `"${r.email || ""}"`,
      `"${r.emergency_contact || ""}"`,
      `"${r.blood_group || ""}"`,
      `"${r.shirt_size || ""}"`,
      `"${r.fee_type || ""}"`,
      `"${r.amount_payable || ""}"`,
      `"${r.payment_status || ""}"`,
      `"${r.utr_number || ""}"`,
      `"${(r.address || "").replace(/"/g, '""').replace(/\n/g, " ")}"`,
      `"${r.created_at || ""}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `angamaly_marathon_participants_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // Event Listeners for Filters
  tableSearch?.addEventListener("input", renderTable);
  filterStatus?.addEventListener("change", renderTable);
  filterCategory?.addEventListener("change", renderTable);

  loginBtn?.addEventListener("click", () => {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    if (!email || !password) {
      loginError.textContent = "Please enter email and password";
      return;
    }
    signIn(email, password);
  });

  logoutBtn?.addEventListener("click", signOut);

  // Initialize
  checkExistingSession();
})();

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

  function normalizeMediaUrl(url) {
    if (!url || typeof url !== "string") return "";
    const trimmed = url.trim();
    if (trimmed.includes(".r2.dev/")) {
      const key = trimmed.split(".r2.dev/")[1];
      return `/api/media/${key}`;
    }
    return trimmed;
  }

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
  const filterFeeType = document.getElementById("filterFeeType");
  const filterShirt = document.getElementById("filterShirt");
  const filterGender = document.getElementById("filterGender");
  const filterStatsBadge = document.getElementById("filterStatsBadge");
  const btnResetFilters = document.getElementById("btnResetFilters");
  const btnOpenExportModal = document.getElementById("btnOpenExportModal");
  const tbody = document.getElementById("registrationsTbody");

  // Modal Elements
  const proofModal = document.getElementById("proofModal");
  const modalRunnerName = document.getElementById("modalRunnerName");
  const modalMeta = document.getElementById("modalMeta");
  const modalImg = document.getElementById("modalImg");
  const modalFullImgLink = document.getElementById("modalFullImgLink");
  const modalProofSwitcher = document.getElementById("modalProofSwitcher");
  const modalTabPayment = document.getElementById("modalTabPayment");
  const modalTabStudent = document.getElementById("modalTabStudent");
  const modalPaymentView = document.getElementById("modalPaymentView");
  const modalStudentView = document.getElementById("modalStudentView");
  const modalStudentImg = document.getElementById("modalStudentImg");
  const modalStudentLink = document.getElementById("modalStudentLink");
  const modalStudentPdfWrap = document.getElementById("modalStudentPdfWrap");
  const modalStudentPdfBtn = document.getElementById("modalStudentPdfBtn");
  const modalStudentMissingAlert = document.getElementById("modalStudentMissingAlert");
  const modalBibInput = document.getElementById("modalBibInput");
  const modalVerifyBtn = document.getElementById("modalVerifyBtn");
  const modalRejectBtn = document.getElementById("modalRejectBtn");
  const modalWaDispatchWrap = document.getElementById("modalWaDispatchWrap");
  const modalWaStatusMsg = document.getElementById("modalWaStatusMsg");
  const modalWaBtn = document.getElementById("modalWaBtn");

  // Runner Full Details Modal Elements
  const runnerDetailsModal = document.getElementById("runnerDetailsModal");

  // Realtime Status Pill DOM & WebSocket Client
  const realtimeStatusPill = document.getElementById("realtimeStatusPill");
  const realtimeStatusText = document.getElementById("realtimeStatusText");
  let realtimeChannel = null;
  let sbClient = null;

  function setRealtimeStatus(status) {
    if (!realtimeStatusPill || !realtimeStatusText) return;
    realtimeStatusPill.classList.remove("connecting", "disconnected");
    if (status === "SUBSCRIBED") {
      realtimeStatusText.textContent = "Live Alerts Active";
      realtimeStatusPill.title = "WebSocket connected: Instant registration alerts active";
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      realtimeStatusPill.classList.add("disconnected");
      realtimeStatusText.textContent = "Alerts Reconnecting...";
      realtimeStatusPill.title = "WebSocket disconnected. Retrying...";
    } else {
      realtimeStatusPill.classList.add("connecting");
      realtimeStatusText.textContent = "Connecting Alerts...";
      realtimeStatusPill.title = "Connecting to Supabase Realtime WebSocket...";
    }
  }

  function playNotificationChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = "sine";
      osc2.type = "sine";
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5 note
      osc2.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5 note

      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.12);
      osc2.start(ctx.currentTime + 0.12);
      osc2.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.warn("Audio chime prevented:", e);
    }
  }

  function setupRealtimeListener() {
    if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      console.warn("Supabase Realtime library not available");
      return;
    }

    try {
      if (!sbClient) {
        sbClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
          auth: { persistSession: false },
          realtime: { params: { eventsPerSecond: 10 } }
        });
      }

      if (realtimeChannel) {
        sbClient.removeChannel(realtimeChannel);
      }

      setRealtimeStatus("CONNECTING");

      realtimeChannel = sbClient
        .channel("admin-registrations-live")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "registrations" },
          (payload) => {
            console.log("[Realtime WebSocket] New registration:", payload.new);
            handleNewRegistrationAlert(payload.new);
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "registrations" },
          (payload) => {
            console.log("[Realtime WebSocket] Updated registration:", payload.new);
            handleUpdatedRegistration(payload.new);
          }
        )
        .subscribe((status, err) => {
          console.log(`[Realtime WebSocket] Status: ${status}`, err || "");
          setRealtimeStatus(status);
        });
    } catch (err) {
      console.error("Realtime setup error:", err);
      setRealtimeStatus("CHANNEL_ERROR");
    }
  }

  function handleNewRegistrationAlert(newReg) {
    if (!newReg || !newReg.id) return;

    // Deduplicate
    const exists = allRegistrations.some((r) => r.id === newReg.id);
    if (exists) return;

    // Flash glow flag
    newReg._isJustReceived = true;
    allRegistrations.unshift(newReg);

    updateMetrics();
    renderTable();
    playNotificationChime();
    showToast(`🚨 New Registration: ${newReg.full_name} (${newReg.category} • ₹${newReg.amount_payable})`);

    setTimeout(() => {
      delete newReg._isJustReceived;
    }, 5000);
  }

  function handleUpdatedRegistration(updatedReg) {
    if (!updatedReg || !updatedReg.id) return;
    const idx = allRegistrations.findIndex((r) => r.id === updatedReg.id);
    if (idx !== -1) {
      allRegistrations[idx] = { ...allRegistrations[idx], ...updatedReg };
      updateMetrics();
      renderTable();
    }
  }

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

      data.expires_at = data.expires_at || (Math.floor(Date.now() / 1000) + (data.expires_in || 3600));
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

  async function refreshSession() {
    if (!currentSession || !currentSession.refresh_token) {
      return false;
    }
    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refresh_token: currentSession.refresh_token })
      });

      if (!res.ok) {
        console.warn("Session refresh returned status:", res.status);
        return false;
      }

      const data = await res.json();
      data.expires_at = data.expires_at || (Math.floor(Date.now() / 1000) + (data.expires_in || 3600));
      currentSession = { ...currentSession, ...data };
      localStorage.setItem("marathon_admin_session", JSON.stringify(currentSession));
      console.log("[Auth] Session refreshed successfully");
      return true;
    } catch (e) {
      console.warn("Session refresh error:", e);
      return false;
    }
  }

  async function getValidToken() {
    if (!currentSession) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (currentSession.expires_at && currentSession.expires_at - nowSec < 90) {
      await refreshSession();
    }
    return currentSession?.access_token || null;
  }

  function signOut() {
    if (realtimeChannel && sbClient) {
      sbClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    currentSession = null;
    localStorage.removeItem("marathon_admin_session");
    loginView.style.display = "grid";
    dashView.style.display = "none";
    adminHeaderActions.style.display = "none";
  }

  async function checkExistingSession() {
    const saved = localStorage.getItem("marathon_admin_session");
    if (saved) {
      try {
        currentSession = JSON.parse(saved);
        if (currentSession && currentSession.access_token) {
          const nowSec = Math.floor(Date.now() / 1000);
          if (currentSession.expires_at && currentSession.expires_at <= nowSec) {
            const refreshed = await refreshSession();
            if (!refreshed) {
              signOut();
              return;
            }
          }
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
    loadTshirtPrintingStatus();
    loadRegistrations();
    loadEventSettingsAdmin();
    setupRealtimeListener();
  }

  // 2. Data Fetching
  async function loadRegistrations() {
    if (!currentSession) return;
    try {
      let token = await getValidToken();
      if (!token) {
        signOut();
        return;
      }

      let res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/registrations?order=created_at.desc`, {
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok && res.status === 401) {
        const refreshed = await refreshSession();
        if (refreshed) {
          token = currentSession.access_token;
          res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/registrations?order=created_at.desc`, {
            headers: {
              apikey: cfg.SUPABASE_ANON_KEY,
              Authorization: `Bearer ${token}`
            }
          });
        }
      }

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
      const isGroup = r.fee_type === "student_group" || (Array.isArray(r.group_members) && r.group_members.length > 0);
      if (r.payment_status === "verified") {
        const count = isGroup ? 5 : 1;
        verified += count;
        revenue += parseFloat(r.amount_payable || 0);
        if (shirts[r.shirt_size] !== undefined) {
          shirts[r.shirt_size]++;
        }
        if (isGroup && r.group_members) {
          let members = r.group_members;
          if (typeof members === "string") {
            try { members = JSON.parse(members); } catch (e) { members = []; }
          }
          if (Array.isArray(members)) {
            members.forEach((m) => {
              if (m.shirt_size && shirts[m.shirt_size] !== undefined) {
                shirts[m.shirt_size]++;
              }
            });
          }
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

    // T-shirt printing progress counts & matrix
    currentTshirtRequired = shirts;
    renderTshirtPrintingTracker();
  }

  // 4. WhatsApp Message Helpers
  function generateWhatsAppMessage(runner, bibNumber) {
    if (!runner) return "";
    const bib = bibNumber || runner.bib_number || "Assigned";
    const raceCategory = runner.category === "21.1K" ? "Half Marathon (21.1K)" : runner.category === "10K" ? "Mini Marathon (10K)" : "Fun Run / Walk (5K)";
    const scheduleTimes = runner.category === "21.1K" 
      ? "Reporting: 05:00 AM | Flag-off: 05:30 AM" 
      : runner.category === "10K" 
      ? "Reporting: 05:30 AM | Flag-off: 06:00 AM" 
      : "Reporting: 06:00 AM | Flag-off: 06:30 AM";
    const origin = window.location.origin;
    const slipUrl = `${origin}/confirmation.html?code=${runner.reg_code}`;

    let groupText = "";
    if (runner.fee_type === "student_group" || runner.group_members) {
      let members = runner.group_members;
      if (typeof members === "string") {
        try { members = JSON.parse(members); } catch (e) { members = []; }
      }
      if (Array.isArray(members) && members.length > 0) {
        groupText = `\n\n👥 *Registered Student Group Roster (5 Runners):*\n• Student #1 (Leader): ${runner.full_name} — Bib: *${bib}* (T-Shirt: ${runner.shirt_size})`;
        members.forEach((m, idx) => {
          const mBib = m.bib_number || "Assigned";
          groupText += `\n• Student #${m.member_index || (idx + 2)}: ${m.name} — Bib: *${mBib}* (T-Shirt: ${m.shirt_size || 'M'})`;
        });
        groupText += `\n_Note: The 4 accompanying students must present their physical student ID cards at kit collection._`;
      }
    }

    const text = `🏃 *Angamaly Marathon 2027 – Registration Confirmed!*

Dear *${runner.full_name}*,
Congratulations! Your registration and payment have been verified and confirmed.

🏷️ *Official Bib Number:* *${bib}*
🔖 *Reference Code:* ${runner.reg_code}
🏁 *Race Category:* ${raceCategory}
👕 *T-Shirt Size:* ${runner.shirt_size || "Standard"}
📅 *Race Date:* Sunday, 17 January 2027
⏰ *Schedule:* ${scheduleTimes}
📍 *Venue:* De Paul Institute of Science & Technology (DiST), Angamaly${groupText}

📦 *Bib & Kit Distribution:*
Saturday, 16 January 2027 (10:00 AM – 6:00 PM) at DiST, Angamaly.
_Please show this confirmation message or your photo ID at the kit counter._

📄 *View Your Digital Confirmation Slip:*
${slipUrl}

See you at the starting line!
_Angamaly Sports Association & Jeevadhara Foundation_`;

    return encodeURIComponent(text);
  }

  function generatePendingWhatsAppMessage(runner) {
    if (!runner) return "";
    const origin = window.location.origin;
    const slipUrl = `${origin}/confirmation.html?code=${runner.reg_code}`;
    const text = `Hi ${runner.full_name}, this is from Angamaly Marathon 2027 organizing committee regarding your registration (${runner.reg_code}).

You can view your registration details and check verification status here:
${slipUrl}

For assistance, reply to this message.`;
    return encodeURIComponent(text);
  }

  // 5. Render Table
  function renderTable() {
    const query = (tableSearch?.value || "").toLowerCase().trim();
    const stFilter = filterStatus?.value || "";
    const catFilter = filterCategory?.value || "";
    const feeFilter = filterFeeType?.value || "";
    const shirtFilter = filterShirt?.value || "";
    const genderFilter = filterGender?.value || "";

    const filtered = allRegistrations.filter((r) => {
      // If runner was just verified in this modal session, keep visible so admin sees the approved confirmation
      if (activeModalReg && r.id === activeModalReg.id && stFilter === "pending" && r.payment_status === "verified") {
        return true;
      }
      if (stFilter && r.payment_status !== stFilter) return false;
      if (catFilter && r.category !== catFilter) return false;

      // Fee Type filter
      if (feeFilter) {
        if (feeFilter === "student_group") {
          if (r.fee_type !== "student_group") return false;
        } else if (feeFilter === "student") {
          if (r.fee_type !== "student" && r.fee_type !== "student_early") return false;
        } else if (feeFilter === "individual") {
          if (r.fee_type !== "regular" && r.fee_type !== "early") return false;
        }
      }

      // T-Shirt filter
      if (shirtFilter) {
        let shirtMatch = r.shirt_size === shirtFilter;
        if (!shirtMatch && (r.fee_type === "student_group" || r.group_members)) {
          let members = r.group_members;
          if (typeof members === "string") {
            try { members = JSON.parse(members); } catch (e) { members = []; }
          }
          if (Array.isArray(members)) {
            shirtMatch = members.some((m) => m.shirt_size === shirtFilter);
          }
        }
        if (!shirtMatch) return false;
      }

      // Gender filter
      if (genderFilter && r.gender !== genderFilter) return false;

      // Search Query
      if (query) {
        let memberText = "";
        if (r.group_members) {
          let members = r.group_members;
          if (typeof members === "string") {
            try { members = JSON.parse(members); } catch (e) { members = []; }
          }
          if (Array.isArray(members)) {
            memberText = members.map((m) => `${m.name || ""} ${m.phone || ""} ${m.bib_number || ""}`).join(" ");
          }
        }
        const hay = `${r.full_name} ${r.email} ${r.phone} ${r.reg_code} ${r.utr_number} ${r.bib_number || ""} ${memberText}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    if (filterStatsBadge) {
      filterStatsBadge.textContent = `Showing ${filtered.length} of ${allRegistrations.length} runners`;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--muted)">No matching registrations found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered
      .map((r) => {
        const isVerified = r.payment_status === "verified";
        const isRejected = r.payment_status === "rejected";

        const statusBadge = isVerified
          ? `<span class="badge-status status-verified">Verified</span>`
          : isRejected
          ? `<span class="badge-status status-rejected">Rejected</span>`
          : `<span class="badge-status status-pending">Pending</span>`;

        const waText = isVerified
          ? generateWhatsAppMessage(r, r.bib_number)
          : generatePendingWhatsAppMessage(r);
        const cleanPhone = (r.phone || "").replace(/[^0-9]/g, "");
        const waTitle = isVerified ? "Send Official WhatsApp Confirmation Slip" : "WhatsApp Runner";
        const waLabel = isVerified ? "📲 WA Slip" : "WA";

        const isNewClass = r._isJustReceived ? ' class="new-row-flash"' : '';

        // Student indicators
        const isStudentEarly = r.fee_type === "student_early";
        const isStudentRegular = r.fee_type === "student";
        const isStudent = isStudentEarly || isStudentRegular;
        const isGroup = r.fee_type === "student_group" || (Array.isArray(r.group_members) && r.group_members.length > 0);
        let studentCategoryBadge = "";
        if (isGroup) {
          studentCategoryBadge = `<br><span class="student-badge" style="background:#ede9fe;color:#5b21b6;border:1px solid #ddd6fe">👥 Student Group (5)</span>`;
        } else if (isStudentEarly) {
          studentCategoryBadge = `<br><span class="student-badge">🎓 Student (Early ₹300)</span>`;
        } else if (isStudentRegular) {
          studentCategoryBadge = `<br><span class="student-badge">🎓 Student (Normal ₹350)</span>`;
        }

        const studentProofBtn = r.student_proof_url
          ? `<br><button type="button" class="thumb-btn-student" onclick="openProofModal('${r.id}', 'student')" title="Inspect Student ID Proof">🎓 Student ID</button>`
          : ((isStudent || isGroup) ? `<br><small style="color:#b91c1c;font-weight:700">⚠️ No Student ID</small>` : "");

        // Dynamic Verification Action Buttons
        let actionButtons = "";
        if (isVerified) {
          actionButtons = `
            <div class="action-btn-row">
              <button type="button" class="btn-approved" onclick="openProofModal('${r.id}')" title="Registration Approved (Bib: ${r.bib_number || 'Assigned'}) • Click to edit Bib">✓ Approved</button>
              <a class="btn-wa" href="https://wa.me/91${cleanPhone}?text=${waText}" target="_blank" title="${waTitle}">📲 Slip</a>
              <button type="button" class="btn-reject" onclick="quickReject('${r.id}')" title="Reject / Revoke">✕</button>
            </div>
          `;
        } else if (isRejected) {
          actionButtons = `
            <div class="action-btn-row">
              <button type="button" class="btn-rejected-status" onclick="openProofModal('${r.id}')" title="Rejected • Click to re-approve">✕ Rejected</button>
              <button type="button" class="btn-verify" onclick="openProofModal('${r.id}')" title="Re-approve Runner">✓</button>
              <a class="btn-wa" href="https://wa.me/91${cleanPhone}?text=${waText}" target="_blank" title="${waTitle}">WA</a>
            </div>
          `;
        } else {
          actionButtons = `
            <div class="action-btn-row">
              <button type="button" class="btn-verify" onclick="openProofModal('${r.id}')" title="Inspect Payment Proof & Approve">✓ Approve</button>
              <a class="btn-wa" href="https://wa.me/91${cleanPhone}?text=${waText}" target="_blank" title="${waTitle}">${waLabel}</a>
              <button type="button" class="btn-reject" onclick="quickReject('${r.id}')" title="Reject">✕</button>
            </div>
          `;
        }

        return `
        <tr${isNewClass}>
          <td>
            <button type="button" class="reg-code-btn" onclick="openRunnerDetailsModal('${r.id}')" title="Click to view full runner details">
              <strong>${r.reg_code || "—"}</strong> 👁️
            </button>
            <br><small style="color:var(--muted)">${new Date(r.created_at).toLocaleDateString()}</small>
          </td>
          <td>
            <strong>${r.full_name}</strong><br>
            <small style="color:var(--muted)">📱 ${r.phone} • 🩸 ${r.blood_group}</small><br>
            <small style="color:var(--muted)">✉️ ${r.email}</small>
          </td>
          <td>
            <span style="font-weight:800;color:var(--blue)">${r.category}</span>
            ${studentCategoryBadge}
            <br><small style="color:var(--muted)">Size: ${r.shirt_size}</small>
          </td>
          <td>
            <strong>₹${r.amount_payable}</strong> ${isGroup ? '<span style="font-size:12px;color:var(--blue);font-weight:700">(Group of 5)</span>' : `(${r.payment_provider})`}<br>
            <code style="font-size:12px;background:#f0f4f9;padding:2px 5px;border-radius:4px">${(r.utr_number && r.utr_number !== "IN_PROOF") ? r.utr_number : "In Screenshot"}</code>
          </td>
          <td>
            <button type="button" class="thumb-btn" onclick="openProofModal('${r.id}', 'payment')">🔍 Receipt</button>
            ${studentProofBtn}
          </td>
          <td>${statusBadge}</td>
          <td><strong>${r.bib_number || "—"}</strong>${isGroup ? '<br><small style="color:var(--muted);font-weight:700">+4 members</small>' : ''}</td>
          <td>
            ${actionButtons}
          </td>
        </tr>
      `;
      })
      .join("");
  }

  // 6. Verification Modal & Actions
  function setProofModalTab(tab) {
    if (!modalTabPayment || !modalTabStudent || !modalPaymentView || !modalStudentView) return;
    if (tab === "student") {
      modalTabPayment.classList.remove("active");
      modalTabStudent.classList.add("active");
      modalPaymentView.style.display = "none";
      modalStudentView.style.display = "block";
    } else {
      modalTabStudent.classList.remove("active");
      modalTabPayment.classList.add("active");
      modalStudentView.style.display = "none";
      modalPaymentView.style.display = "block";
    }
  }

  modalTabPayment?.addEventListener("click", () => setProofModalTab("payment"));
  modalTabStudent?.addEventListener("click", () => setProofModalTab("student"));

  const CATEGORY_BIB_CONFIG = {
    "21.1K": { base: 12111, min: 12000, max: 12999 },
    "10K":   { base: 13111, min: 13000, max: 13999 },
    "5K":    { base: 14111, min: 14000, max: 14999 }
  };

  function getSuggestedNextBib(category) {
    const cfg = CATEGORY_BIB_CONFIG[category] || { base: 10001, min: 10000, max: 99999 };
    const base = cfg.base;

    // Collect all assigned numeric bibs in this category (primary + group members)
    const assignedNums = [];

    allRegistrations.forEach((r) => {
      if (r.category === category) {
        if (r.bib_number) {
          const n = parseInt(r.bib_number, 10);
          if (!isNaN(n) && n >= cfg.min && n <= cfg.max) {
            assignedNums.push(n);
          }
        }
        // Accompanying group members
        let members = r.group_members;
        if (typeof members === "string") {
          try { members = JSON.parse(members); } catch (e) { members = []; }
        }
        if (Array.isArray(members)) {
          members.forEach((m) => {
            if (m.bib_number) {
              const mn = parseInt(m.bib_number, 10);
              if (!isNaN(mn) && mn >= cfg.min && mn <= cfg.max) {
                assignedNums.push(mn);
              }
            }
          });
        }
      }
    });

    if (assignedNums.length === 0) {
      return String(base);
    }

    const maxAssigned = Math.max(...assignedNums);
    const nextNum = Math.max(base, maxAssigned + 1);
    return String(nextNum);
  }

  function findBibConflict(targetBib, currentRegId) {
    if (!targetBib) return null;
    const cleanTarget = String(targetBib).trim();
    if (!cleanTarget) return null;

    for (const r of allRegistrations) {
      if (r.id !== currentRegId) {
        if (r.bib_number && String(r.bib_number).trim() === cleanTarget) {
          return { runner: r, isLeader: true };
        }
        let members = r.group_members;
        if (typeof members === "string") {
          try { members = JSON.parse(members); } catch (e) { members = []; }
        }
        if (Array.isArray(members)) {
          for (const m of members) {
            if (m.bib_number && String(m.bib_number).trim() === cleanTarget) {
              return { runner: r, memberName: m.name };
            }
          }
        }
      }
    }
    return null;
  }

  function autoFillConsecutiveBibs() {
    const primaryBib = modalBibInput?.value.trim() || "";
    if (!primaryBib) return;
    const match = primaryBib.match(/^(.*?)(\d+)$/);
    if (!match) return;
    const prefix = match[1];
    let num = parseInt(match[2], 10);
    const padLen = match[2].length;

    const inputs = document.querySelectorAll(".modal-group-bib-input");
    inputs.forEach((inp) => {
      num++;
      inp.value = `${prefix}${String(num).padStart(padLen, "0")}`;
    });
  }

  document.getElementById("modalAutoFillBibsBtn")?.addEventListener("click", autoFillConsecutiveBibs);
  modalBibInput?.addEventListener("change", () => {
    if (activeModalReg && (activeModalReg.fee_type === "student_group" || activeModalReg.group_members)) {
      const inputs = document.querySelectorAll(".modal-group-bib-input");
      const hasAny = Array.from(inputs).some((i) => i.value.trim() !== "");
      if (!hasAny) {
        autoFillConsecutiveBibs();
      }
    }
  });

  window.openProofModal = function (id, defaultTab = "payment") {
    const reg = allRegistrations.find((item) => item.id === id);
    if (!reg) return;
    activeModalReg = reg;

    const utrDisplay = (!reg.utr_number || reg.utr_number === "IN_PROOF") ? "In Screenshot" : reg.utr_number;
    const feeTypeName = reg.fee_type === "student_group"
      ? "Student Group (5)"
      : (reg.fee_type === "student_early"
        ? "Student (Early ₹300)"
        : (reg.fee_type === "student" ? "Student (Normal ₹350)" : reg.fee_type));
    modalRunnerName.textContent = `${reg.full_name} • ${reg.reg_code}`;
    modalMeta.textContent = `Race: ${reg.category} | Fee: ₹${reg.amount_payable} (${feeTypeName}) | UTR: ${utrDisplay} | Status: ${reg.payment_status}`;
    const paymentUrl = normalizeMediaUrl(reg.payment_proof_url);
    modalImg.src = paymentUrl || "";
    modalFullImgLink.href = paymentUrl || "#";

    // Setup Student proof switcher & views
    const studentProofUrl = normalizeMediaUrl(reg.student_proof_url);
    const hasStudentProof = !!studentProofUrl;
    const isStudent = reg.fee_type === "student" || reg.fee_type === "student_early";
    const isGroup = reg.fee_type === "student_group" || (Array.isArray(reg.group_members) && reg.group_members.length > 0);

    if (modalProofSwitcher) {
      modalProofSwitcher.style.display = (hasStudentProof || isStudent || isGroup) ? "flex" : "none";
    }

    if (hasStudentProof) {
      modalStudentLink.href = studentProofUrl;
      const isPdf = (studentProofUrl || "").toLowerCase().includes(".pdf");
      if (isPdf) {
        modalStudentImg.style.display = "none";
        modalStudentPdfWrap.style.display = "block";
        modalStudentPdfBtn.href = studentProofUrl;
      } else {
        modalStudentImg.style.display = "block";
        modalStudentImg.src = studentProofUrl;
        modalStudentPdfWrap.style.display = "none";
      }
      modalStudentMissingAlert.style.display = "none";
    } else if (isStudent || isGroup) {
      modalStudentImg.style.display = "none";
      modalStudentPdfWrap.style.display = "none";
      modalStudentMissingAlert.style.display = "block";
      modalStudentMissingAlert.textContent = isGroup
        ? "⚠️ Student Group discount claimed, but no Student ID proof was uploaded for Applicant #1."
        : "⚠️ Student discount was claimed, but no Student ID document was uploaded.";
    }

    // Switch to requested or default tab
    setProofModalTab(defaultTab === "student" && (hasStudentProof || isStudent || isGroup) ? "student" : "payment");

    // Suggest Next Bib Number according to category (21.1K: 12111, 10K: 13111, 5K: 14111)
    const cfg = CATEGORY_BIB_CONFIG[reg.category] || { base: 12111 };
    modalBibInput.placeholder = `e.g. ${cfg.base}`;

    if (!reg.bib_number) {
      modalBibInput.value = getSuggestedNextBib(reg.category);
    } else {
      modalBibInput.value = reg.bib_number;
    }

    // Render Group Bib Inputs (Students #2 – #5)
    const groupBibWrap = document.getElementById("modalGroupBibWrap");
    const groupBibList = document.getElementById("modalGroupBibInputsList");
    if (groupBibWrap && groupBibList) {
      groupBibWrap.style.display = isGroup ? "block" : "none";
      if (isGroup) {
        let members = reg.group_members;
        if (typeof members === "string") {
          try { members = JSON.parse(members); } catch (e) { members = []; }
        }
        if (Array.isArray(members) && members.length > 0) {
          const leaderNum = parseInt(modalBibInput.value, 10);
          groupBibList.innerHTML = members.map((m, idx) => {
            const mIdx = m.member_index || (idx + 2);
            const placeholderVal = !isNaN(leaderNum) ? `${leaderNum + (idx + 1)}` : `e.g. ${cfg.base + (idx + 1)}`;
            return `
              <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #d5e2f0">
                <label style="display:block;font-size:11.5px;font-weight:700;color:var(--muted);margin-bottom:3px">Student #${mIdx}: ${m.name || 'Member'} (${m.shirt_size || 'M'})</label>
                <input type="text" class="modal-group-bib-input" data-index="${mIdx}" value="${m.bib_number || ''}" placeholder="${placeholderVal}" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-weight:700;font-size:13px">
              </div>
            `;
          }).join("");
        } else {
          groupBibList.innerHTML = `<div style="font-size:12.5px;color:var(--muted)">No additional group members found.</div>`;
        }
      }
    }

    // Auto-prefill member bibs if not yet assigned
    if (isGroup && !reg.bib_number) {
      autoFillConsecutiveBibs();
    }

    // Reset or display WhatsApp dispatch link
    if (modalWaDispatchWrap && modalWaBtn) {
      if (reg.payment_status === "verified") {
        const cleanPhone = (reg.phone || "").replace(/[^0-9]/g, "");
        const waMsg = generateWhatsAppMessage(reg, reg.bib_number);
        modalWaBtn.href = `https://wa.me/91${cleanPhone}?text=${waMsg}`;
        if (modalWaStatusMsg) modalWaStatusMsg.textContent = `✓ Already Verified (Bib: ${reg.bib_number})`;
        modalWaDispatchWrap.style.display = "block";
      } else {
        modalWaDispatchWrap.style.display = "none";
      }
    }

    if (modalVerifyBtn) {
      modalVerifyBtn.disabled = false;
      if (reg.payment_status === "verified") {
        modalVerifyBtn.className = "btn-approved";
        modalVerifyBtn.textContent = `✓ Approved (Bib: ${reg.bib_number || 'Assigned'}) • Click to Update`;
      } else {
        modalVerifyBtn.className = "btn-verify";
        modalVerifyBtn.textContent = "✓ Approve Registration";
      }
    }

    proofModal.style.display = "grid";
  };

  window.closeModal = function () {
    proofModal.style.display = "none";
    activeModalReg = null;
  };

  // 7. Runner Full Details Modal Handlers
  window.openRunnerDetailsModal = function (id) {
    const reg = allRegistrations.find((item) => item.id === id);
    if (!reg) return;

    const rdModal = document.getElementById("runnerDetailsModal");
    if (!rdModal) return;

    // Set Header
    document.getElementById("rdFullName").textContent = reg.full_name || "Runner";
    document.getElementById("rdRegCode").textContent = reg.reg_code || "—";
    document.getElementById("rdBibNumber").textContent = reg.bib_number || "Not Assigned";
    document.getElementById("rdCreatedAt").textContent = reg.created_at ? new Date(reg.created_at).toLocaleString("en-IN") : "—";

    const isStudentEarly = reg.fee_type === "student_early";
    const isStudentRegular = reg.fee_type === "student";
    const isStudent = isStudentEarly || isStudentRegular;
    const isGroup = reg.fee_type === "student_group" || (Array.isArray(reg.group_members) && reg.group_members.length > 0);
    const studentBadge = document.getElementById("rdStudentBadge");
    if (studentBadge) {
      studentBadge.style.display = (isStudent || isGroup) ? "inline-flex" : "none";
      if (isGroup) {
        studentBadge.textContent = "👥 Student Group (5 Nos • ₹1,000)";
        studentBadge.style.background = "#ede9fe";
        studentBadge.style.color = "#5b21b6";
      } else if (isStudentEarly) {
        studentBadge.textContent = "🎓 Student (Early • ₹300)";
        studentBadge.style.background = "";
        studentBadge.style.color = "";
      } else {
        studentBadge.textContent = "🎓 Student (Normal • ₹350)";
        studentBadge.style.background = "";
        studentBadge.style.color = "";
      }
    }

    const statusBadge = document.getElementById("rdStatusBadge");
    if (statusBadge) {
      statusBadge.className = `badge-status status-${reg.payment_status || "pending"}`;
      statusBadge.textContent = reg.payment_status === "verified" ? "Verified" : reg.payment_status === "rejected" ? "Rejected" : "Pending";
    }

    // Personal Details
    document.getElementById("rdGender").textContent = reg.gender || "—";
    document.getElementById("rdDob").textContent = reg.dob || "—";
    document.getElementById("rdAge").textContent = reg.age !== undefined && reg.age !== null ? `${reg.age} years` : "—";
    document.getElementById("rdBlood").textContent = reg.blood_group || "—";
    document.getElementById("rdBloodDonate").textContent = reg.blood_donation_interest || "—";
    document.getElementById("rdSource").textContent = reg.hear_source || "—";
    document.getElementById("rdAddress").textContent = reg.address || "—";

    // Race & Kit
    document.getElementById("rdCategory").textContent = reg.category || "—";
    document.getElementById("rdFeeType").textContent = isGroup
      ? "Group of Students (5 Nos • ₹1,000)"
      : (reg.fee_type === "student_early"
        ? "Early Bird Student (₹300)"
        : (reg.fee_type === "student" ? "Normal Student (₹350)" : (reg.fee_type === "early" ? "Early Bird" : "Regular")));
    document.getElementById("rdShirt").textContent = reg.shirt_size || "—";
    document.getElementById("rdAmount").textContent = "₹" + (reg.amount_payable || 0);
    document.getElementById("rdProvider").textContent = reg.payment_provider || "—";
    document.getElementById("rdUtr").textContent = (!reg.utr_number || reg.utr_number === "IN_PROOF") ? "In Screenshot" : reg.utr_number;
    document.getElementById("rdVerifiedAt").textContent = reg.verified_at ? new Date(reg.verified_at).toLocaleString("en-IN") : (reg.payment_status === "verified" ? "Verified" : "Not yet verified");

    // Contact & Emergency
    const cleanPhone = (reg.phone || "").replace(/[^0-9]/g, "");
    const phoneLink = document.getElementById("rdPhoneLink");
    if (phoneLink) {
      phoneLink.textContent = reg.phone || "—";
      phoneLink.href = `tel:+91${cleanPhone}`;
    }

    const emailLink = document.getElementById("rdEmailLink");
    if (emailLink) {
      emailLink.textContent = reg.email || "—";
      emailLink.href = `mailto:${reg.email || ""}`;
    }

    const emergClean = (reg.emergency_contact || "").replace(/[^0-9]/g, "");
    const emergLink = document.getElementById("rdEmergencyLink");
    if (emergLink) {
      emergLink.textContent = reg.emergency_contact || "—";
      emergLink.href = `tel:+91${emergClean}`;
    }

    // Additional Group Members Card
    const rdGroupCard = document.getElementById("rdGroupCard");
    const rdGroupList = document.getElementById("rdGroupMembersList");
    if (rdGroupCard && rdGroupList) {
      rdGroupCard.style.display = isGroup ? "block" : "none";
      if (isGroup) {
        let members = reg.group_members;
        if (typeof members === "string") {
          try { members = JSON.parse(members); } catch (e) { members = []; }
        }
        if (Array.isArray(members) && members.length > 0) {
          rdGroupList.innerHTML = members.map((m, idx) => {
            const mPhone = (m.phone || "").replace(/[^0-9]/g, "");
            return `
              <div style="background:#fff;border:1px solid #d5e2f0;border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;font-size:13.5px;flex-wrap:wrap;gap:8px">
                <div>
                  <span style="background:var(--blue);color:#fff;font-size:11px;font-weight:800;padding:2px 6px;border-radius:4px;margin-right:6px">Student #${m.member_index || (idx + 2)}</span>
                  <strong>${m.name || '—'}</strong>
                  <span style="color:var(--muted);font-size:12.5px;margin-left:8px">📞 <a href="tel:+91${mPhone}" style="color:var(--blue2)">${m.phone || '—'}</a></span>
                </div>
                <div style="display:flex;align-items:center;gap:12px">
                  <span style="font-weight:700;color:var(--muted)">T-Shirt: <strong style="color:var(--ink)">${m.shirt_size || '—'}</strong></span>
                  <span style="background:#eef4ff;color:var(--blue);font-weight:800;padding:2px 8px;border-radius:6px;font-size:12px">Bib: ${m.bib_number || 'Not Assigned'}</span>
                </div>
              </div>
            `;
          }).join("");
        } else {
          rdGroupList.innerHTML = `<div style="font-size:13px;color:var(--muted)">No additional member entries found.</div>`;
        }
      }
    }

    // Uploaded Proofs
    const paymentImg = document.getElementById("rdPaymentImg");
    const paymentLink = document.getElementById("rdPaymentLink");
    if (paymentImg && paymentLink) {
      paymentImg.src = reg.payment_proof_url || "";
      paymentLink.href = reg.payment_proof_url || "#";
    }

    const studentSection = document.getElementById("rdStudentSection");
    const studentImg = document.getElementById("rdStudentImg");
    const studentLink = document.getElementById("rdStudentLink");
    const studentPdfNotice = document.getElementById("rdStudentPdfNotice");
    const studentPdfBtn = document.getElementById("rdStudentPdfBtn");

    if (studentSection) {
      if (reg.student_proof_url || isStudent || isGroup) {
        studentSection.style.display = "block";
        if (reg.student_proof_url) {
          studentLink.href = reg.student_proof_url;
          const isPdf = reg.student_proof_url.toLowerCase().includes(".pdf");
          if (isPdf) {
            studentImg.style.display = "none";
            studentPdfNotice.style.display = "block";
            studentPdfBtn.href = reg.student_proof_url;
          } else {
            studentImg.style.display = "block";
            studentImg.src = reg.student_proof_url;
            studentPdfNotice.style.display = "none";
          }
        } else {
          studentImg.style.display = "none";
          studentPdfNotice.style.display = "block";
          studentPdfNotice.innerHTML = "<div style='color:#b91c1c;font-weight:700'>⚠️ Student claimed, but no ID document uploaded.</div>";
        }
      } else {
        studentSection.style.display = "none";
      }
    }

    // Action Buttons
    const rdVerifyActionBtn = document.getElementById("rdVerifyActionBtn");
    const rdWaActionBtn = document.getElementById("rdWaActionBtn");
    const rdSlipActionBtn = document.getElementById("rdSlipActionBtn");
    const rdRejectActionBtn = document.getElementById("rdRejectActionBtn");

    const isVerified = reg.payment_status === "verified";
    if (rdVerifyActionBtn) {
      rdVerifyActionBtn.textContent = isVerified ? "✓ Edit Bib / Re-Verify" : "✓ Verify & Assign Bib";
      rdVerifyActionBtn.onclick = () => {
        closeRunnerDetailsModal();
        openProofModal(reg.id);
      };
    }

    if (rdWaActionBtn) {
      const waText = isVerified ? generateWhatsAppMessage(reg, reg.bib_number) : generatePendingWhatsAppMessage(reg);
      rdWaActionBtn.href = `https://wa.me/91${cleanPhone}?text=${waText}`;
      rdWaActionBtn.style.display = "inline-flex";
    }

    if (rdSlipActionBtn) {
      rdSlipActionBtn.href = `${window.location.origin}/confirmation.html?code=${reg.reg_code}`;
    }

    if (rdRejectActionBtn) {
      rdRejectActionBtn.onclick = () => {
        closeRunnerDetailsModal();
        quickReject(reg.id);
      };
    }

    rdModal.style.display = "grid";
  };

  window.closeRunnerDetailsModal = function () {
    const rdModal = document.getElementById("runnerDetailsModal");
    if (rdModal) rdModal.style.display = "none";
  };

  async function callConfirmApi(regId, bibNumber, groupMembers = null) {
    const token = await getValidToken();
    if (!token) {
      throw new Error("Admin session expired. Please sign in again.");
    }

    const payload = {
      regId,
      bibNumber,
      sendEmail: true
    };
    if (groupMembers) {
      payload.groupMembers = groupMembers;
    }

    const res = await fetch(cfg.CONFIRM_ENDPOINT || "/api/confirm-registration", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Failed with status ${res.status}`);
    }
    return res.json();
  }

  window.quickVerify = function (id) {
    openProofModal(id);
  };

  window.quickReject = async function (id) {
    const reg = allRegistrations.find((x) => x.id === id);
    if (!reg) return;

    const reason = prompt(`Reason for rejecting ${reg.full_name}:`, "Payment reference / screenshot mismatch");
    if (reason === null) return;

    try {
      const token = await getValidToken();
      if (!token) {
        throw new Error("Admin session expired. Please sign in again.");
      }

      const res = await fetch(cfg.REJECT_ENDPOINT || "/api/reject-registration", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ regId: id, reason })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Rejection request failed (${res.status})`);
      }
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

    // Duplicate Bib Collision Check: primary runner bib
    const primaryConflict = findBibConflict(bib, activeModalReg.id);
    if (primaryConflict) {
      const conflictName = primaryConflict.memberName
        ? `${primaryConflict.memberName} (Member of ${primaryConflict.runner.full_name}'s team)`
        : primaryConflict.runner.full_name;
      const proceed = confirm(`⚠️ Warning: Bib #${bib} is already assigned to ${conflictName} (${primaryConflict.runner.reg_code}).\n\nDo you want to re-assign or continue anyway?`);
      if (!proceed) return;
    }

    let updatedGroupMembers = null;
    const isGroup = activeModalReg.fee_type === "student_group" || (Array.isArray(activeModalReg.group_members) && activeModalReg.group_members.length > 0);
    if (isGroup && activeModalReg.group_members) {
      let members = activeModalReg.group_members;
      if (typeof members === "string") {
        try { members = JSON.parse(members); } catch (e) { members = []; }
      }
      if (Array.isArray(members)) {
        const bibInputs = document.querySelectorAll(".modal-group-bib-input");
        updatedGroupMembers = members.map((m, idx) => {
          const input = bibInputs[idx];
          return {
            ...m,
            bib_number: input ? input.value.trim() : (m.bib_number || "")
          };
        });

        // Duplicate Bib Collision Check: group member bibs
        const assignedGroupBibs = [bib];
        for (const m of updatedGroupMembers) {
          const mBib = (m.bib_number || "").trim();
          if (mBib) {
            if (assignedGroupBibs.includes(mBib)) {
              alert(`⚠️ Error: Duplicate Bib #${mBib} assigned within the same group.`);
              return;
            }
            assignedGroupBibs.push(mBib);
            const memberConflict = findBibConflict(mBib, activeModalReg.id);
            if (memberConflict) {
              const conflictName = memberConflict.memberName
                ? `${memberConflict.memberName} (Member of ${memberConflict.runner.full_name}'s team)`
                : memberConflict.runner.full_name;
              const proceed = confirm(`⚠️ Warning: Member Bib #${mBib} is already assigned to ${conflictName} (${memberConflict.runner.reg_code}).\n\nDo you want to continue anyway?`);
              if (!proceed) return;
            }
          }
        }
      }
    }

    modalVerifyBtn.disabled = true;
    modalVerifyBtn.textContent = "Verifying...";

    try {
      const result = await callConfirmApi(activeModalReg.id, bib, updatedGroupMembers);

      // Immediately update activeModalReg
      activeModalReg.payment_status = "verified";
      activeModalReg.bib_number = bib;
      if (updatedGroupMembers) {
        activeModalReg.group_members = updatedGroupMembers;
      }
      activeModalReg.verified_at = new Date().toISOString();

      // Immediately update allRegistrations matching entry
      const idx = allRegistrations.findIndex((x) => x.id === activeModalReg.id);
      if (idx !== -1) {
        allRegistrations[idx] = { ...allRegistrations[idx], ...activeModalReg };
      }

      // Update modalVerifyBtn state to Approved!
      modalVerifyBtn.disabled = false;
      modalVerifyBtn.className = "btn-approved";
      modalVerifyBtn.textContent = `✓ Approved (Bib: ${bib})`;

      // Update metrics & immediately re-render table to display "✓ Approved"
      updateMetrics();
      renderTable();

      // Show WhatsApp Dispatch button in modal
      if (modalWaDispatchWrap && modalWaBtn) {
        const cleanPhone = (activeModalReg.phone || "").replace(/[^0-9]/g, "");
        const waMsg = generateWhatsAppMessage(activeModalReg, bib);
        modalWaBtn.href = `https://wa.me/91${cleanPhone}?text=${waMsg}`;

        let statusNote = `✓ Verified! Bib: ${bib}`;
        if (result.email?.success) {
          statusNote += " (Confirmation email sent)";
        } else {
          statusNote += " (Email delivery skipped / custom domain not yet connected)";
        }
        if (modalWaStatusMsg) modalWaStatusMsg.textContent = statusNote;
        modalWaDispatchWrap.style.display = "block";
      }

      showToast(`✓ Verified ${activeModalReg.full_name} (${bib})`);

      const emailNote = result.email?.success
        ? "Email sent successfully!"
        : "Email not delivered (custom domain is not yet verified on Resend).\n\nYou can click 'Open WhatsApp Confirmation' below to send the official slip to the runner!";
      alert(`✓ Registration Verified!\nAssigned Bib: ${bib}\n\n${emailNote}`);

      loadRegistrations();
    } catch (e) {
      alert(`Error: ${e.message}`);
      modalVerifyBtn.disabled = false;
      modalVerifyBtn.className = activeModalReg?.payment_status === "verified" ? "btn-approved" : "btn-verify";
      modalVerifyBtn.textContent = activeModalReg?.payment_status === "verified" ? `✓ Approved (Bib: ${activeModalReg.bib_number || 'Assigned'})` : "✓ Approve Registration";
    } finally {
      if (activeModalReg?.payment_status === "verified") {
        modalVerifyBtn.disabled = false;
        modalVerifyBtn.className = "btn-approved";
        modalVerifyBtn.textContent = `✓ Approved (Bib: ${activeModalReg.bib_number || 'Assigned'})`;
      } else {
        modalVerifyBtn.disabled = false;
        modalVerifyBtn.className = "btn-verify";
        modalVerifyBtn.textContent = "✓ Approve Registration";
      }
    }
  });

  modalRejectBtn?.addEventListener("click", () => {
    if (!activeModalReg) return;
    const regId = activeModalReg.id;
    closeModal();
    quickReject(regId);
  });

  // ==========================================
  // 6. PRO EXPORT SUITE & 360° FILTER ENGINE
  // ==========================================
  const exportModal = document.getElementById("exportModal");
  const tabBtnExportPresets = document.getElementById("tabBtnExportPresets");
  const tabBtnExportCustom = document.getElementById("tabBtnExportCustom");
  const paneExportPresets = document.getElementById("paneExportPresets");
  const paneExportCustom = document.getElementById("paneExportCustom");
  const exportPreviewBadge = document.getElementById("exportPreviewBadge");
  const exportLiveCount = document.getElementById("exportLiveCount");
  const exportLiveHint = document.getElementById("exportLiveHint");
  const btnExecuteDownload = document.getElementById("btnExecuteDownload");
  const exportColumnsGrid = document.getElementById("exportColumnsGrid");
  const btnSelectAllCols = document.getElementById("btnSelectAllCols");
  const btnDeselectAllCols = document.getElementById("btnDeselectAllCols");

  const exportFilterStatus = document.getElementById("exportFilterStatus");
  const exportFilterCategory = document.getElementById("exportFilterCategory");
  const exportFilterFeeType = document.getElementById("exportFilterFeeType");
  const exportFilterShirt = document.getElementById("exportFilterShirt");
  const exportFilterGender = document.getElementById("exportFilterGender");
  const exportGroupMode = document.getElementById("exportGroupMode");

  let currentExportTab = "presets"; // "presets" | "custom"
  let activePresetKey = "timing";
  let columnsGridInitialized = false;

  const ALL_EXPORT_COLUMNS = [
    { id: "bib_number", label: "Bib Number", default: true, get: (r, m) => m ? (m.bib_number || "") : (r.bib_number || "") },
    { id: "reg_code", label: "Registration Code", default: true, get: (r, m) => m ? (r.reg_code ? `${r.reg_code}-M${m.member_index}` : "") : (r.reg_code || "") },
    { id: "full_name", label: "Participant Name", default: true, get: (r, m) => m ? (m.name || "") : (r.full_name || "") },
    { id: "category", label: "Race Category", default: true, get: (r, m) => r.category || "" },
    { id: "gender", label: "Gender", default: true, get: (r, m) => m ? "" : (r.gender || "") },
    { id: "dob", label: "Date of Birth", default: true, get: (r, m) => m ? "" : (r.dob || "") },
    { id: "age", label: "Age on Race Day", default: true, get: (r, m) => m ? "" : (r.age || "") },
    { id: "phone", label: "Mobile Number", default: true, get: (r, m) => m ? (m.phone || "") : (r.phone || "") },
    { id: "email", label: "Email Address", default: true, get: (r, m) => r.email || "" },
    { id: "emergency_contact", label: "Emergency Contact", default: true, get: (r, m) => m ? (r.phone || r.emergency_contact || "") : (r.emergency_contact || "") },
    { id: "blood_group", label: "Blood Group", default: true, get: (r, m) => m ? "" : (r.blood_group || "") },
    { id: "blood_donation", label: "Blood Donation Interest", default: false, get: (r, m) => m ? "" : (r.blood_donation_interest || "") },
    { id: "shirt_size", label: "T-Shirt Size", default: true, get: (r, m) => m ? (m.shirt_size || "") : (r.shirt_size || "") },
    { id: "fee_type", label: "Registration Type", default: true, get: (r, m) => {
        if (m) return `Student Group (Member #${m.member_index})`;
        if (r.fee_type === 'student_group') return 'Student Group (Leader)';
        if (r.fee_type === 'student_early') return 'Student (Early Bird ₹300)';
        if (r.fee_type === 'student') return 'Student (Normal ₹350)';
        if (r.fee_type === 'early') return 'Individual (Early Bird)';
        return 'Individual (Regular)';
      }
    },
    { id: "amount_payable", label: "Amount Payable (INR)", default: true, get: (r, m) => m ? "0" : (r.amount_payable || "") },
    { id: "payment_provider", label: "Payment Provider", default: false, get: (r, m) => r.payment_provider || "" },
    { id: "payment_status", label: "Payment Status", default: true, get: (r, m) => r.payment_status || "" },
    { id: "utr_number", label: "UTR Number", default: true, get: (r, m) => r.utr_number || "" },
    { id: "payment_proof_url", label: "Payment Receipt URL (R2)", default: false, get: (r, m) => r.payment_proof_url || "" },
    { id: "student_proof_url", label: "Student ID Proof URL (R2)", default: false, get: (r, m) => r.student_proof_url || "" },
    { id: "address", label: "Residential Address", default: false, get: (r, m) => (r.address || "").replace(/\n/g, " ") },
    { id: "hear_source", label: "Heard From", default: false, get: (r, m) => r.hear_source || "" },
    { id: "created_at", label: "Registration Date", default: true, get: (r, m) => r.created_at || "" },
    { id: "verified_at", label: "Bib Verification Note", default: false, get: (r, m) => (m ? (m.bib_number ? `Bib ${m.bib_number} Assigned` : "Bib Pending") : (r.bib_number ? `Bib ${r.bib_number} Assigned` : "Bib Pending")) }
  ];

  const PRESETS_CONFIG = {
    timing: {
      title: "Timing & Bib Vendor Roster",
      filenamePrefix: "Angamaly_Marathon_2027_Timing_Bibs",
      status: "verified",
      category: "",
      feeType: "",
      shirt: "",
      gender: "",
      groupMode: "roster",
      columns: ["bib_number", "reg_code", "full_name", "category", "gender", "dob", "age", "phone", "emergency_contact"]
    },
    tshirt: {
      title: "T-Shirt Kit Production & Counters",
      filenamePrefix: "Angamaly_Marathon_2027_TShirt_Distribution",
      status: "verified",
      category: "",
      feeType: "",
      shirt: "",
      gender: "",
      groupMode: "roster",
      columns: ["bib_number", "reg_code", "full_name", "shirt_size", "category", "phone", "fee_type"],
      sortByShirt: true
    },
    finance: {
      title: "Finance & Bank Reconciliation Audit",
      filenamePrefix: "Angamaly_Marathon_2027_Finance_Audit",
      status: "",
      category: "",
      feeType: "",
      shirt: "",
      gender: "",
      groupMode: "order",
      columns: ["reg_code", "full_name", "fee_type", "amount_payable", "payment_provider", "utr_number", "payment_status", "created_at"]
    },
    students: {
      title: "Student Verification Audit",
      filenamePrefix: "Angamaly_Marathon_2027_Student_Verification",
      status: "",
      category: "",
      feeType: "students_all",
      shirt: "",
      gender: "",
      groupMode: "roster",
      columns: ["reg_code", "full_name", "category", "fee_type", "amount_payable", "student_proof_url", "payment_status", "utr_number", "created_at"]
    },
    medical: {
      title: "Medical & Emergency Safety Desk",
      filenamePrefix: "Angamaly_Marathon_2027_Medical_Safety",
      status: "verified",
      category: "",
      feeType: "",
      shirt: "",
      gender: "",
      groupMode: "roster",
      columns: ["bib_number", "full_name", "category", "age", "gender", "blood_group", "emergency_contact", "phone"]
    },
    master: {
      title: "Complete Master Database",
      filenamePrefix: "Angamaly_Marathon_2027_Master_Database",
      status: "",
      category: "",
      feeType: "",
      shirt: "",
      gender: "",
      groupMode: "roster",
      columns: ALL_EXPORT_COLUMNS.map((c) => c.id)
    }
  };

  function initExportColumnsGrid() {
    if (columnsGridInitialized || !exportColumnsGrid) return;
    exportColumnsGrid.innerHTML = ALL_EXPORT_COLUMNS.map((c) => `
      <label class="column-chk-label">
        <input type="checkbox" class="export-col-chk" value="${c.id}" ${c.default ? "checked" : ""}>
        <span>${c.label}</span>
      </label>
    `).join("");

    exportColumnsGrid.querySelectorAll(".export-col-chk").forEach((chk) => {
      chk.addEventListener("change", updateExportModalPreview);
    });

    columnsGridInitialized = true;
  }

  btnSelectAllCols?.addEventListener("click", () => {
    exportColumnsGrid?.querySelectorAll(".export-col-chk").forEach((c) => (c.checked = true));
    updateExportModalPreview();
  });

  btnDeselectAllCols?.addEventListener("click", () => {
    exportColumnsGrid?.querySelectorAll(".export-col-chk").forEach((c) => (c.checked = false));
    updateExportModalPreview();
  });

  function getExportFilterCriteria() {
    if (currentExportTab === "presets") {
      const preset = PRESETS_CONFIG[activePresetKey] || PRESETS_CONFIG.timing;
      return {
        status: preset.status,
        category: preset.category,
        feeType: preset.feeType,
        shirt: preset.shirt,
        gender: preset.gender,
        groupMode: preset.groupMode,
        columns: preset.columns,
        sortByShirt: preset.sortByShirt || false,
        filenamePrefix: preset.filenamePrefix
      };
    }

    const selectedCols = [];
    exportColumnsGrid?.querySelectorAll(".export-col-chk:checked").forEach((chk) => {
      selectedCols.push(chk.value);
    });

    return {
      status: exportFilterStatus?.value || "",
      category: exportFilterCategory?.value || "",
      feeType: exportFilterFeeType?.value || "",
      shirt: exportFilterShirt?.value || "",
      gender: exportFilterGender?.value || "",
      groupMode: exportGroupMode?.value || "roster",
      columns: selectedCols.length > 0 ? selectedCols : ALL_EXPORT_COLUMNS.map((c) => c.id),
      sortByShirt: false,
      filenamePrefix: "Angamaly_Marathon_2027_Custom_Export"
    };
  }

  function getFilteredExportRecords(filters) {
    const status = filters.status || "";
    const cat = filters.category || "";
    const feeType = filters.feeType || "";
    const shirt = filters.shirt || "";
    const gender = filters.gender || "";
    const groupMode = filters.groupMode || "roster";

    const matchedRegs = allRegistrations.filter((r) => {
      if (status && r.payment_status !== status) return false;
      if (cat && r.category !== cat) return false;

      if (feeType) {
        if (feeType === "students_all") {
          if (r.fee_type !== "student" && r.fee_type !== "student_early" && r.fee_type !== "student_group") return false;
        } else if (feeType === "student_group") {
          if (r.fee_type !== "student_group") return false;
        } else if (feeType === "student") {
          if (r.fee_type !== "student" && r.fee_type !== "student_early") return false;
        } else if (feeType === "individual") {
          if (r.fee_type !== "regular" && r.fee_type !== "early") return false;
        }
      }

      if (shirt) {
        let match = r.shirt_size === shirt;
        if (!match && (r.fee_type === "student_group" || r.group_members)) {
          let members = r.group_members;
          if (typeof members === "string") {
            try { members = JSON.parse(members); } catch (e) { members = []; }
          }
          if (Array.isArray(members)) {
            match = members.some((m) => m.shirt_size === shirt);
          }
        }
        if (!match) return false;
      }

      if (gender && r.gender !== gender) return false;
      return true;
    });

    let rows = [];
    let totalFee = 0;

    if (groupMode === "order") {
      matchedRegs.forEach((r) => {
        rows.push({ reg: r, member: null });
        totalFee += Number(r.amount_payable) || 0;
      });
    } else {
      matchedRegs.forEach((r) => {
        // Leader row
        if (!shirt || r.shirt_size === shirt) {
          rows.push({ reg: r, member: null });
        }
        totalFee += Number(r.amount_payable) || 0;

        // Group members
        if (r.fee_type === "student_group" || r.group_members) {
          let members = r.group_members;
          if (typeof members === "string") {
            try { members = JSON.parse(members); } catch (e) { members = []; }
          }
          if (Array.isArray(members)) {
            members.forEach((m, idx) => {
              const mIdx = m.member_index || (idx + 2);
              const memberObj = { ...m, member_index: mIdx };
              if (!shirt || memberObj.shirt_size === shirt) {
                rows.push({ reg: r, member: memberObj });
              }
            });
          }
        }
      });
    }

    // Optional sort
    if (filters.sortByShirt) {
      const sizeOrder = { "XS / 34": 1, "S / 36": 2, "M / 38": 3, "L / 40": 4, "XL / 42": 5, "XXL / 44": 6 };
      rows.sort((a, b) => {
        const shirtA = a.member ? a.member.shirt_size : a.reg.shirt_size;
        const shirtB = b.member ? b.member.shirt_size : b.reg.shirt_size;
        const rankA = sizeOrder[shirtA] || 99;
        const rankB = sizeOrder[shirtB] || 99;
        if (rankA !== rankB) return rankA - rankB;
        return (a.reg.category || "").localeCompare(b.reg.category || "");
      });
    } else if (filters.status === "verified") {
      const catOrder = { "21.1K": 1, "10K": 2, "5K": 3 };
      rows.sort((a, b) => {
        const cA = catOrder[a.reg.category] || 99;
        const cB = catOrder[b.reg.category] || 99;
        if (cA !== cB) return cA - cB;
        const bibA = parseInt(a.member ? a.member.bib_number : a.reg.bib_number, 10) || 999999;
        const bibB = parseInt(b.member ? b.member.bib_number : b.reg.bib_number, 10) || 999999;
        return bibA - bibB;
      });
    }

    return { rows, matchedOrdersCount: matchedRegs.length, totalFee };
  }

  function updateExportModalPreview() {
    if (!exportModal || exportModal.style.display !== "grid") return;
    const criteria = getExportFilterCriteria();
    const result = getFilteredExportRecords(criteria);

    if (exportLiveCount) {
      const colCount = criteria.columns.length;
      exportLiveCount.textContent = `Ready to export: ${result.rows.length} participant rows across ${result.matchedOrdersCount} orders • Total Revenue: ₹${result.totalFee.toLocaleString("en-IN")}`;
    }
    if (exportPreviewBadge) {
      exportPreviewBadge.textContent = `${result.rows.length} Rows • ${criteria.columns.length} Cols`;
    }
    if (exportLiveHint) {
      const modeLabel = criteria.groupMode === "order" ? "Order Level (1 row/group)" : "Participant Roster (5 rows/group)";
      exportLiveHint.textContent = `Format: ${modeLabel} • UTF-8 BOM Excel Compatible`;
    }
  }

  window.openExportModal = function () {
    if (!exportModal) return;
    initExportColumnsGrid();

    // Sync custom filters from table toolbar on initial open
    if (exportFilterStatus && filterStatus) exportFilterStatus.value = filterStatus.value || "";
    if (exportFilterCategory && filterCategory) exportFilterCategory.value = filterCategory.value || "";
    if (exportFilterFeeType && filterFeeType) exportFilterFeeType.value = filterFeeType.value || "";
    if (exportFilterShirt && filterShirt) exportFilterShirt.value = filterShirt.value || "";
    if (exportFilterGender && filterGender) exportFilterGender.value = filterGender.value || "";

    exportModal.style.display = "grid";
    updateExportModalPreview();
  };

  window.closeExportModal = function () {
    if (exportModal) exportModal.style.display = "none";
  };

  function switchExportTab(tab) {
    currentExportTab = tab;
    if (tab === "presets") {
      tabBtnExportPresets?.classList.add("active");
      tabBtnExportCustom?.classList.remove("active");
      if (paneExportPresets) paneExportPresets.style.display = "block";
      if (paneExportCustom) paneExportCustom.style.display = "none";
    } else {
      tabBtnExportCustom?.classList.add("active");
      tabBtnExportPresets?.classList.remove("active");
      if (paneExportCustom) paneExportCustom.style.display = "block";
      if (paneExportPresets) paneExportPresets.style.display = "none";
    }
    updateExportModalPreview();
  }

  tabBtnExportPresets?.addEventListener("click", () => switchExportTab("presets"));
  tabBtnExportCustom?.addEventListener("click", () => switchExportTab("custom"));

  // Preset Card Clicks
  document.querySelectorAll(".preset-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".preset-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      activePresetKey = card.dataset.preset || "timing";
      updateExportModalPreview();
    });
  });

  // Custom Filter Change Listeners
  [exportFilterStatus, exportFilterCategory, exportFilterFeeType, exportFilterShirt, exportFilterGender, exportGroupMode].forEach((el) => {
    el?.addEventListener("change", updateExportModalPreview);
  });

  // Execute CSV Download
  btnExecuteDownload?.addEventListener("click", () => {
    if (allRegistrations.length === 0) {
      alert("No data available to export.");
      return;
    }

    const criteria = getExportFilterCriteria();
    const result = getFilteredExportRecords(criteria);

    if (result.rows.length === 0) {
      alert("No matching participant records found for the selected export criteria.");
      return;
    }

    const selectedColsDef = criteria.columns
      .map((colId) => ALL_EXPORT_COLUMNS.find((c) => c.id === colId))
      .filter(Boolean);

    const headers = selectedColsDef.map((c) => c.label);
    const csvRows = [];

    result.rows.forEach(({ reg, member }) => {
      const rowValues = selectedColsDef.map((c) => {
        const val = c.get(reg, member);
        const str = String(val === null || val === undefined ? "" : val)
          .replace(/"/g, '""')
          .replace(/\r?\n/g, " ");
        return `"${str}"`;
      });
      csvRows.push(rowValues.join(","));
    });

    const csvContent = "\uFEFF" + [headers.map((h) => `"${h}"`).join(","), ...csvRows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    const todayStr = new Date().toISOString().split("T")[0];
    const filename = `${criteria.filenamePrefix}_${todayStr}.csv`;

    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    closeExportModal();
    showToast(`✓ Exported ${result.rows.length} rows to ${filename}`);
  });

  // Open modal button from table toolbar
  btnOpenExportModal?.addEventListener("click", openExportModal);

  // Event Listeners for Live Table Filters
  tableSearch?.addEventListener("input", renderTable);
  filterStatus?.addEventListener("change", renderTable);
  filterCategory?.addEventListener("change", renderTable);
  filterFeeType?.addEventListener("change", renderTable);
  filterShirt?.addEventListener("change", renderTable);
  filterGender?.addEventListener("change", renderTable);

  btnResetFilters?.addEventListener("click", () => {
    if (tableSearch) tableSearch.value = "";
    if (filterStatus) filterStatus.value = "";
    if (filterCategory) filterCategory.value = "";
    if (filterFeeType) filterFeeType.value = "";
    if (filterShirt) filterShirt.value = "";
    if (filterGender) filterGender.value = "";
    renderTable();
  });

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

  // ==========================================
  // GALLERY MANAGER (CRUD + DRAG & DROP)
  // ==========================================
  let allGalleryPhotos = [];
  let dragSrcEl = null;
  let dragItem = null;
  let activeEditingPhoto = null;

  // Tabs
  const tabBtnRegistrations = document.getElementById("tabBtnRegistrations");
  const tabBtnTshirts = document.getElementById("tabBtnTshirts");
  const tabBtnGallery = document.getElementById("tabBtnGallery");
  const tabBtnSettings = document.getElementById("tabBtnSettings");
  const tabPaneRegistrations = document.getElementById("tabPaneRegistrations");
  const tabPaneTshirts = document.getElementById("tabPaneTshirts");
  const tabPaneGallery = document.getElementById("tabPaneGallery");
  const tabPaneSettings = document.getElementById("tabPaneSettings");
  const tabGalleryBadge = document.getElementById("tabGalleryBadge");
  const tabTshirtsBadge = document.getElementById("tabTshirtsBadge");

  // Gallery DOM
  const galleryDropzone = document.getElementById("galleryDropzone");
  const galleryFileInput = document.getElementById("galleryFileInput");
  const uploadStatusWrap = document.getElementById("uploadStatusWrap");
  const uploadStatusLabel = document.getElementById("uploadStatusLabel");
  const uploadStatusPercent = document.getElementById("uploadStatusPercent");
  const uploadProgressFill = document.getElementById("uploadProgressFill");

  const gallerySearch = document.getElementById("gallerySearch");
  const galleryFilterStatus = document.getElementById("galleryFilterStatus");
  const galleryStatsText = document.getElementById("galleryStatsText");
  const adminGalleryGrid = document.getElementById("adminGalleryGrid");

  // Gallery Pagination State & DOM
  const ADMIN_PER_PAGE = 20;
  let adminCurrentPage = 1;
  const adminGalleryPagination = document.getElementById("adminGalleryPagination");
  const adminPaginationInfo = document.getElementById("adminPaginationInfo");
  const adminPrevPageBtn = document.getElementById("adminPrevPageBtn");
  const adminNextPageBtn = document.getElementById("adminNextPageBtn");
  const adminPageNumbersGroup = document.getElementById("adminPageNumbersGroup");

  // Edit Modal DOM
  const editGalleryModal = document.getElementById("editGalleryModal");
  const editModalImg = document.getElementById("editModalImg");
  const editPhotoTitle = document.getElementById("editPhotoTitle");
  const editPhotoCaption = document.getElementById("editPhotoCaption");
  const editPhotoPublished = document.getElementById("editPhotoPublished");
  const saveEditPhotoBtn = document.getElementById("saveEditPhotoBtn");
  const cancelEditPhotoBtn = document.getElementById("cancelEditPhotoBtn");
  const closeEditModalBtn = document.getElementById("closeEditModalBtn");

  // Toast
  const adminToast = document.getElementById("adminToast");
  const adminToastMsg = document.getElementById("adminToastMsg");
  let toastTimeout = null;

  function showToast(msg) {
    if (!adminToast || !adminToastMsg) return;
    adminToastMsg.textContent = msg;
    adminToast.style.display = "flex";
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      adminToast.style.display = "none";
    }, 3200);
  }

  function switchTab(tab) {
    tabBtnRegistrations?.classList.remove("active");
    tabBtnTshirts?.classList.remove("active");
    tabBtnGallery?.classList.remove("active");
    tabBtnSettings?.classList.remove("active");

    if (tabPaneRegistrations) tabPaneRegistrations.style.display = "none";
    if (tabPaneTshirts) tabPaneTshirts.style.display = "none";
    if (tabPaneGallery) tabPaneGallery.style.display = "none";
    if (tabPaneSettings) tabPaneSettings.style.display = "none";

    if (tab === "tshirts") {
      tabBtnTshirts?.classList.add("active");
      if (tabPaneTshirts) tabPaneTshirts.style.display = "block";
      renderTshirtPrintingTracker();
      loadTshirtPrintingStatus();
    } else if (tab === "gallery") {
      tabBtnGallery?.classList.add("active");
      if (tabPaneGallery) tabPaneGallery.style.display = "block";
      // Lazy Tab Loading: only fetch gallery on first switch to gallery tab
      if (allGalleryPhotos.length === 0) {
        loadGalleryAdmin();
      }
    } else if (tab === "settings") {
      tabBtnSettings?.classList.add("active");
      if (tabPaneSettings) tabPaneSettings.style.display = "block";
      loadEventSettingsAdmin();
    } else {
      tabBtnRegistrations?.classList.add("active");
      if (tabPaneRegistrations) tabPaneRegistrations.style.display = "block";
    }
  }

  tabBtnRegistrations?.addEventListener("click", () => switchTab("registrations"));
  tabBtnTshirts?.addEventListener("click", () => switchTab("tshirts"));
  tabBtnGallery?.addEventListener("click", () => switchTab("gallery"));
  tabBtnSettings?.addEventListener("click", () => switchTab("settings"));

  // Fetch all gallery photos from Supabase
  async function loadGalleryAdmin() {
    if (!currentSession) return;
    try {
      const token = await getValidToken();
      if (!token) return;
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/gallery_images?order=display_order.asc`, {
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      allGalleryPhotos = await res.json();
      updateGalleryStats();
      renderGalleryGrid();
    } catch (err) {
      console.error("Failed to load gallery:", err);
      if (adminGalleryGrid) {
        adminGalleryGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:red;padding:30px">Failed to load gallery images: ${err.message}</div>`;
      }
    }
  }

  function updateGalleryStats() {
    const total = allGalleryPhotos.length;
    const published = allGalleryPhotos.filter((p) => p.is_published).length;
    const hidden = total - published;
    if (tabGalleryBadge) tabGalleryBadge.textContent = total;
    if (galleryStatsText) {
      galleryStatsText.textContent = `${total} Photos Total (${published} Published, ${hidden} Hidden)`;
    }
  }

  // Render Visual Photo Grid with 20-photo Pagination & Drag & Drop Reordering
  function renderGalleryGrid() {
    if (!adminGalleryGrid) return;
    const q = (gallerySearch?.value || "").toLowerCase().trim();
    const filter = galleryFilterStatus?.value || "all";

    const filtered = allGalleryPhotos.filter((item) => {
      const matchQ = (item.title || "").toLowerCase().includes(q) || (item.caption || "").toLowerCase().includes(q);
      const matchFilter = filter === "all" ? true : (filter === "published" ? item.is_published : !item.is_published);
      return matchQ && matchFilter;
    });

    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / ADMIN_PER_PAGE));
    if (adminCurrentPage > totalPages) adminCurrentPage = totalPages;
    if (adminCurrentPage < 1) adminCurrentPage = 1;

    if (totalCount === 0) {
      adminGalleryGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:50px;color:var(--muted)">No photos match your filter.</div>`;
      if (adminGalleryPagination) adminGalleryPagination.style.display = "none";
      return;
    }

    if (adminGalleryPagination) adminGalleryPagination.style.display = "flex";

    const startIdx = (adminCurrentPage - 1) * ADMIN_PER_PAGE;
    const pageItems = filtered.slice(startIdx, startIdx + ADMIN_PER_PAGE);
    const endIdx = startIdx + pageItems.length;

    if (adminPaginationInfo) {
      adminPaginationInfo.textContent = `Showing ${startIdx + 1}–${endIdx} of ${totalCount} photos (Page ${adminCurrentPage} of ${totalPages})`;
    }
    if (adminPrevPageBtn) {
      adminPrevPageBtn.disabled = adminCurrentPage === 1;
    }
    if (adminNextPageBtn) {
      adminNextPageBtn.disabled = adminCurrentPage === totalPages;
    }

    renderAdminPageButtons(totalPages);

    adminGalleryGrid.innerHTML = "";
    const fragment = document.createDocumentFragment();

    pageItems.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "gallery-admin-card";
      card.draggable = true;
      card.dataset.id = item.id;
      card.dataset.index = startIdx + index;

      card.innerHTML = `
        <div class="card-media">
          <img src="${normalizeMediaUrl(item.image_url)}" alt="${item.title || 'Photo'}" loading="lazy" onerror="if(this.src.endsWith('.webp')){this.src=this.src.replace('.webp','.jpg')}">
          <div class="drag-handle" title="Drag to reorder">⠿ Drag</div>
          <div class="card-order-badge">#${item.display_order || (startIdx + index + 1)}</div>
        </div>
        <div class="card-body">
          <div class="card-title-text" title="${item.title}">${item.title || 'Untitled'}</div>
          <span class="card-status-badge ${item.is_published ? 'status-published' : 'status-hidden'}">
            ${item.is_published ? '● Live' : '○ Hidden'}
          </span>
          <div class="card-actions-row">
            <button type="button" class="btn-card-action btn-edit" title="Edit title and details">✏️ Edit</button>
            <button type="button" class="btn-card-action btn-toggle-vis" title="${item.is_published ? 'Hide from live gallery' : 'Publish to live gallery'}">
              ${item.is_published ? '👁️ Hide' : '👁️ Show'}
            </button>
            <button type="button" class="btn-card-action btn-card-del" title="Delete photo">🗑️</button>
          </div>
        </div>
      `;

      // Actions
      card.querySelector(".btn-edit").addEventListener("click", () => openEditPhotoModal(item));
      card.querySelector(".btn-toggle-vis").addEventListener("click", () => togglePhotoVisibility(item));
      card.querySelector(".btn-card-del").addEventListener("click", () => deletePhoto(item));

      // Drag and Drop Events for Reordering
      card.addEventListener("dragstart", (e) => handleDragStart(e, card, item));
      card.addEventListener("dragenter", (e) => handleDragEnter(e, card));
      card.addEventListener("dragover", handleDragOver);
      card.addEventListener("dragleave", (e) => handleDragLeave(e, card));
      card.addEventListener("drop", (e) => handleDrop(e, card, item));
      card.addEventListener("dragend", handleDragEnd);

      fragment.appendChild(card);
    });

    adminGalleryGrid.appendChild(fragment);
  }

  function renderAdminPageButtons(totalPages) {
    if (!adminPageNumbersGroup) return;
    adminPageNumbersGroup.innerHTML = "";
    for (let p = 1; p <= totalPages; p++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `page-btn ${p === adminCurrentPage ? 'active' : ''}`;
      btn.textContent = p;
      btn.setAttribute("aria-label", `Page ${p}`);
      btn.addEventListener("click", () => {
        if (adminCurrentPage !== p) {
          adminCurrentPage = p;
          renderGalleryGrid();
          galleryDropzone?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      adminPageNumbersGroup.appendChild(btn);
    }
  }

  // Drag and Drop Reordering Handlers
  function handleDragStart(e, cardEl, item) {
    dragItem = item;
    dragSrcEl = cardEl;
    cardEl.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    return false;
  }

  function handleDragEnter(e, cardEl) {
    if (cardEl !== dragSrcEl) {
      cardEl.classList.add("drag-target");
    }
  }

  function handleDragLeave(e, cardEl) {
    cardEl.classList.remove("drag-target");
  }

  async function handleDrop(e, cardEl, targetItem) {
    e.stopPropagation();
    cardEl.classList.remove("drag-target");

    if (dragItem && targetItem && dragItem.id !== targetItem.id) {
      const fromIdx = allGalleryPhotos.findIndex((p) => p.id === dragItem.id);
      const toIdx = allGalleryPhotos.findIndex((p) => p.id === targetItem.id);

      if (fromIdx !== -1 && toIdx !== -1) {
        // Reorder array
        const [moved] = allGalleryPhotos.splice(fromIdx, 1);
        allGalleryPhotos.splice(toIdx, 0, moved);

        // Update display_order numbers
        allGalleryPhotos.forEach((p, idx) => {
          p.display_order = idx + 1;
        });

        renderGalleryGrid();
        await persistGalleryOrders();
      }
    }
    return false;
  }

  function handleDragEnd() {
    if (dragSrcEl) dragSrcEl.classList.remove("dragging");
    document.querySelectorAll(".gallery-admin-card").forEach((c) => c.classList.remove("drag-target"));
    dragItem = null;
    dragSrcEl = null;
  }

  // Persist new order into Supabase
  async function persistGalleryOrders() {
    if (!currentSession) return;
    try {
      showToast("💾 Saving live gallery order...");
      const updates = allGalleryPhotos.map((p) =>
        fetch(`${cfg.SUPABASE_URL}/rest/v1/gallery_images?id=eq.${p.id}`, {
          method: "PATCH",
          headers: {
            apikey: cfg.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${currentSession.access_token}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal"
          },
          body: JSON.stringify({ display_order: p.display_order })
        })
      );
      await Promise.all(updates);
      showToast("✓ Live gallery order saved!");
    } catch (err) {
      console.error("Order save error:", err);
      showToast("⚠️ Failed to save order: " + err.message);
    }
  }

  // Upload Logic (Drag-and-Drop Dropzone + File Input)
  galleryDropzone?.addEventListener("click", () => galleryFileInput?.click());

  galleryDropzone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    galleryDropzone.classList.add("dragover");
  });
  galleryDropzone?.addEventListener("dragleave", () => {
    galleryDropzone.classList.remove("dragover");
  });
  galleryDropzone?.addEventListener("drop", (e) => {
    e.preventDefault();
    galleryDropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesUpload(Array.from(e.dataTransfer.files));
    }
  });

  galleryFileInput?.addEventListener("change", () => {
    if (galleryFileInput.files && galleryFileInput.files.length > 0) {
      handleFilesUpload(Array.from(galleryFileInput.files));
      galleryFileInput.value = "";
    }
  });

  async function handleFilesUpload(files) {
    const imgFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imgFiles.length === 0) {
      alert("Please select valid image files (JPG, PNG, WebP).");
      return;
    }

    if (uploadStatusWrap) uploadStatusWrap.style.display = "block";
    if (uploadProgressFill) uploadProgressFill.style.width = "0%";
    let successCount = 0;

    for (let i = 0; i < imgFiles.length; i++) {
      const file = imgFiles[i];
      const pct = Math.round((i / imgFiles.length) * 100);
      if (uploadStatusLabel) uploadStatusLabel.textContent = `Optimizing & uploading ${i + 1} of ${imgFiles.length}: ${file.name}...`;
      if (uploadStatusPercent) uploadStatusPercent.textContent = pct + "%";
      if (uploadProgressFill) uploadProgressFill.style.width = pct + "%";

      try {
        // 1. Client-Side WebP compression
        let uploadFile = file;
        if (window.compressImage) {
          uploadFile = await window.compressImage(file, { maxWidth: 1080, quality: 0.78 });
        }

        // 2. Upload to Cloudflare R2 or Supabase Storage fallback
        let fileUrl = null;
        try {
          const formData = new FormData();
          formData.append("file", uploadFile);
          formData.append("folder", "gallery");
          const res = await fetch(cfg.UPLOAD_ENDPOINT || "/api/upload", {
            method: "POST",
            body: formData
          });
          if (res.ok) {
            const data = await res.json();
            fileUrl = data.url;
          }
        } catch (e) {
          console.warn("R2 upload endpoint failed, trying Supabase Storage fallback:", e);
        }

        // Fallback: Supabase Storage bucket 'gallery'
        if (!fileUrl && currentSession) {
          const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
          const sbRes = await fetch(`${cfg.SUPABASE_URL}/storage/v1/object/gallery/${safeName}`, {
            method: "POST",
            headers: {
              apikey: cfg.SUPABASE_ANON_KEY,
              Authorization: `Bearer ${currentSession.access_token}`,
              "Content-Type": uploadFile.type || "image/jpeg"
            },
            body: uploadFile
          });
          if (sbRes.ok) {
            fileUrl = `${cfg.SUPABASE_URL}/storage/v1/object/public/gallery/${safeName}`;
          }
        }

        if (!fileUrl) {
          throw new Error("Could not upload file to storage.");
        }

        // 3. Insert row into Supabase gallery_images
        const maxOrder = allGalleryPhotos.reduce((max, p) => Math.max(max, p.display_order || 0), 0);
        const cleanTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ").trim();

        const insertRes = await fetch(`${cfg.SUPABASE_URL}/rest/v1/gallery_images`, {
          method: "POST",
          headers: {
            apikey: cfg.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${currentSession.access_token}`,
            "Content-Type": "application/json",
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            title: cleanTitle || "Marathon Highlight",
            caption: "",
            image_url: fileUrl,
            display_order: maxOrder + 1,
            is_published: true
          })
        });

        if (insertRes.ok) {
          const [inserted] = await insertRes.json();
          allGalleryPhotos.push(inserted);
          successCount++;
        }
      } catch (err) {
        console.error("Failed uploading photo:", file.name, err);
      }
    }

    if (uploadProgressFill) uploadProgressFill.style.width = "100%";
    if (uploadStatusLabel) uploadStatusLabel.textContent = `Completed! ${successCount} of ${imgFiles.length} photos added.`;
    if (uploadStatusPercent) uploadStatusPercent.textContent = "100%";

    setTimeout(() => {
      if (uploadStatusWrap) uploadStatusWrap.style.display = "none";
    }, 2500);

    updateGalleryStats();
    renderGalleryGrid();
    showToast(`✓ Added ${successCount} new photo(s) to gallery!`);
  }

  // Toggle Visibility
  async function togglePhotoVisibility(photo) {
    if (!currentSession) return;
    const newStatus = !photo.is_published;
    photo.is_published = newStatus;
    renderGalleryGrid();

    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/gallery_images?id=eq.${photo.id}`, {
        method: "PATCH",
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${currentSession.access_token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ is_published: newStatus })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      updateGalleryStats();
      showToast(newStatus ? `✓ "${photo.title}" is now live!` : `○ "${photo.title}" hidden from live gallery.`);
    } catch (err) {
      photo.is_published = !newStatus;
      renderGalleryGrid();
      alert("Failed to toggle visibility: " + err.message);
    }
  }

  // Delete Photo
  async function deletePhoto(photo) {
    if (!currentSession) return;
    const confirmDel = confirm(`Are you sure you want to delete "${photo.title || 'this photo'}" from the gallery? This cannot be undone.`);
    if (!confirmDel) return;

    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/gallery_images?id=eq.${photo.id}`, {
        method: "DELETE",
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${currentSession.access_token}`
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      allGalleryPhotos = allGalleryPhotos.filter((p) => p.id !== photo.id);
      updateGalleryStats();
      renderGalleryGrid();
      showToast("🗑️ Photo deleted successfully.");
    } catch (err) {
      alert("Failed to delete photo: " + err.message);
    }
  }

  // Edit Modal Handlers
  function openEditPhotoModal(photo) {
    activeEditingPhoto = photo;
    if (editModalImg) editModalImg.src = photo.image_url;
    if (editPhotoTitle) editPhotoTitle.value = photo.title || "";
    if (editPhotoCaption) editPhotoCaption.value = photo.caption || "";
    if (editPhotoPublished) editPhotoPublished.checked = !!photo.is_published;
    if (editGalleryModal) editGalleryModal.style.display = "grid";
  }

  function closeEditModal() {
    activeEditingPhoto = null;
    if (editGalleryModal) editGalleryModal.style.display = "none";
  }

  window.closeEditModal = closeEditModal;
  closeEditModalBtn?.addEventListener("click", closeEditModal);
  cancelEditPhotoBtn?.addEventListener("click", closeEditModal);

  saveEditPhotoBtn?.addEventListener("click", async () => {
    if (!activeEditingPhoto || !currentSession) return;
    const newTitle = editPhotoTitle.value.trim();
    const newCaption = editPhotoCaption.value.trim();
    const newPublished = editPhotoPublished.checked;

    saveEditPhotoBtn.disabled = true;
    saveEditPhotoBtn.textContent = "Saving...";

    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/gallery_images?id=eq.${activeEditingPhoto.id}`, {
        method: "PATCH",
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${currentSession.access_token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          title: newTitle || "Marathon Highlight",
          caption: newCaption,
          is_published: newPublished
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const [updated] = await res.json();

      const idx = allGalleryPhotos.findIndex((p) => p.id === activeEditingPhoto.id);
      if (idx !== -1) allGalleryPhotos[idx] = updated;

      closeEditModal();
      updateGalleryStats();
      renderGalleryGrid();
      showToast("✓ Photo details updated successfully!");
    } catch (err) {
      alert("Failed to save changes: " + err.message);
    } finally {
      saveEditPhotoBtn.disabled = false;
      saveEditPhotoBtn.textContent = "Save Changes";
    }
  });

  // Filter & Search input listeners
  gallerySearch?.addEventListener("input", () => {
    adminCurrentPage = 1;
    renderGalleryGrid();
  });
  galleryFilterStatus?.addEventListener("change", () => {
    adminCurrentPage = 1;
    renderGalleryGrid();
  });

  // Admin Pagination Navigation Buttons
  adminPrevPageBtn?.addEventListener("click", () => {
    if (adminCurrentPage > 1) {
      adminCurrentPage--;
      renderGalleryGrid();
      galleryDropzone?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  adminNextPageBtn?.addEventListener("click", () => {
    const q = (gallerySearch?.value || "").toLowerCase().trim();
    const filter = galleryFilterStatus?.value || "all";
    const filteredCount = allGalleryPhotos.filter((item) => {
      const matchQ = (item.title || "").toLowerCase().includes(q) || (item.caption || "").toLowerCase().includes(q);
      const matchFilter = filter === "all" ? true : (filter === "published" ? item.is_published : !item.is_published);
      return matchQ && matchFilter;
    }).length;
    const totalPages = Math.max(1, Math.ceil(filteredCount / ADMIN_PER_PAGE));
    if (adminCurrentPage < totalPages) {
      adminCurrentPage++;
      renderGalleryGrid();
      galleryDropzone?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  // ==========================================
  // EVENT SETTINGS MANAGER (EARLY BIRD DEADLINE)
  // ==========================================
  let currentEventInfo = null;

  const settingEarlyBirdInput = document.getElementById("settingEarlyBirdInput");
  const settingEarlyBirdBadge = document.getElementById("settingEarlyBirdBadge");
  const settingTimeRemaining = document.getElementById("settingTimeRemaining");
  const saveEarlyBirdBtn = document.getElementById("saveEarlyBirdBtn");

  function formatDateTimeLocal(d) {
    if (!d || isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  function updateSettingsUi(dateObj) {
    if (!settingEarlyBirdBadge || !settingTimeRemaining) return;
    if (!dateObj || isNaN(dateObj.getTime())) {
      settingEarlyBirdBadge.className = "badge-status";
      settingEarlyBirdBadge.textContent = "⚪ Not Set";
      settingTimeRemaining.textContent = "No valid early bird deadline configured.";
      settingTimeRemaining.style.color = "var(--muted)";
      return;
    }

    const now = Date.now();
    const diffMs = dateObj.getTime() - now;

    if (diffMs > 0) {
      settingEarlyBirdBadge.className = "badge-status status-verified";
      settingEarlyBirdBadge.textContent = "🟢 Live Active";
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
      const diffMinutes = Math.floor((diffMs / (1000 * 60)) % 60);
      const formattedDate = dateObj.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
      settingTimeRemaining.innerHTML = `<strong>Early Bird Active:</strong> ${diffDays}d ${diffHours}h ${diffMinutes}m remaining (Ends: ${formattedDate} IST)`;
      settingTimeRemaining.style.color = "#047857";
    } else {
      settingEarlyBirdBadge.className = "badge-status status-rejected";
      settingEarlyBirdBadge.textContent = "🔴 Expired (Standard Prices Active)";
      const formattedDate = dateObj.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
      settingTimeRemaining.innerHTML = `<strong>Status:</strong> Expired on ${formattedDate} IST. Standard rates are now active across public registration.`;
      settingTimeRemaining.style.color = "#b91c1c";
    }
  }

  async function loadEventSettingsAdmin() {
    if (!currentSession) return;
    try {
      const token = await getValidToken();
      if (!token) return;

      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/event_settings?key=eq.event_info&select=key,value`, {
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && data[0].value) {
        currentEventInfo = data[0].value;
        if (currentEventInfo.early_bird_deadline) {
          const d = new Date(currentEventInfo.early_bird_deadline);
          if (!isNaN(d.getTime())) {
            if (settingEarlyBirdInput) {
              settingEarlyBirdInput.value = formatDateTimeLocal(d);
            }
            updateSettingsUi(d);
          }
        }
      }
    } catch (err) {
      console.warn("Failed to load event settings:", err);
      if (settingTimeRemaining) {
        settingTimeRemaining.textContent = "Could not load settings from server. Check your connection.";
        settingTimeRemaining.style.color = "#b91c1c";
      }
    }
  }

  settingEarlyBirdInput?.addEventListener("input", () => {
    const val = settingEarlyBirdInput.value;
    if (val) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        updateSettingsUi(d);
      }
    }
  });

  saveEarlyBirdBtn?.addEventListener("click", async () => {
    const val = settingEarlyBirdInput?.value;
    if (!val) {
      alert("Please select a date and time for the Early Bird deadline.");
      return;
    }

    const selectedDate = new Date(val);
    if (isNaN(selectedDate.getTime())) {
      alert("Invalid date format. Please pick a valid date and time.");
      return;
    }

    if (saveEarlyBirdBtn) {
      saveEarlyBirdBtn.disabled = true;
      saveEarlyBirdBtn.textContent = "Saving...";
    }

    try {
      const token = await getValidToken();
      if (!token) {
        alert("Session expired. Please sign in again.");
        signOut();
        return;
      }

      const updatedValue = {
        ...(currentEventInfo || {}),
        early_bird_deadline: selectedDate.toISOString()
      };

      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/event_settings?key=eq.event_info`, {
        method: "PATCH",
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          value: updatedValue
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `HTTP ${res.status}`);
      }

      currentEventInfo = updatedValue;
      updateSettingsUi(selectedDate);
      showToast("✓ Early Bird deadline updated successfully!");
    } catch (err) {
      console.error("Failed to update early bird deadline:", err);
      alert("Failed to save Early Bird deadline: " + err.message);
    } finally {
      if (saveEarlyBirdBtn) {
        saveEarlyBirdBtn.disabled = false;
        saveEarlyBirdBtn.textContent = "💾 Save Deadline";
      }
    }
  });

  // ==========================================
  // HERO BANNER SLIDER MANAGER (DESKTOP & MOBILE)
  // ==========================================
  const defaultInitialHeroSlides = [];

  let currentHeroSlides = [];

  const heroSlidesListEl = document.getElementById("heroSlidesList");
  const slideCountBadgeEl = document.getElementById("slideCountBadge");
  const newSlideDesktopFile = document.getElementById("newSlideDesktopFile");
  const newSlideDesktopUrl = document.getElementById("newSlideDesktopUrl");
  const newSlideMobileFile = document.getElementById("newSlideMobileFile");
  const newSlideMobileUrl = document.getElementById("newSlideMobileUrl");
  const newSlideAlt = document.getElementById("newSlideAlt");
  const newSlideContain = document.getElementById("newSlideContain");
  const addNewSlideBtn = document.getElementById("addNewSlideBtn");
  const saveHeroSlidesBtn = document.getElementById("saveHeroSlidesBtn");
  const resetDefaultSlidesBtn = document.getElementById("resetDefaultSlidesBtn");
  const slideUploadStatus = document.getElementById("slideUploadStatus");

  async function uploadSlideFile(file, deviceType) {
    if (!file) return null;
    let uploadFile = file;
    // Optimize with compressor if available (desktop up to 1920, mobile up to 800)
    if (window.compressImage) {
      const maxW = deviceType === "mobile" ? 800 : 1920;
      uploadFile = await window.compressImage(file, { maxWidth: maxW, quality: 0.85 });
    }

    let fileUrl = null;
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("folder", "hero-slides");
      const res = await fetch(cfg.UPLOAD_ENDPOINT || "/api/upload", {
        method: "POST",
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        fileUrl = data.url;
      }
    } catch (e) {
      console.warn("R2 upload endpoint failed, trying Supabase Storage fallback:", e);
    }

    if (!fileUrl && currentSession) {
      const safeName = `hero-${deviceType}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const sbRes = await fetch(`${cfg.SUPABASE_URL}/storage/v1/object/gallery/${safeName}`, {
        method: "POST",
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${currentSession.access_token}`,
          "Content-Type": uploadFile.type || "image/jpeg"
        },
        body: uploadFile
      });
      if (sbRes.ok) {
        fileUrl = `${cfg.SUPABASE_URL}/storage/v1/object/public/gallery/${safeName}`;
      }
    }

    return fileUrl;
  }

  let heroSlidesUnsaved = false;
  function markHeroSlidesUnsaved(unsaved = true) {
    heroSlidesUnsaved = unsaved;
    if (!saveHeroSlidesBtn) return;
    if (unsaved) {
      saveHeroSlidesBtn.textContent = "💾 Save All Slides * (Unsaved Changes)";
      saveHeroSlidesBtn.style.background = "#e41f2b";
      saveHeroSlidesBtn.style.color = "#fff";
      saveHeroSlidesBtn.style.boxShadow = "0 0 0 3px rgba(228, 31, 43, 0.35)";
    } else {
      saveHeroSlidesBtn.textContent = "💾 Save All Slides";
      saveHeroSlidesBtn.style.background = "";
      saveHeroSlidesBtn.style.color = "";
      saveHeroSlidesBtn.style.boxShadow = "";
    }
  }

  function renderHeroSlidesAdmin() {
    if (!heroSlidesListEl) return;
    if (slideCountBadgeEl) slideCountBadgeEl.textContent = currentHeroSlides.length;

    if (currentHeroSlides.length === 0) {
      heroSlidesListEl.innerHTML = '<div style="padding:28px 16px;text-align:center;color:var(--muted);font-size:13.5px;background:#f8fafc;border:2px dashed #cbd5e1;border-radius:12px">' +
        'No slider images added yet.<br><span style="font-size:12px;color:#64748b;margin-top:4px;display:inline-block">Use the <strong>"Add New Slide to Carousel"</strong> form above to upload desktop & mobile banners.</span>' +
        '</div>';
      return;
    }

    heroSlidesListEl.innerHTML = currentHeroSlides.map((slide, idx) => {
      const desktopImg = normalizeMediaUrl(slide.desktop_url || slide.mobile_url);
      const mobileImg = normalizeMediaUrl(slide.mobile_url || slide.desktop_url || desktopImg);
      const isCustomMobile = slide.mobile_url && slide.mobile_url !== slide.desktop_url;
      const safeAlt = (slide.alt || 'Marathon Slide').replace(/"/g, '&quot;');
      const safeDesktop = (slide.desktop_url || "").replace(/"/g, '&quot;');
      const safeMobile = (slide.mobile_url || "").replace(/"/g, '&quot;');

      return `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;display:flex;gap:16px;align-items:center;flex-wrap:wrap" data-index="${idx}">
          <div style="font-weight:900;color:var(--muted);font-size:16px;min-width:24px;text-align:center">#${idx + 1}</div>
          
          <div style="display:flex;gap:10px;align-items:flex-start">
            <div style="text-align:center">
              <img src="${desktopImg}" style="width:130px;height:44px;object-fit:cover;border-radius:6px;border:1px solid #cbd5e1;display:block" alt="Desktop preview" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'130\\' height=\\'44\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23fee2e2\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-size=\\'10\\' fill=\\'%23dc2626\\'>Load error</text></svg>'">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:4px">
                <span style="font-size:10px;font-weight:800;color:#1e40af">🖥️ Desktop</span>
                <button type="button" style="font-size:10.5px;font-weight:800;color:#1e40af;background:#eff6ff;border:1px solid #bfdbfe;border-radius:5px;padding:2px 7px;cursor:pointer" onclick="window.replaceSlideImage(${idx}, 'desktop')">📷 Replace</button>
              </div>
            </div>
            <div style="text-align:center">
              <img src="${mobileImg}" style="width:50px;height:44px;object-fit:cover;border-radius:6px;border:1px solid #cbd5e1;display:block" alt="Mobile preview" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'50\\' height=\\'44\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%23fee2e2\\'/><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-size=\\'9\\' fill=\\'%23dc2626\\'>!</text></svg>'">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:4px">
                <span style="font-size:10px;font-weight:800;color:${isCustomMobile ? '#047857' : '#94a3b8'}">📱 ${isCustomMobile ? 'Custom' : 'Auto'}</span>
                <button type="button" style="font-size:10.5px;font-weight:800;color:#047857;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:5px;padding:2px 6px;cursor:pointer" title="Replace mobile image" onclick="window.replaceSlideImage(${idx}, 'mobile')">📷</button>
              </div>
            </div>
          </div>

          <div style="flex:1;min-width:220px">
            <div style="margin-bottom:6px">
              <input type="text" value="${safeAlt}" placeholder="Slide Title / Alt" 
                style="width:100%;box-sizing:border-box;padding:6px 10px;font-size:13px;font-weight:700;border:1px solid #cbd5e1;border-radius:6px;color:var(--ink)"
                onchange="window.updateSlideAlt(${idx}, this.value)">
            </div>
            <div style="margin-bottom:4px;display:flex;gap:6px">
              <input type="text" value="${safeDesktop}" placeholder="Desktop Banner URL (1920×640)" 
                style="flex:1;box-sizing:border-box;padding:5px 8px;font-size:11px;border:1px solid #e2e8f0;border-radius:6px;color:var(--muted)"
                onchange="window.updateSlideUrl(${idx}, 'desktop', this.value)">
              <input type="text" value="${safeMobile}" placeholder="Mobile URL (Optional)" 
                style="flex:1;box-sizing:border-box;padding:5px 8px;font-size:11px;border:1px solid #e2e8f0;border-radius:6px;color:${isCustomMobile ? '#047857' : 'var(--muted)'}"
                title="${isCustomMobile ? 'Custom Mobile URL' : 'Auto (matches desktop)'}"
                onchange="window.updateSlideUrl(${idx}, 'mobile', this.value)">
            </div>
            <label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--muted);cursor:pointer">
              <input type="checkbox" ${slide.contain ? 'checked' : ''} onchange="window.toggleSlideContain(${idx}, this.checked)"> Fit full image (no crop)
            </label>
          </div>

          <div style="display:flex;gap:6px;align-items:center">
            <button type="button" class="btn-sm" style="background:#f1f5f9;color:var(--ink)" ${idx === 0 ? 'disabled' : ''} onclick="window.moveSlide(${idx}, -1)">▲</button>
            <button type="button" class="btn-sm" style="background:#f1f5f9;color:var(--ink)" ${idx === currentHeroSlides.length - 1 ? 'disabled' : ''} onclick="window.moveSlide(${idx}, 1)">▼</button>
            <button type="button" class="btn-sm" style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca" onclick="window.deleteSlide(${idx})">🗑️</button>
          </div>
        </div>
      `;
    }).join("");
  }

  async function persistHeroSlides(slidesToSave) {
    const token = await getValidToken();
    if (!token) {
      throw new Error("Session expired. Please sign in again.");
    }

    const cleanedSlides = (slidesToSave || currentHeroSlides).map(s => {
      const d = normalizeMediaUrl(s.desktop_url || s.mobile_url);
      const m = normalizeMediaUrl(s.mobile_url || s.desktop_url || d);
      return {
        ...s,
        desktop_url: d,
        mobile_url: m
      };
    });

    const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/event_settings`, {
      method: "POST",
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        key: "hero_slides",
        value: cleanedSlides,
        updated_at: new Date().toISOString()
      })
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `HTTP ${res.status}`);
    }

    currentHeroSlides = cleanedSlides;
    renderHeroSlidesAdmin();
    markHeroSlidesUnsaved(false);
    try {
      localStorage.removeItem('am27_hero_slides');
      localStorage.setItem('am27_hero_slides_v2', JSON.stringify(cleanedSlides));
    } catch(e){}
    return cleanedSlides;
  }

  window.replaceSlideImage = function(idx, deviceType) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      showToast(`Uploading new ${deviceType} banner... Please wait.`);
      try {
        const uploadedUrl = await uploadSlideFile(file, deviceType);
        if (!uploadedUrl) throw new Error("Upload failed. Could not process image.");
        const cleanUrl = normalizeMediaUrl(uploadedUrl);
        const oldDesktop = currentHeroSlides[idx].desktop_url;
        const hadSameMobile = !currentHeroSlides[idx].mobile_url || currentHeroSlides[idx].mobile_url === oldDesktop;

        if (deviceType === "desktop") {
          currentHeroSlides[idx].desktop_url = cleanUrl;
          // Crucial: keep mobile in sync so mobile devices immediately show the new banner!
          if (hadSameMobile) {
            currentHeroSlides[idx].mobile_url = cleanUrl;
          }
        } else {
          currentHeroSlides[idx].mobile_url = cleanUrl;
        }
        renderHeroSlidesAdmin();
        showToast("Saving updated banner live...");
        await persistHeroSlides(currentHeroSlides);
        showToast(`✓ Slide #${idx + 1} (${deviceType}) updated and published live!`);
      } catch (err) {
        alert("Failed to replace image: " + err.message);
      }
    };
    input.click();
  };

  window.updateSlideAlt = function(idx, val) {
    if (currentHeroSlides[idx]) {
      currentHeroSlides[idx].alt = val.trim();
      markHeroSlidesUnsaved(true);
    }
  };

  window.updateSlideUrl = function(idx, device, val) {
    if (currentHeroSlides[idx]) {
      const trimmed = normalizeMediaUrl(val.trim());
      const oldDesktop = currentHeroSlides[idx].desktop_url;
      const hadSameMobile = !currentHeroSlides[idx].mobile_url || currentHeroSlides[idx].mobile_url === oldDesktop;

      if (device === 'desktop') {
        currentHeroSlides[idx].desktop_url = trimmed;
        if (hadSameMobile) {
          currentHeroSlides[idx].mobile_url = trimmed;
        }
      } else {
        currentHeroSlides[idx].mobile_url = trimmed;
      }
      renderHeroSlidesAdmin();
      persistHeroSlides(currentHeroSlides).catch(e => markHeroSlidesUnsaved(true));
    }
  };

  window.toggleSlideContain = function(idx, checked) {
    if (currentHeroSlides[idx]) {
      currentHeroSlides[idx].contain = checked;
      markHeroSlidesUnsaved(true);
    }
  };

  window.moveSlide = async function(idx, dir) {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= currentHeroSlides.length) return;
    const temp = currentHeroSlides[idx];
    currentHeroSlides[idx] = currentHeroSlides[targetIdx];
    currentHeroSlides[targetIdx] = temp;
    renderHeroSlidesAdmin();
    try {
      await persistHeroSlides(currentHeroSlides);
      showToast("✓ Slide order updated live!");
    } catch (e) {
      markHeroSlidesUnsaved(true);
    }
  };

  window.deleteSlide = async function(idx) {
    if (idx < 0 || idx >= currentHeroSlides.length) return;
    const slide = currentHeroSlides[idx];
    const slideTitle = slide ? (slide.alt || `Slide #${idx + 1}`) : `Slide #${idx + 1}`;

    if (!confirm(`Permanently remove "${slideTitle}" from the hero slider?`)) {
      return;
    }

    const previousSlides = [...currentHeroSlides];
    currentHeroSlides.splice(idx, 1);
    renderHeroSlidesAdmin();
    showToast("Deleting slide and saving live...");

    try {
      await persistHeroSlides(currentHeroSlides);
      showToast("✓ Slide deleted permanently!");
    } catch (err) {
      console.error("Failed to persist slide deletion:", err);
      currentHeroSlides = previousSlides;
      renderHeroSlidesAdmin();
      alert("Failed to delete slide from server: " + err.message);
    }
  };

  async function loadHeroSlidesAdmin() {
    if (!currentSession) return;
    try {
      const token = await getValidToken();
      if (!token) return;

      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/event_settings?key=eq.hero_slides&select=key,value&_t=${Date.now()}`, {
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`
        }
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0].value)) {
          currentHeroSlides = data[0].value.map(s => {
            const d = normalizeMediaUrl(s.desktop_url || s.mobile_url);
            const m = normalizeMediaUrl(s.mobile_url || s.desktop_url || d);
            return {
              ...s,
              desktop_url: d,
              mobile_url: m
            };
          });
        } else {
          currentHeroSlides = [];
        }
      } else {
        currentHeroSlides = [];
      }
      renderHeroSlidesAdmin();
      markHeroSlidesUnsaved(false);
    } catch (err) {
      console.warn("Failed to load hero slides:", err);
      currentHeroSlides = [];
      renderHeroSlidesAdmin();
      markHeroSlidesUnsaved(false);
    }
  }

  function clearSlideInputs() {
    if (newSlideDesktopFile) newSlideDesktopFile.value = "";
    if (newSlideMobileFile) newSlideMobileFile.value = "";
    if (newSlideDesktopUrl) newSlideDesktopUrl.value = "";
    if (newSlideMobileUrl) newSlideMobileUrl.value = "";
    if (newSlideAlt) newSlideAlt.value = "";
    if (newSlideContain) newSlideContain.checked = false;
    const dp = document.getElementById("newSlideDesktopPreview");
    if (dp) { dp.style.display = "none"; dp.textContent = ""; }
    const mp = document.getElementById("newSlideMobilePreview");
    if (mp) { mp.style.display = "none"; mp.textContent = ""; }
  }

  newSlideDesktopFile?.addEventListener("change", () => {
    const f = newSlideDesktopFile.files?.[0];
    const dp = document.getElementById("newSlideDesktopPreview");
    if (f) {
      if (newSlideDesktopUrl) newSlideDesktopUrl.value = "";
      if (dp) {
        dp.style.display = "block";
        dp.textContent = `✓ Selected: ${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
      }
    } else {
      if (dp) { dp.style.display = "none"; dp.textContent = ""; }
    }
  });

  newSlideMobileFile?.addEventListener("change", () => {
    const f = newSlideMobileFile.files?.[0];
    const mp = document.getElementById("newSlideMobilePreview");
    if (f) {
      if (newSlideMobileUrl) newSlideMobileUrl.value = "";
      if (mp) {
        mp.style.display = "block";
        mp.textContent = `✓ Selected: ${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
      }
    } else {
      if (mp) { mp.style.display = "none"; mp.textContent = ""; }
    }
  });

  newSlideDesktopUrl?.addEventListener("input", () => {
    if (newSlideDesktopUrl.value.trim()) {
      if (newSlideDesktopFile) newSlideDesktopFile.value = "";
      const dp = document.getElementById("newSlideDesktopPreview");
      if (dp) { dp.style.display = "none"; dp.textContent = ""; }
    }
  });

  newSlideMobileUrl?.addEventListener("input", () => {
    if (newSlideMobileUrl.value.trim()) {
      if (newSlideMobileFile) newSlideMobileFile.value = "";
      const mp = document.getElementById("newSlideMobilePreview");
      if (mp) { mp.style.display = "none"; mp.textContent = ""; }
    }
  });

  addNewSlideBtn?.addEventListener("click", async () => {
    const dFile = newSlideDesktopFile?.files?.[0];
    let dUrl = newSlideDesktopUrl?.value?.trim() || "";
    const mFile = newSlideMobileFile?.files?.[0];
    let mUrl = newSlideMobileUrl?.value?.trim() || "";
    const alt = newSlideAlt?.value?.trim() || "Angamaly Marathon Highlight";
    const contain = newSlideContain?.checked || false;

    if (!dFile && !dUrl && !mFile && !mUrl) {
      alert("Please choose an image file (desktop or mobile) or enter an image URL.");
      return;
    }

    addNewSlideBtn.disabled = true;
    if (slideUploadStatus) {
      slideUploadStatus.style.display = "block";
      slideUploadStatus.textContent = "Uploading images... Please wait.";
    }

    try {
      if (dFile) {
        const uploadedD = await uploadSlideFile(dFile, "desktop");
        if (uploadedD) dUrl = normalizeMediaUrl(uploadedD);
      }
      if (mFile) {
        const uploadedM = await uploadSlideFile(mFile, "mobile");
        if (uploadedM) mUrl = normalizeMediaUrl(uploadedM);
      }

      dUrl = normalizeMediaUrl(dUrl);
      mUrl = normalizeMediaUrl(mUrl);

      // If only desktop or mobile was provided, use it for both so mobile is never blank
      if (!dUrl && mUrl) dUrl = mUrl;
      if (!mUrl && dUrl) mUrl = dUrl;

      if (!dUrl) {
        throw new Error("Could not process image upload.");
      }

      // Check for duplicate slide
      const isDuplicate = currentHeroSlides.some(s => normalizeMediaUrl(s.desktop_url) === dUrl);
      if (isDuplicate) {
        const proceed = confirm("This exact image is already added to your slider. Do you want to add it again as a duplicate slide?");
        if (!proceed) {
          clearSlideInputs();
          return;
        }
      }

      currentHeroSlides.push({
        id: "slide_" + Date.now(),
        desktop_url: dUrl,
        mobile_url: mUrl,
        alt: alt,
        contain: contain
      });

      clearSlideInputs();
      renderHeroSlidesAdmin();
      showToast("Saving new slide live...");
      await persistHeroSlides(currentHeroSlides);
      showToast("✓ Slide added and published live!");
    } catch (err) {
      alert("Failed to add slide: " + err.message);
    } finally {
      addNewSlideBtn.disabled = false;
      if (slideUploadStatus) slideUploadStatus.style.display = "none";
    }
  });

  saveHeroSlidesBtn?.addEventListener("click", async () => {
    saveHeroSlidesBtn.disabled = true;
    saveHeroSlidesBtn.textContent = "Saving...";

    try {
      await persistHeroSlides(currentHeroSlides);
      showToast("✓ Hero Slider successfully updated live on home page!");
    } catch (err) {
      alert("Failed to save hero slides: " + err.message);
    } finally {
      saveHeroSlidesBtn.disabled = false;
      if (heroSlidesUnsaved) {
        markHeroSlidesUnsaved(true);
      } else {
        saveHeroSlidesBtn.textContent = "💾 Save All Slides";
      }
    }
  });

  resetDefaultSlidesBtn?.addEventListener("click", async () => {
    if (confirm("Are you sure you want to delete ALL slides from the hero slider? This will clear all images live on the website.")) {
      showToast("Clearing all slides...");
      try {
        await persistHeroSlides([]);
        showToast("✓ All slides removed and cleared live!");
      } catch (e) {
        currentHeroSlides = [];
        renderHeroSlidesAdmin();
        markHeroSlidesUnsaved(true);
        alert("Could not clear slides on server: " + e.message);
      }
    }
  });

  // Attach loadHeroSlidesAdmin into loadEventSettingsAdmin
  const originalLoadEventSettings = loadEventSettingsAdmin;
  loadEventSettingsAdmin = async function() {
    await originalLoadEventSettings();
    await loadHeroSlidesAdmin();
  };

  // ==========================================
  // T-SHIRT PRINTING TRACKER LOGIC (OPTION 1 BATCH DISPATCH)
  // ==========================================
  const TSHIRT_SIZES = ["XS / 34", "S / 36", "M / 38", "L / 40", "XL / 42", "XXL / 44"];
  let currentTshirtRequired = { "XS / 34": 0, "S / 36": 0, "M / 38": 0, "L / 40": 0, "XL / 42": 0, "XXL / 44": 0 };
  let tshirtPrintingData = {
    moved: { "XS / 34": 0, "S / 36": 0, "M / 38": 0, "L / 40": 0, "XL / 42": 0, "XXL / 44": 0 },
    last_updated: null
  };
  let tshirtDirectEditMode = false;

  const tshirtTotalReqEl = document.getElementById("tshirtTotalReq");
  const tshirtTotalMovedEl = document.getElementById("tshirtTotalMoved");
  const tshirtTotalPendingEl = document.getElementById("tshirtTotalPending");
  const tshirtPrintingTbodyEl = document.getElementById("tshirtPrintingTbody");
  const tshirtLastSavedTextEl = document.getElementById("tshirtLastSavedText");
  const btnCopyTshirtSummary = document.getElementById("btnCopyTshirtSummary");
  const btnSaveTshirtStatus = document.getElementById("btnSaveTshirtStatus");
  const btnToggleDirectEditTshirt = document.getElementById("btnToggleDirectEditTshirt");

  btnToggleDirectEditTshirt?.addEventListener("click", () => {
    tshirtDirectEditMode = !tshirtDirectEditMode;
    btnToggleDirectEditTshirt.textContent = tshirtDirectEditMode ? "✓ Done Editing" : "✏️ Direct Edit";
    btnToggleDirectEditTshirt.style.background = tshirtDirectEditMode ? "#eff6ff" : "#fff";
    btnToggleDirectEditTshirt.style.borderColor = tshirtDirectEditMode ? "#3b82f6" : "#cbd5e1";
    btnToggleDirectEditTshirt.style.color = tshirtDirectEditMode ? "#1d4ed8" : "var(--muted)";
    renderTshirtPrintingTracker();
  });

  function applyTshirtAdd(sz) {
    if (!tshirtPrintingTbodyEl) return;
    const inp = tshirtPrintingTbodyEl.querySelector(`.tshirt-input-add[data-size="${sz}"]`);
    if (!inp) return;
    const val = parseInt(inp.value, 10);
    if (isNaN(val) || val <= 0) return;

    const req = currentTshirtRequired[sz] || 0;
    const curMoved = Math.min(tshirtPrintingData.moved[sz] || 0, req);
    const maxAdd = Math.max(0, req - curMoved);

    if (maxAdd <= 0) {
      showToast(`All required T-shirts for ${sz} are already moved!`);
      inp.value = "";
      return;
    }

    const addAmount = Math.min(val, maxAdd);
    tshirtPrintingData.moved[sz] = curMoved + addAmount;
    inp.value = "";

    renderTshirtPrintingTracker();
    showToast(`✓ +${addAmount} added to ${sz}! Click "💾 Save Printing Status" to save changes.`);
  }

  function updateTshirtTotalsOnly() {
    let sumReq = 0, sumMoved = 0, sumPending = 0;
    const hasDemandLoaded = Object.values(currentTshirtRequired).some(v => v > 0);

    TSHIRT_SIZES.forEach(sz => {
      const req = currentTshirtRequired[sz] || 0;
      let mvd = tshirtPrintingData.moved[sz] || 0;
      if (hasDemandLoaded && req > 0 && mvd > req) {
        mvd = req;
      }
      sumReq += req;
      sumMoved += mvd;
      sumPending += Math.max(0, req - mvd);
    });

    if (tshirtTotalReqEl) tshirtTotalReqEl.textContent = sumReq;
    if (tshirtTotalMovedEl) tshirtTotalMovedEl.textContent = sumMoved;
    if (tshirtTotalPendingEl) {
      tshirtTotalPendingEl.textContent = sumPending;
      tshirtTotalPendingEl.style.color = sumPending > 0 ? "#b91c1c" : "#15803d";
      const sub = document.getElementById("tshirtTotalPendingSubtitle");
      if (sub) sub.textContent = sumPending > 0 ? "Awaiting printing dispatch" : "All verified sent to print";
    }

    const footerReq = document.getElementById("tshirtFooterReq");
    const footerMoved = document.getElementById("tshirtFooterMoved");
    const footerStatus = document.getElementById("tshirtFooterStatus");
    if (footerReq) footerReq.textContent = sumReq;
    if (footerMoved) footerMoved.textContent = sumMoved;
    if (footerStatus) {
      footerStatus.innerHTML = sumPending > 0
        ? `<span style="color:#b91c1c;font-weight:800">+${sumPending} pending to send</span>`
        : '<span style="color:#15803d;font-weight:800">✓ All Sent</span>';
    }

    if (tabTshirtsBadge) {
      if (!hasDemandLoaded) {
        tabTshirtsBadge.textContent = "...";
      } else {
        tabTshirtsBadge.textContent = sumPending > 0 ? `${sumPending} pending` : `${sumMoved}/${sumReq}`;
        tabTshirtsBadge.style.background = sumPending > 0 ? "#fee2e2" : "#dcfce7";
        tabTshirtsBadge.style.color = sumPending > 0 ? "#b91c1c" : "#15803d";
      }
    }
  }

  function renderTshirtPrintingTracker() {
    if (!tshirtPrintingTbodyEl) return;

    updateTshirtTotalsOnly();
    const hasDemandLoaded = Object.values(currentTshirtRequired).some(v => v > 0);

    let sumReq = 0, sumMoved = 0, sumPending = 0;
    TSHIRT_SIZES.forEach(sz => {
      const req = currentTshirtRequired[sz] || 0;
      let mvd = tshirtPrintingData.moved[sz] || 0;
      if (hasDemandLoaded && req > 0 && mvd > req) mvd = req;
      sumReq += req;
      sumMoved += mvd;
      sumPending += Math.max(0, req - mvd);
    });

    // Render Rows for Each Size (5 clean columns)
    tshirtPrintingTbodyEl.innerHTML = TSHIRT_SIZES.map((sz) => {
      const req = currentTshirtRequired[sz] || 0;
      let mvd = tshirtPrintingData.moved[sz] || 0;
      if (hasDemandLoaded && req > 0 && mvd > req) mvd = req;
      const pending = Math.max(0, req - mvd);
      const maxAdd = pending;

      let pendingCell = "";
      if (pending > 0) {
        pendingCell = `<span class="tshirt-status-pill" data-size="${sz}" style="font-weight:800;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;padding:4px 10px;border-radius:6px;font-size:12px;display:inline-block">⚠️ +${pending} to send</span>`;
      } else {
        pendingCell = `<span class="tshirt-status-pill" data-size="${sz}" style="font-weight:800;color:#15803d;background:#f0fdf4;border:1px solid #bbf7d0;padding:4px 10px;border-radius:6px;font-size:12px;display:inline-block">✓ All Sent</span>`;
      }

      const movedCell = tshirtDirectEditMode
        ? `<input type="number" min="0" max="${req}" value="${mvd}" data-size="${sz}" class="tshirt-input-baseline"
            style="width:75px;padding:6px 8px;border:1.5px solid #3b82f6;border-radius:6px;font-weight:800;text-align:center;font-size:14px;background:#eff6ff;color:#1e40af">`
        : `<span style="font-weight:900;font-size:16px;color:#b45309" class="tshirt-val-moved" data-size="${sz}">${mvd}</span>`;

      const addCell = `
        <div style="display:flex;align-items:center;justify-content:center;gap:6px">
          <input type="number" min="1" max="${maxAdd}" placeholder="0" data-size="${sz}" class="tshirt-input-add"
            style="width:65px;padding:6px 8px;border:1.5px solid #cbd5e1;border-radius:8px;font-weight:800;text-align:center;font-size:15px;color:#b45309;background:#fffdf0"
            ${maxAdd <= 0 ? "disabled" : ""}>
          <button type="button" class="btn-tshirt-add-btn" data-size="${sz}" title="Add quantity to moved total"
            style="width:34px;height:34px;border-radius:8px;border:1.5px solid ${maxAdd > 0 ? '#16a34a' : '#cbd5e1'};background:${maxAdd > 0 ? '#16a34a' : '#f1f5f9'};color:${maxAdd > 0 ? '#fff' : '#94a3b8'};font-weight:900;font-size:15px;cursor:${maxAdd > 0 ? 'pointer' : 'not-allowed'};display:inline-flex;align-items:center;justify-content:center;transition:all .15s"
            ${maxAdd <= 0 ? "disabled" : ""}>
            ➕
          </button>
        </div>
      `;

      return `
        <tr style="border-bottom:1px solid #edf2f9">
          <td style="padding:12px 24px;font-weight:900;color:var(--ink);font-size:14px">${sz}</td>
          <td style="padding:12px 14px;text-align:center;font-weight:900;color:var(--blue);font-size:16px">${req}</td>
          <td style="padding:12px 14px;text-align:center">${movedCell}</td>
          <td style="padding:10px 14px;text-align:center;background:#fffdf7;border-left:1px solid #fef3c7;border-right:1px solid #fef3c7">${addCell}</td>
          <td style="padding:12px 14px;text-align:center">${pendingCell}</td>
        </tr>
      `;
    }).join("") + `
      <tr style="background:#f8fafc;border-top:2px solid #cbd5e1;font-weight:900">
        <td style="padding:14px 24px;font-size:14px;color:var(--ink)">TOTAL</td>
        <td style="padding:14px;text-align:center;font-size:17px;color:var(--blue)" id="tshirtFooterReq">${sumReq}</td>
        <td style="padding:14px;text-align:center;font-size:17px;color:#b45309" id="tshirtFooterMoved">${sumMoved}</td>
        <td style="padding:14px;text-align:center;font-size:13px;color:var(--muted);background:#fffdf7;border-left:1px solid #fef3c7;border-right:1px solid #fef3c7">—</td>
        <td style="padding:14px;text-align:center;font-size:13.5px" id="tshirtFooterStatus">
          ${sumPending > 0 ? `<span style="color:#b91c1c;font-weight:800">+${sumPending} pending to send</span>` : '<span style="color:#15803d;font-weight:800">✓ All Sent</span>'}
        </td>
      </tr>
    `;

    // 1. Click listener for ➕ icon button
    tshirtPrintingTbodyEl.querySelectorAll(".btn-tshirt-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyTshirtAdd(btn.dataset.size);
      });
    });

    // 2. Enter key listener for Add input
    tshirtPrintingTbodyEl.querySelectorAll(".tshirt-input-add").forEach((inp) => {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          applyTshirtAdd(inp.dataset.size);
        }
      });
    });

    // 3. Listener for Direct Baseline Edit (when enabled via ✏️ Direct Edit)
    tshirtPrintingTbodyEl.querySelectorAll(".tshirt-input-baseline").forEach((inp) => {
      inp.addEventListener("input", () => {
        const sz = inp.dataset.size;
        const req = currentTshirtRequired[sz] || 0;
        let val = parseInt(inp.value, 10);
        if (isNaN(val) || val < 0) val = 0;
        if (val > req) {
          val = req;
          inp.value = req;
        }
        tshirtPrintingData.moved[sz] = val;

        // Immediately update status pill for this row
        const pill = tshirtPrintingTbodyEl.querySelector(`.tshirt-status-pill[data-size="${sz}"]`);
        if (pill) {
          if (val < req) {
            pill.innerHTML = `⚠️ +${req - val} to send`;
            pill.style.color = "#b91c1c";
            pill.style.background = "#fef2f2";
            pill.style.borderColor = "#fecaca";
          } else {
            pill.innerHTML = `✓ All Sent`;
            pill.style.color = "#15803d";
            pill.style.background = "#f0fdf4";
            pill.style.borderColor = "#bbf7d0";
          }
        }

        updateTshirtTotalsOnly();
      });
    });

    if (tshirtLastSavedTextEl && tshirtPrintingData.last_updated) {
      const d = new Date(tshirtPrintingData.last_updated);
      tshirtLastSavedTextEl.textContent = `Last saved: ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}, ${d.toLocaleDateString("en-IN")}`;
    }
  }

  async function loadTshirtPrintingStatus() {
    try {
      const token = await getValidToken();
      const headers = { apikey: cfg.SUPABASE_ANON_KEY };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/event_settings?key=eq.tshirt_printing_status&select=key,value,updated_at`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0 && data[0].value) {
          const val = data[0].value;
          if (val.moved && typeof val.moved === "object") {
            TSHIRT_SIZES.forEach(sz => {
              if (val.moved[sz] !== undefined && val.moved[sz] !== null) {
                tshirtPrintingData.moved[sz] = parseInt(val.moved[sz], 10) || 0;
              }
            });
          }
          if (val.last_updated) {
            tshirtPrintingData.last_updated = val.last_updated;
          } else if (data[0].updated_at) {
            tshirtPrintingData.last_updated = data[0].updated_at;
          }
        }
      }
    } catch (e) {
      console.warn("Could not load T-shirt printing status from database:", e);
    }
    renderTshirtPrintingTracker();
  }

  // Save Printing Status explicitly to Supabase DB
  btnSaveTshirtStatus?.addEventListener("click", async () => {
    btnSaveTshirtStatus.disabled = true;
    btnSaveTshirtStatus.textContent = "Saving to Database...";

    try {
      const token = await getValidToken();
      if (!token) {
        alert("Session expired. Please sign in again.");
        signOut();
        return;
      }

      // 1. Gather all baseline & today additions
      TSHIRT_SIZES.forEach(sz => {
        const req = currentTshirtRequired[sz] || 0;
        let baseline = tshirtPrintingData.moved[sz] || 0;

        const baseInp = tshirtPrintingTbodyEl?.querySelector(`.tshirt-input-baseline[data-size="${sz}"]`);
        if (baseInp) {
          let bVal = parseInt(baseInp.value, 10);
          if (isNaN(bVal) || bVal < 0) bVal = 0;
          baseline = Math.min(bVal, req);
        }

        const addInp = tshirtPrintingTbodyEl?.querySelector(`.tshirt-input-add[data-size="${sz}"]`);
        let addVal = 0;
        if (addInp) {
          addVal = parseInt(addInp.value, 10);
          if (isNaN(addVal) || addVal < 0) addVal = 0;
        }

        const finalTotal = Math.min(baseline + addVal, req);
        tshirtPrintingData.moved[sz] = finalTotal;
      });

      // Exit direct edit mode on save
      tshirtDirectEditMode = false;
      if (btnToggleDirectEditTshirt) {
        btnToggleDirectEditTshirt.textContent = "✏️ Direct Edit";
        btnToggleDirectEditTshirt.style.background = "#fff";
        btnToggleDirectEditTshirt.style.borderColor = "#cbd5e1";
        btnToggleDirectEditTshirt.style.color = "var(--muted)";
      }

      const nowIso = new Date().toISOString();
      tshirtPrintingData.last_updated = nowIso;

      const payload = {
        key: "tshirt_printing_status",
        value: {
          moved: tshirtPrintingData.moved,
          last_updated: nowIso
        },
        updated_at: nowIso
      };

      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/event_settings`, {
        method: "POST",
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates"
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `HTTP ${res.status}`);
      }

      renderTshirtPrintingTracker();
      showToast("✓ T-Shirt printing status saved successfully! Moved totals updated.");
    } catch (err) {
      console.error("Failed to save T-shirt status to database:", err);
      alert("Failed to save T-shirt printing status: " + err.message);
    } finally {
      btnSaveTshirtStatus.disabled = false;
      btnSaveTshirtStatus.textContent = "💾 Save Printing Status";
    }
  });

  // Quick Action 2: Copy WhatsApp Summary
  btnCopyTshirtSummary?.addEventListener("click", () => {
    let sumReq = 0, sumMoved = 0, sumPending = 0;
    TSHIRT_SIZES.forEach(sz => {
      const r = currentTshirtRequired[sz] || 0;
      const m = Math.min(tshirtPrintingData.moved[sz] || 0, r);
      sumReq += r;
      sumMoved += m;
      sumPending += (r - m);
    });

    let text = `*🏃 ANGAMALY MARATHON 2027 — T-SHIRT PRINTING UPDATE*\n`;
    text += `📅 Date: ${new Date().toLocaleDateString("en-IN")}\n\n`;
    text += `📊 *Summary Totals:*\n`;
    text += `• Total Required (Verified): *${sumReq}*\n`;
    text += `• Moved for Printing: *${sumMoved}*\n`;
    text += `• Pending to Send: *${sumPending > 0 ? `${sumPending} pending` : 'All Sent (0 pending)'}*\n\n`;
    text += `👕 *Size-wise Breakdown (Required vs Moved):*\n`;

    TSHIRT_SIZES.forEach(sz => {
      const r = currentTshirtRequired[sz] || 0;
      const m = Math.min(tshirtPrintingData.moved[sz] || 0, r);
      let statusStr = r === m ? "✓ All Sent" : `⚠️ ${r - m} to send`;
      text += `• *${sz}*: Required ${r} | Moved ${m} (${statusStr})\n`;
    });

    navigator.clipboard.writeText(text).then(() => {
      showToast("📋 T-Shirt printing summary copied to clipboard!");
    }).catch(() => {
      alert("Please copy manually:\n\n" + text);
    });
  });

  // Call loadTshirtPrintingStatus initially
  loadTshirtPrintingStatus();

  // Initialize
  checkExistingSession();
})();


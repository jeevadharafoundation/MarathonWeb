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
    setupRealtimeListener();
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

        const isNewClass = r._isJustReceived ? ' class="new-row-flash"' : '';

        return `
        <tr${isNewClass}>
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
              <button class="btn-verify" onclick="openProofModal('${r.id}')" title="Inspect Payment Proof & Approve">✓ Approve</button>
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

  window.quickVerify = function (id) {
    openProofModal(id);
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

  // ==========================================
  // GALLERY MANAGER (CRUD + DRAG & DROP)
  // ==========================================
  let allGalleryPhotos = [];
  let dragSrcEl = null;
  let dragItem = null;
  let activeEditingPhoto = null;

  // Tabs
  const tabBtnRegistrations = document.getElementById("tabBtnRegistrations");
  const tabBtnGallery = document.getElementById("tabBtnGallery");
  const tabPaneRegistrations = document.getElementById("tabPaneRegistrations");
  const tabPaneGallery = document.getElementById("tabPaneGallery");
  const tabGalleryBadge = document.getElementById("tabGalleryBadge");

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
    if (tab === "gallery") {
      tabBtnRegistrations?.classList.remove("active");
      tabBtnGallery?.classList.add("active");
      if (tabPaneRegistrations) tabPaneRegistrations.style.display = "none";
      if (tabPaneGallery) tabPaneGallery.style.display = "block";
      // Lazy Tab Loading: only fetch gallery on first switch to gallery tab
      if (allGalleryPhotos.length === 0) {
        loadGalleryAdmin();
      }
    } else {
      tabBtnGallery?.classList.remove("active");
      tabBtnRegistrations?.classList.add("active");
      if (tabPaneGallery) tabPaneGallery.style.display = "none";
      if (tabPaneRegistrations) tabPaneRegistrations.style.display = "block";
    }
  }

  tabBtnRegistrations?.addEventListener("click", () => switchTab("registrations"));
  tabBtnGallery?.addEventListener("click", () => switchTab("gallery"));

  // Fetch all gallery photos from Supabase
  async function loadGalleryAdmin() {
    if (!currentSession) return;
    try {
      const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/gallery_images?order=display_order.asc`, {
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${currentSession.access_token}`
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
          <img src="${item.image_url}" alt="${item.title || 'Photo'}" loading="lazy" onerror="if(this.src.endsWith('.webp')){this.src=this.src.replace('.webp','.jpg')}">
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

  // Initialize
  checkExistingSession();
})();


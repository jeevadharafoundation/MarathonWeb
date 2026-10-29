/**
 * ==============================================================================
 * ANGAMALY MARATHON 2027 - REALTIME GOOGLE SHEETS BACKUP SYSTEM
 * ==============================================================================
 * 
 * This Google Apps Script acts as a real-time web endpoint for your Google Sheet.
 * It receives participant registrations & status updates from Supabase/Cloudflare
 * and automatically inserts or updates rows without creating duplicates.
 * 
 * INSTRUCTIONS:
 * 1. Open your Google Sheet (e.g., "Angamaly Marathon 2027 - Live Registrations Backup").
 * 2. In the top menu, go to: Extensions -> Apps Script.
 * 3. Delete any default code in Code.gs and paste this entire file.
 * 4. Click the "Save" icon (or press Ctrl + S).
 * 5. Click "Deploy" (top right) -> "New deployment".
 * 6. Under "Select type", choose "Web app".
 * 7. Set:
 *    - Description: "Angamaly Marathon Realtime Backup"
 *    - Execute as: "Me" (your Google account)
 *    - Who has access: "Anyone"
 * 8. Click "Deploy". Authorize permissions when prompted.
 * 9. Copy the "Web app URL" (starts with https://script.google.com/macros/s/...).
 * 10. Add this URL to your Cloudflare Pages environment as GOOGLE_SHEETS_WEBHOOK_URL.
 * ==============================================================================
 */

const SHEET_NAME = "Registrations";

const HEADERS = [
  "Reg Code",
  "Registered At",
  "Full Name",
  "Phone",
  "Email",
  "Category",
  "Bib Number",
  "Payment Status",
  "Fee Type",
  "Amount (₹)",
  "Payment App",
  "UTR / Ref No",
  "Payment Proof",
  "Student Proof",
  "T-Shirt Size",
  "Gender",
  "Age",
  "DOB",
  "Emergency Contact",
  "Blood Group",
  "Blood Donation",
  "Address",
  "Hear Source",
  "Group Size",
  "Group Members Details",
  "Rejection Reason",
  "Verified At",
  "Admin Notes",
  "Supabase ID",
  "Last Synced At"
];

/**
 * Health check GET request handler
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    message: "Angamaly Marathon 2027 Google Sheets Backup Webhook is active and listening.",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Main Webhook POST handler
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  // Wait up to 30 seconds for concurrent requests to prevent race conditions on row numbers
  try {
    lock.waitLock(30000);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "Lock timeout: Server is busy processing another update."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const sheet = getOrCreateSheet();

    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "Missing request body"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "Malformed JSON payload: " + parseErr.message
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Support single record or bulk batch
    const eventType = payload.type || payload.action || "UPSERT";

    if (eventType === "SYNC_BATCH" || eventType === "BATCH_SYNC" || Array.isArray(payload.records)) {
      const records = payload.records || [];
      let count = 0;
      for (let i = 0; i < records.length; i++) {
        upsertRecord(sheet, records[i]);
        count++;
      }
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        action: "SYNC_BATCH",
        count: count
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // Direct Supabase webhook format: { type: "INSERT" | "UPDATE", record: { ... }, old_record: { ... } }
    const record = payload.record || payload.data || payload;
    if (!record || !record.reg_code) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: "Missing runner reg_code in payload",
        received: payload
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const result = upsertRecord(sheet, record);

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      action: result.action,
      regCode: record.reg_code,
      rowNumber: result.rowNumber
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.toString(),
      stack: err.stack
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Gets the active sheet or creates it with formatted headers
 */
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(SHEET_NAME);
  }

  // Check if header row exists
  if (sheet.getLastRow() === 0 || sheet.getRange(1, 1).getValue() !== HEADERS[0]) {
    sheet.clear();
    sheet.appendRow(HEADERS);

    // Style Header Row
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setBackground("#0f172a");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setFontSize(10);
    headerRange.setWrap(false);
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
    sheet.setRowHeight(1, 38);
  }

  return sheet;
}

/**
 * Inserts or updates a runner record in the sheet
 */
function upsertRecord(sheet, record) {
  const regCode = (record.reg_code || "").toString().trim();
  if (!regCode) return { action: "SKIPPED", rowNumber: -1 };

  const lastRow = sheet.getLastRow();
  let existingRow = -1;

  if (lastRow > 1) {
    const regCodes = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < regCodes.length; i++) {
      if (regCodes[i][0] && regCodes[i][0].toString().trim() === regCode) {
        existingRow = i + 2; // Offset for 1-based indexing + 1 header row
        break;
      }
    }
  }

  const rowValues = buildRowValues(record);

  if (existingRow > 0) {
    // Update existing row
    const range = sheet.getRange(existingRow, 1, 1, rowValues.length);
    range.setValues([rowValues]);
    applyStatusFormatting(sheet, existingRow, record.payment_status);
    return { action: "UPDATED", rowNumber: existingRow };
  } else {
    // Append new row
    sheet.appendRow(rowValues);
    const newRow = sheet.getLastRow();
    applyStatusFormatting(sheet, newRow, record.payment_status);
    return { action: "INSERTED", rowNumber: newRow };
  }
}

/**
 * Maps a runner record to an array of cell values matching the HEADERS
 */
function buildRowValues(r) {
  const paymentProofFormula = r.payment_proof_url
    ? `=HYPERLINK("${r.payment_proof_url}", "View Proof")`
    : "No Proof";

  const studentProofFormula = r.student_proof_url
    ? `=HYPERLINK("${r.student_proof_url}", "View ID")`
    : "";

  let groupSize = "";
  let groupDetails = "";

  if (r.fee_type === "student_group" || (r.group_members && Array.isArray(r.group_members) && r.group_members.length > 0)) {
    const members = Array.isArray(r.group_members) ? r.group_members : [];
    groupSize = 1 + members.length;
    groupDetails = members.map((m, idx) => {
      return `${idx + 1}. ${m.name || "N/A"} (${m.gender || "-"}, ${m.age || "-"}y, ${m.category || "-"}, T-Shirt: ${m.shirt || m.shirt_size || "-"})`;
    }).join(" | ");
  }

  const registeredAtFormatted = formatDateIST(r.created_at);
  const verifiedAtFormatted = formatDateIST(r.verified_at);
  const nowIST = formatDateIST(new Date().toISOString());

  return [
    r.reg_code || "",
    registeredAtFormatted,
    r.full_name || "",
    r.phone ? "'" + r.phone.toString() : "",
    r.email || "",
    r.category || "",
    r.bib_number || "",
    (r.payment_status || "pending").toLowerCase(),
    r.fee_type || "",
    r.amount_payable !== undefined ? Number(r.amount_payable) : "",
    formatPaymentProvider(r.payment_provider),
    r.utr_number ? "'" + r.utr_number.toString() : "",
    paymentProofFormula,
    studentProofFormula,
    r.shirt_size || "",
    r.gender || "",
    r.age !== undefined ? r.age : "",
    r.dob || "",
    r.emergency_contact ? "'" + r.emergency_contact.toString() : "",
    r.blood_group || "",
    r.blood_donation_interest || "No",
    r.address || "",
    r.hear_source || "",
    groupSize,
    groupDetails,
    r.rejection_reason || "",
    verifiedAtFormatted,
    r.admin_notes || "",
    r.id || "",
    nowIST
  ];
}

/**
 * Applies subtle background colors to the Payment Status cell
 */
function applyStatusFormatting(sheet, rowNumber, status) {
  try {
    const statusColIndex = 8; // Column H: "Payment Status"
    const cell = sheet.getRange(rowNumber, statusColIndex);
    const normalized = (status || "").toLowerCase().trim();

    if (normalized === "verified") {
      cell.setBackground("#dcfce7"); // Light green
      cell.setFontColor("#15803d"); // Dark green
      cell.setFontWeight("bold");
    } else if (normalized === "rejected") {
      cell.setBackground("#fee2e2"); // Light red
      cell.setFontColor("#b91c1c"); // Dark red
      cell.setFontWeight("bold");
    } else {
      cell.setBackground("#fef3c7"); // Light yellow
      cell.setFontColor("#b45309"); // Amber
      cell.setFontWeight("bold");
    }
  } catch (e) {
    // Non-critical, ignore format errors
  }
}

/**
 * Format provider code into human readable name
 */
function formatPaymentProvider(code) {
  const providers = {
    gpay: "Google Pay",
    phonepe: "PhonePe",
    paytm: "Paytm",
    supermoney: "SuperMoney",
    amazonpay: "Amazon Pay"
  };
  return providers[code] || code || "";
}

/**
 * Format ISO date string into Indian Standard Time (IST)
 */
function formatDateIST(isoString) {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return Utilities.formatDate(d, "Asia/Kolkata", "dd/MM/yyyy hh:mm a");
  } catch (e) {
    return isoString;
  }
}

/**
 * Test function you can run directly inside Apps Script by clicking 'Run'
 */
function testAppend() {
  const sample = {
    id: "test-uuid-1234",
    reg_code: "AM27-TEST",
    created_at: new Date().toISOString(),
    full_name: "Test Participant",
    email: "test@example.com",
    gender: "Male",
    dob: "1995-06-15",
    age: 31,
    phone: "9876543210",
    emergency_contact: "9123456780",
    blood_group: "O+",
    address: "Angamaly, Kerala",
    hear_source: "Social Media",
    blood_donation_interest: "Yes",
    category: "21.1K",
    shirt_size: "L / 40",
    fee_type: "early",
    amount_payable: 700,
    payment_provider: "gpay",
    utr_number: "TEST-UTR-9999",
    payment_proof_url: "https://example.com/receipt.jpg",
    student_proof_url: "",
    payment_status: "verified",
    bib_number: "12111",
    verified_at: new Date().toISOString(),
    admin_notes: "Test script execution verified"
  };

  const sheet = getOrCreateSheet();
  const res = upsertRecord(sheet, sample);
  Logger.log("Result: " + JSON.stringify(res));
}

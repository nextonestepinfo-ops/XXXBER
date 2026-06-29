const SPREADSHEET_ID = "1I6mEnagIY_ByAwg9vybJZ4SUWgaANiFdbQYgrS3k_EY";
const STORE_SHEET = "app_store";
const CHUNK_SIZE = 45000;

const KEY_LABELS = {
  "sales-manager-entries": "売上伝票",
  "sales-manager-open-tabs": "未確定伝票",
  "sales-manager-staff": "スタッフ",
  "sales-manager-menu": "メニュー",
  "sales-manager-advances": "前借り",
  "sales-manager-cashbox": "金庫",
  "sales-manager-expenses": "経費"
};

const MIRROR_SHEETS = {
  "sales-manager-entries": "entries",
  "sales-manager-open-tabs": "open_tabs",
  "sales-manager-staff": "staff",
  "sales-manager-menu": "menu",
  "sales-manager-advances": "advances",
  "sales-manager-cashbox": "cashbox",
  "sales-manager-expenses": "expenses"
};

function doGet(e) {
  try {
    const action = String((e.parameter && e.parameter.action) || "ping");
    if (action === "get") return json_({ success: true, key: e.parameter.key, value: getValue_(e.parameter.key) });
    return json_({ success: true, service: "XXXBER recovery GAS", spreadsheetId: SPREADSHEET_ID });
  } catch (err) {
    return json_({ success: false, error: errorMessage_(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || "{}");
    if (body.action === "set") {
      setValue_(body.key, body.value);
      mirrorKey_(body.key, body.value);
      return json_({ success: true, key: body.key, updatedAt: new Date().toISOString() });
    }
    if (body.action === "createReceipt") {
      return json_(createReceipt_(body.data || {}));
    }
    return json_({ success: false, error: "Unknown action: " + body.action });
  } catch (err) {
    return json_({ success: false, error: errorMessage_(err) });
  } finally {
    lock.releaseLock();
  }
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorMessage_(err) {
  return err && err.stack ? err.stack : String(err);
}

function ensureStoreSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(STORE_SHEET);
  if (!sheet) sheet = ss.insertSheet(STORE_SHEET);
  const header = sheet.getRange(1, 1, 1, 5).getValues()[0];
  if (header[0] !== "key") {
    sheet.clear();
    sheet.getRange(1, 1, 1, 5).setValues([["key", "chunk_index", "value_json", "updated_at", "label"]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getValue_(key) {
  if (!key) throw new Error("Missing key");
  const sheet = ensureStoreSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  const header = values[0];

  // Legacy format from the imported workbook: key / value_json / updated_at / label.
  if (header[1] === "value_json") {
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === key) return values[i][1] || null;
    }
    return null;
  }

  const chunks = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === key) chunks.push({ index: Number(values[i][1]), value: values[i][2] || "" });
  }
  if (!chunks.length) return null;
  chunks.sort((a, b) => a.index - b.index);
  return chunks.map(chunk => chunk.value).join("");
}

function setValue_(key, value) {
  if (!key) throw new Error("Missing key");
  const sheet = ensureStoreSheet_();
  const now = new Date().toISOString();
  const label = KEY_LABELS[key] || key;
  const text = String(value || "[]");
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) chunks.push(text.slice(i, i + CHUNK_SIZE));
  if (!chunks.length) chunks.push("");

  const values = sheet.getDataRange().getValues();
  const keep = [values[0] && values[0][0] === "key" ? ["key", "chunk_index", "value_json", "updated_at", "label"] : ["key", "chunk_index", "value_json", "updated_at", "label"]];
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] !== key) keep.push([values[i][0], values[i][1], values[i][2], values[i][3], values[i][4]]);
  }
  chunks.forEach((chunk, index) => keep.push([key, index, chunk, now, label]));
  sheet.clearContents();
  sheet.getRange(1, 1, keep.length, 5).setValues(keep);
  sheet.setFrozenRows(1);
}

function mirrorKey_(key, value) {
  const sheetName = MIRROR_SHEETS[key];
  if (!sheetName) return;
  let data;
  try {
    data = JSON.parse(String(value || "[]"));
  } catch (err) {
    data = [];
  }
  if (!Array.isArray(data)) data = [];

  if (key === "sales-manager-entries") {
    writeEntriesMirror_(sheetName, data);
  } else {
    writeJsonMirror_(sheetName, data);
  }
}

function ensureSheet_(name) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function writeEntriesMirror_(sheetName, entries) {
  const sheet = ensureSheet_(sheetName);
  const headers = ["id", "datetime", "staff", "customerName", "payMethod", "amount", "subtotal", "tax", "cardFee", "role", "catchName", "importedFrom", "items_json"];
  const rows = entries.map(entry => headers.map(header => header === "items_json" ? JSON.stringify(entry.items || []) : entry[header] || ""));
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length + 1, headers.length).setValues([headers].concat(rows));
  sheet.setFrozenRows(1);
}

function writeJsonMirror_(sheetName, items) {
  const sheet = ensureSheet_(sheetName);
  const rows = items.map((item, index) => [item && item.id ? item.id : sheetName + "-" + (index + 1), JSON.stringify(item)]);
  sheet.clearContents();
  sheet.getRange(1, 1, Math.max(rows.length + 1, 1), 2).setValues([["id", "json"]].concat(rows));
  sheet.setFrozenRows(1);
}

function createReceipt_(data) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName("receipts");
  if (!sheet) {
    sheet = ss.insertSheet("receipts");
    sheet.getRange(1, 1, 1, 8).setValues([["created_at", "customer", "staff", "amount", "subtotal", "tax", "cardFee", "json"]]);
    sheet.setFrozenRows(1);
  }
  const now = new Date();
  sheet.appendRow([
    now.toISOString(),
    data.customer || "",
    data.staff || "",
    data.amount || 0,
    data.subtotal || 0,
    data.tax || 0,
    data.cardFee || 0,
    JSON.stringify(data)
  ]);

  const doc = DocumentApp.create("XXXBER 領収書 " + Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"));
  const body = doc.getBody();
  body.appendParagraph("領収書").setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph("お客様: " + (data.customer || ""));
  body.appendParagraph("担当: " + (data.staff || ""));
  body.appendParagraph("金額: " + (data.amount || 0));
  body.appendParagraph("税抜: " + (data.subtotal || 0));
  body.appendParagraph("TAX: " + (data.tax || 0));
  body.appendParagraph("カード手数料: " + (data.cardFee || 0));
  body.appendParagraph("決済: " + (data.payMethod || ""));
  body.appendParagraph("作成日時: " + now.toISOString());
  doc.saveAndClose();
  return { success: true, url: doc.getUrl() };
}

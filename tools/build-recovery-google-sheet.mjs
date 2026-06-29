import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const repoRoot = process.cwd();
const seedPath = path.join(repoRoot, "recovery", "seed-data.js");
const outputDir = path.join(repoRoot, "outputs", "recovery-sheet");
const outputPath = path.join(outputDir, "XXXBER_recovery_store.xlsx");

const keyLabels = {
  "sales-manager-entries": "売上伝票",
  "sales-manager-open-tabs": "未確定伝票",
  "sales-manager-staff": "スタッフ",
  "sales-manager-menu": "メニュー",
  "sales-manager-advances": "前借り",
  "sales-manager-cashbox": "金庫",
  "sales-manager-expenses": "経費"
};

function loadSeed() {
  const code = globalThis.__seedText;
  const context = { window: {} };
  vm.runInNewContext(code, context, { filename: seedPath });
  return context.window.RECOVERY_SEED_DATA;
}

function monthSummary(entries) {
  const byMonth = new Map();
  for (const entry of entries) {
    const month = String(entry.datetime || "").slice(0, 7) || "unknown";
    const current = byMonth.get(month) || { count: 0, amount: 0, subtotal: 0, tax: 0, cardFee: 0 };
    current.count += 1;
    current.amount += Number(entry.amount || 0);
    current.subtotal += Number(entry.subtotal || 0);
    current.tax += Number(entry.tax || 0);
    current.cardFee += Number(entry.cardFee || 0);
    byMonth.set(month, current);
  }
  return Array.from(byMonth.entries()).sort().map(([month, value]) => [
    month,
    value.count,
    value.amount,
    value.subtotal,
    value.tax,
    value.cardFee
  ]);
}

function writeTable(sheet, startCell, headers, rows) {
  const range = sheet.getRange(startCell).resize(rows.length + 1, headers.length);
  range.values = [headers, ...rows];
  sheet.getRange(startCell).resize(1, headers.length).format = {
    fill: "#1F4E78",
    font: { bold: true, color: "#FFFFFF" }
  };
  range.format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
  range.format.autofitColumns();
  return range;
}

function writeKeyJsonSheet(workbook, name, data) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  writeTable(sheet, "A1", ["id", "json"], (Array.isArray(data) ? data : []).map((item, index) => [
    item && item.id ? item.id : `${name}-${index + 1}`,
    JSON.stringify(item)
  ]));
  sheet.getRange("B:B").format.columnWidthPx = 720;
  return sheet;
}

function buildWorkbook(seed) {
  const workbook = Workbook.create();
  const keys = seed.keys || {};
  const entries = keys["sales-manager-entries"] || [];

  const summary = workbook.worksheets.add("README");
  summary.showGridLines = false;
  summary.getRange("A1:E1").merge();
  summary.getRange("A1").values = [["XXXBER Recovery Store"]];
  summary.getRange("A1").format = {
    fill: "#12355B",
    font: { bold: true, color: "#FFFFFF" }
  };
  summary.getRange("A3:B8").values = [
    ["Generated at", seed.generatedAt || ""],
    ["Purpose", "Recovery-only Google Sheet for XXXBER emergency version"],
    ["Important", "Do not connect production GAS to this spreadsheet"],
    ["Entries", entries.length],
    ["Recovery app write URL", "Set RECOVERY_WRITE_API_URL after deploying recovery GAS"],
    ["Source", seed.source || ""]
  ];
  summary.getRange("A3:A8").format = { font: { bold: true }, fill: "#EAF2F8" };
  summary.getRange("A3:B8").format.borders = { preset: "all", style: "thin", color: "#D9E2F3" };
  summary.getRange("A1:B20").format.autofitColumns();

  writeTable(summary, "A11", ["Month", "Count", "Amount", "Subtotal", "Tax", "Card fee"], monthSummary(entries));
  summary.getRange("C12:F100").format.numberFormat = "#,##0";

  const appStore = workbook.worksheets.add("app_store");
  appStore.showGridLines = false;
  appStore.freezePanes.freezeRows(1);
  const appRows = Object.keys(keyLabels).map(key => [
    key,
    JSON.stringify(keys[key] || []),
    new Date().toISOString(),
    keyLabels[key]
  ]);
  writeTable(appStore, "A1", ["key", "value_json", "updated_at", "label"], appRows);
  appStore.getRange("B1:B20").format.columnWidthPx = 760;
  appStore.getRange("C1:C20").format.columnWidthPx = 190;

  const entriesSheet = workbook.worksheets.add("entries");
  entriesSheet.showGridLines = false;
  entriesSheet.freezePanes.freezeRows(1);
  const entryHeaders = ["id", "datetime", "staff", "customerName", "payMethod", "amount", "subtotal", "tax", "cardFee", "role", "catchName", "importedFrom", "items_json"];
  const entryRows = entries.map(entry => entryHeaders.map(header => header === "items_json" ? JSON.stringify(entry.items || []) : entry[header] ?? ""));
  writeTable(entriesSheet, "A1", entryHeaders, entryRows);
  entriesSheet.getRange("F1:I200").format.numberFormat = "#,##0";
  entriesSheet.getRange("B1:B200").format.columnWidthPx = 150;

  writeKeyJsonSheet(workbook, "open_tabs", keys["sales-manager-open-tabs"]);
  writeKeyJsonSheet(workbook, "staff", keys["sales-manager-staff"]);
  writeKeyJsonSheet(workbook, "menu", keys["sales-manager-menu"]);
  writeKeyJsonSheet(workbook, "advances", keys["sales-manager-advances"]);
  writeKeyJsonSheet(workbook, "cashbox", keys["sales-manager-cashbox"]);
  writeKeyJsonSheet(workbook, "expenses", keys["sales-manager-expenses"]);

  return workbook;
}

const seedText = await fs.readFile(seedPath, "utf8");
globalThis.__seedText = seedText;

const seed = loadSeed();
await fs.mkdir(outputDir, { recursive: true });
const workbook = buildWorkbook(seed);

const inspect = await workbook.inspect({
  kind: "sheet,table",
  maxChars: 4000,
  tableMaxRows: 3,
  tableMaxCols: 6
});
console.log(inspect.ndjson);

const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);
console.log(outputPath);

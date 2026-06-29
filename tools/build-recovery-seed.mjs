import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const KEY_BY_KIND = {
  entries: "sales-manager-entries",
  "sales-manager-entries": "sales-manager-entries",
  tabs: "sales-manager-open-tabs",
  "open-tabs": "sales-manager-open-tabs",
  open_tabs: "sales-manager-open-tabs",
  "sales-manager-open-tabs": "sales-manager-open-tabs",
  staff: "sales-manager-staff",
  "sales-manager-staff": "sales-manager-staff",
  menu: "sales-manager-menu",
  "sales-manager-menu": "sales-manager-menu",
  advances: "sales-manager-advances",
  "sales-manager-advances": "sales-manager-advances",
  cashbox: "sales-manager-cashbox",
  "sales-manager-cashbox": "sales-manager-cashbox",
  expenses: "sales-manager-expenses",
  "sales-manager-expenses": "sales-manager-expenses"
};

const ALL_KEYS = [
  "sales-manager-entries",
  "sales-manager-open-tabs",
  "sales-manager-staff",
  "sales-manager-menu",
  "sales-manager-advances",
  "sales-manager-cashbox",
  "sales-manager-expenses"
];

const NUMERIC_FIELDS = new Set([
  "amount",
  "subtotal",
  "tax",
  "cardFee",
  "qty",
  "price",
  "hours",
  "startTime",
  "payAmount",
  "total",
  "balance"
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === "\"" && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (ch === "\"") {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === "\"") {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(value => value !== "") || rows.length === 0) rows.push(row);
  return rows;
}

function normalizeKind(value) {
  return String(value || "")
    .trim()
    .replace(/\.csv$/i, "")
    .toLowerCase();
}

function normalizeHeader(header) {
  return String(header || "").trim();
}

function inferKind(value) {
  const normalized = normalizeKind(value);
  if (KEY_BY_KIND[normalized]) return normalized;
  if (normalized.includes("売上") || normalized.includes("sales")) return "entries";
  return null;
}

function coerceValue(name, value) {
  if (value == null) return "";
  const text = String(value).trim();
  if (text === "") return "";
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (NUMERIC_FIELDS.has(name) && /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if ((name === "items" || name.endsWith("_json") || name.endsWith("Json")) && /^[\[{]/.test(text)) {
    return JSON.parse(text);
  }
  return text;
}

function rowToObject(headers, values, fallbackId) {
  const raw = {};
  headers.forEach((header, index) => {
    const name = normalizeHeader(header);
    if (!name || name === "data_type") return;
    raw[name] = values[index] ?? "";
  });
  const jsonText = raw.json || raw.data_json;
  if (jsonText) return JSON.parse(jsonText);
  const obj = {};
  Object.entries(raw).forEach(([name, value]) => {
    if (name === "json" || name === "data_json") return;
    if (name.endsWith("_json")) {
      const cleanName = name.slice(0, -5);
      obj[cleanName] = value ? JSON.parse(value) : null;
    } else {
      obj[name] = coerceValue(name, value);
    }
  });
  if (!obj.id && fallbackId) obj.id = fallbackId;
  return obj;
}

function hasJapaneseSalesHeaders(headers) {
  return ["日時", "お客様", "担当者", "決済", "金額"].every(header => headers.includes(header));
}

function toNumber(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : 0;
}

function toDateTime(value) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return text.replace(" ", "T");
  return text;
}

function toPayMethod(value) {
  const text = String(value ?? "").trim();
  if (text.includes("カード") || /card/i.test(text)) return "card";
  return "cash";
}

function rowToJapaneseSalesEntry(headers, values, fallbackId, sourceName) {
  const raw = {};
  headers.forEach((header, index) => {
    raw[header] = values[index] ?? "";
  });
  return {
    id: fallbackId,
    staff: raw["担当者"] || "",
    customerName: raw["お客様"] || "",
    amount: toNumber(raw["金額"]),
    subtotal: toNumber(raw["税抜"]),
    tax: toNumber(raw["TAX"]),
    cardFee: toNumber(raw["カード手数料"]),
    payMethod: toPayMethod(raw["決済"]),
    role: "従業員",
    datetime: toDateTime(raw["日時"]),
    items: [],
    catchName: "",
    importedFrom: sourceName
  };
}

function readCsvFile(filePath) {
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const rows = parseCsv(text).filter(row => row.some(cell => String(cell).trim() !== ""));
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(normalizeHeader);
  return {
    headers,
    rows: rows.slice(1)
  };
}

function groupMenuRows(rows) {
  if (!rows.length || !("cat" in rows[0]) || !("name" in rows[0])) return rows;
  const byCat = new Map();
  rows.forEach(row => {
    const cat = row.cat || "未分類";
    if (!byCat.has(cat)) byCat.set(cat, { cat, items: [] });
    const item = { ...row };
    delete item.cat;
    if (item.id && String(item.id).startsWith("menu-")) delete item.id;
    byCat.get(cat).items.push(item);
  });
  return Array.from(byCat.values());
}

function importRowsForKey(key, headers, rows, sourceName) {
  const sourceSlug = normalizeKind(sourceName).replace(/[^\p{L}\p{N}_-]+/gu, "-") || "csv";
  const items = rows.map((values, index) => {
    const fallbackId = `${key}-${sourceSlug}-${index + 1}`;
    if (key === "sales-manager-entries" && hasJapaneseSalesHeaders(headers)) {
      return rowToJapaneseSalesEntry(headers, values, fallbackId, sourceName);
    }
    return rowToObject(headers, values, fallbackId);
  });
  return key === "sales-manager-menu" ? groupMenuRows(items) : items;
}

function appendToSeed(seed, key, items) {
  const current = Array.isArray(seed.keys[key]) ? seed.keys[key] : [];
  seed.keys[key] = [...current, ...items];
}

function addCsvToSeed(seed, filePath, defaultKind, fallbackToEntries = false) {
  const { headers, rows } = readCsvFile(filePath);
  if (!headers.length) return;
  const dataTypeIndex = headers.findIndex(header => header === "data_type");
  if (dataTypeIndex >= 0) {
    const grouped = new Map();
    rows.forEach(row => {
      const kind = normalizeKind(row[dataTypeIndex]);
      const key = KEY_BY_KIND[kind];
      if (!key) throw new Error(`Unknown data_type "${row[dataTypeIndex]}" in ${filePath}`);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });
    grouped.forEach((groupRows, key) => {
      appendToSeed(seed, key, importRowsForKey(key, headers, groupRows, path.basename(filePath)));
    });
    return;
  }
  const inferredKind = inferKind(defaultKind);
  const key = inferredKind ? KEY_BY_KIND[inferredKind] : fallbackToEntries ? "sales-manager-entries" : null;
  if (!key) throw new Error(`Cannot infer data kind from ${filePath}`);
  appendToSeed(seed, key, importRowsForKey(key, headers, rows, path.basename(filePath)));
}

function buildSeed(inputPath) {
  const seed = {
    generatedAt: new Date().toISOString(),
    source: path.resolve(inputPath),
    keys: Object.fromEntries(ALL_KEYS.map(key => [key, []]))
  };
  const statPath = path.resolve(inputPath);
  if (!existsSync(statPath)) throw new Error(`Input path not found: ${statPath}`);
  const files = readdirSync(statPath, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map(entry => path.join(statPath, entry.name))
    .sort();
  if (!files.length) throw new Error(`No CSV files found in ${statPath}`);
  files.forEach(file => addCsvToSeed(seed, file, path.basename(file), files.length === 1));
  return seed;
}

const inputDir = process.argv[2] || "data/recovery-csv";
const outputFile = process.argv[3] || "recovery/seed-data.js";
const seed = buildSeed(inputDir);
mkdirSync(path.dirname(outputFile), { recursive: true });
writeFileSync(outputFile, `window.RECOVERY_SEED_DATA = ${JSON.stringify(seed, null, 2)};\n`, "utf8");

console.log(`Wrote ${outputFile}`);
ALL_KEYS.forEach(key => console.log(`${key}: ${Array.isArray(seed.keys[key]) ? seed.keys[key].length : 0}`));

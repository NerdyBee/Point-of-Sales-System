/**
 * Turns rows from a spreadsheet (header -> text) into checked records. Headers are matched
 * loosely ("Selling price", "price", "PRICE (₦)" all mean price) so a shop's own sheet usually
 * works without renaming columns. Nothing here touches the database.
 */

export type RawRow = Record<string, string | number | null | undefined>;

export interface RowResult<T> {
  /** Spreadsheet row number (the header is row 1). */
  row: number;
  data?: T;
  errors: string[];
}

const normalize = (header: string) => header.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");

/** Finds a value by any of the column's accepted names. */
function pick(row: RawRow, names: string[]) {
  const wanted = names.map(normalize);
  for (const [header, value] of Object.entries(row)) {
    if (wanted.includes(normalize(header))) return value === null || value === undefined ? "" : String(value).trim();
  }
  return "";
}

/** "₦1,500.50", "1500.5" or 1500.5 -> smallest units (150050 with 2 decimals). Blank -> null. */
export function parseMoney(value: string, decimals: number): number | null | "invalid" {
  if (!value.trim()) return null;
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  if (!/\d/.test(cleaned)) return "invalid";
  const number = Number(cleaned);
  if (!Number.isFinite(number) || number < 0) return "invalid";
  return Math.round(number * 10 ** decimals);
}

function parseWhole(value: string): number | null | "invalid" {
  const cleaned = value.replace(/[, ]/g, "");
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isInteger(number) && number >= 0 ? number : "invalid";
}

/**
 * YYYY-MM-DD, DD/MM/YYYY (as written in Nigeria and the UK) or an Excel date serial number.
 * Returns YYYY-MM-DD, null when blank.
 */
export function parseDate(value: string): string | null | "invalid" {
  if (!value) return null;
  let year: number, month: number, day: number;
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(value)) [year, month, day] = value.slice(0, 10).split("-").map(Number);
  else if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(value)) [day, month, year] = value.split(/[/.-]/).map(Number);
  else if (/^\d{5}(\.\d+)?$/.test(value)) {
    // Excel counts days from 30 Dec 1899.
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(value)) * 86_400_000);
    [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else return "invalid";
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "invalid";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface ProductRow {
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  reorderPoint: number;
  sku: string;
  barcode: string;
  /** 0-1, or undefined for the business default. */
  taxRate?: number;
  station: "Kitchen" | "Bar" | "Counter";
}

export function productRows(rows: RawRow[], decimals: number): RowResult<ProductRow>[] {
  const seenSkus = new Map<string, number>();
  return rows.map((raw, index) => {
    const row = index + 2;
    const errors: string[] = [];
    const name = pick(raw, ["name", "product", "product name", "item", "item name", "description"]);
    const category = pick(raw, ["category", "group", "department"]).replace(/\s+/g, " ");
    const price = parseMoney(pick(raw, ["price", "selling price", "sale price", "retail price", "unit price"]), decimals);
    const cost = parseMoney(pick(raw, ["cost", "cost price", "purchase price", "buying price"]), decimals);
    const stock = parseWhole(pick(raw, ["stock", "quantity", "qty", "opening stock", "quantity in stock"]));
    const reorderPoint = parseWhole(pick(raw, ["reorder point", "reorder level", "reorder", "minimum stock", "min stock"]));
    const sku = pick(raw, ["sku", "code", "item code", "product code"]);
    const barcode = pick(raw, ["barcode", "ean", "upc"]);
    const vat = pick(raw, ["vat", "vat rate", "tax", "tax rate", "vat %"]);
    const stationText = pick(raw, ["station", "preparation station"]).toLowerCase();

    if (name.length < 2) errors.push("Name is missing");
    if (category.length < 2) errors.push("Category is missing");
    if (price === null) errors.push("Price is missing");
    if (price === "invalid") errors.push("Price is not a number");
    if (cost === "invalid") errors.push("Cost is not a number");
    if (stock === "invalid") errors.push("Stock must be a whole number");
    if (reorderPoint === "invalid") errors.push("Reorder point must be a whole number");
    let taxRate: number | undefined;
    if (vat) {
      const number = Number(vat.replace(/[%\s]/g, ""));
      // "7.5" or "7.5%" means 7.5%; "0.075" also means 7.5%.
      if (!Number.isFinite(number) || number < 0 || number > 100) errors.push("VAT rate is not a percentage");
      else taxRate = number > 1 ? number / 100 : number;
    }
    if (sku) {
      const key = sku.toLowerCase();
      if (seenSkus.has(key)) errors.push(`SKU ${sku} is also on row ${seenSkus.get(key)}`);
      else seenSkus.set(key, row);
    }
    const station = stationText.startsWith("k") ? "Kitchen" : stationText.startsWith("b") ? "Bar" : "Counter";

    if (errors.length) return { row, errors };
    return {
      row,
      errors,
      data: { name, category, price: price as number, cost: (cost as number | null) ?? 0, stock: (stock as number | null) ?? 0, reorderPoint: (reorderPoint as number | null) ?? 0, sku, barcode, taxRate, station }
    };
  });
}

export const customerGroups = ["Walk-in", "VIP", "Credit account", "Wholesale", "Staff"] as const;

export interface CustomerRow {
  name: string;
  phone: string;
  email: string;
  group: (typeof customerGroups)[number];
  creditLimit: number;
  openingBalance: number;
  /** When the opening balance was owed from (YYYY-MM-DD); blank = today. */
  balanceDate: string | null;
  notes: string;
}

export function customerRows(rows: RawRow[], decimals: number): RowResult<CustomerRow>[] {
  const seenPhones = new Map<string, number>();
  return rows.map((raw, index) => {
    const row = index + 2;
    const errors: string[] = [];
    const name = pick(raw, ["name", "customer", "customer name", "full name"]);
    const phone = pick(raw, ["phone", "phone number", "mobile", "telephone", "tel", "whatsapp"]).replace(/[^\d+]/g, "");
    const email = pick(raw, ["email", "e-mail", "email address"]);
    const groupText = pick(raw, ["group", "type", "customer group", "category"]);
    const creditLimit = parseMoney(pick(raw, ["credit limit", "limit"]), decimals);
    const openingBalance = parseMoney(pick(raw, ["opening balance", "balance", "amount owed", "owing", "debt", "outstanding"]), decimals);
    const balanceDate = parseDate(pick(raw, ["balance date", "date", "owed since", "as at", "as of"]));
    const notes = pick(raw, ["notes", "note", "remarks", "comment"]);

    if (name.length < 2) errors.push("Name is missing");
    if (phone.replace("+", "").length < 7) errors.push("Phone number is missing or too short");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email is not valid");
    if (creditLimit === "invalid") errors.push("Credit limit is not a number");
    if (openingBalance === "invalid") errors.push("Opening balance is not a number");
    if (balanceDate === "invalid") errors.push("Balance date is not a date (use YYYY-MM-DD or DD/MM/YYYY)");
    if (phone && seenPhones.has(phone)) errors.push(`Phone ${phone} is also on row ${seenPhones.get(phone)}`);
    else if (phone) seenPhones.set(phone, row);
    const group = customerGroups.find((item) => item.toLowerCase() === groupText.toLowerCase()) ?? ((creditLimit as number) > 0 || (openingBalance as number) > 0 ? "Credit account" : "Walk-in");

    if (errors.length) return { row, errors };
    return {
      row,
      errors,
      data: { name, phone, email, group, creditLimit: (creditLimit as number | null) ?? 0, openingBalance: (openingBalance as number | null) ?? 0, balanceDate: balanceDate as string | null, notes: notes.slice(0, 240) }
    };
  });
}

export interface SupplierBalanceRow {
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  amount: number;
  vatAmount: number;
  note: string;
}

export function supplierBalanceRows(rows: RawRow[], decimals: number): RowResult<SupplierBalanceRow>[] {
  return rows.map((raw, index) => {
    const row = index + 2;
    const errors: string[] = [];
    const supplier = pick(raw, ["supplier", "supplier name", "vendor", "creditor"]);
    const invoiceNumber = pick(raw, ["invoice number", "invoice no", "invoice", "reference", "ref"]);
    const invoiceDate = parseDate(pick(raw, ["invoice date", "date"]));
    const dueDate = parseDate(pick(raw, ["due date", "due"]));
    const amount = parseMoney(pick(raw, ["amount", "balance", "amount owed", "outstanding", "amount due"]), decimals);
    const vatAmount = parseMoney(pick(raw, ["vat", "vat amount", "vat included"]), decimals);
    const note = pick(raw, ["note", "notes", "remarks"]);

    if (supplier.length < 2) errors.push("Supplier is missing");
    if (invoiceNumber.length < 2) errors.push("Invoice number is missing");
    if (invoiceDate === null) errors.push("Invoice date is missing");
    if (invoiceDate === "invalid") errors.push("Invoice date is not a date (use YYYY-MM-DD or DD/MM/YYYY)");
    if (dueDate === "invalid") errors.push("Due date is not a date");
    if (amount === null || amount === 0) errors.push("Amount is missing");
    if (amount === "invalid") errors.push("Amount is not a number");
    if (vatAmount === "invalid") errors.push("VAT is not a number");
    if (typeof amount === "number" && typeof vatAmount === "number" && vatAmount >= amount) errors.push("VAT must be less than the amount");

    if (errors.length) return { row, errors };
    return { row, errors, data: { supplier, invoiceNumber, invoiceDate: invoiceDate as string, dueDate: dueDate as string | null, amount: amount as number, vatAmount: (vatAmount as number | null) ?? 0, note: note.slice(0, 240) } };
  });
}

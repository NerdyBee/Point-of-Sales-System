import type { Platform } from "../data/db";
import type { Product } from "../data/readModel";
import { getKv, setKv } from "../sync/settings";
import { context, getRow, putRow, recordMovement } from "./business";

/**
 * Stock inflow (goods received) and the inflow / sales / stock report for a
 * standalone device. Every quantity change is a row in `stock_movements`, so the
 * report can rebuild any period: opening + inflow - sold +/- adjustments = closing.
 */

export interface InflowLineInput {
  productId: string;
  quantity: number;
  /** Cost per unit for this delivery (optional). */
  unitCost?: number;
}

export interface InflowInput {
  supplier?: string;
  reference?: string;
  note?: string;
  lines: InflowLineInput[];
  /** Save each line's unit cost as the product's cost price. Default true. */
  updateCost?: boolean;
  staffId: string;
}

export interface InflowLine {
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number | null;
}

export interface Inflow {
  id: string;
  number: string;
  supplier: string | null;
  reference: string | null;
  note: string | null;
  lines: InflowLine[];
  totalQuantity: number;
  totalCost: number;
  createdBy: string;
  createdAt: string;
  cancelled?: { at: string; by: string; reason: string };
}

const now = () => new Date().toISOString();

async function nextInflowNumber(platform: Platform) {
  const next = Number((await getKv(platform, "inflow.counter")) ?? 0) + 1;
  await setKv(platform, "inflow.counter", String(next));
  return `INF-${String(next).padStart(5, "0")}`;
}

/** Records goods received: raises each product's stock and logs a receipt movement. */
export async function recordInflow(platform: Platform, input: InflowInput) {
  const settings = await context(platform);
  const merged = new Map<string, { quantity: number; unitCost?: number }>();
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error("Each item needs a quantity of at least 1");
    if (line.unitCost !== undefined && (!Number.isFinite(line.unitCost) || line.unitCost < 0)) throw new Error("Unit cost cannot be negative");
    const existing = merged.get(line.productId);
    merged.set(line.productId, { quantity: (existing?.quantity ?? 0) + line.quantity, unitCost: line.unitCost ?? existing?.unitCost });
  }
  if (!merged.size) throw new Error("Add at least one item");

  const id = `inflow-${platform.uuid()}`;
  let inflow: Inflow | null = null;

  await platform.db.transaction(async () => {
    const number = await nextInflowNumber(platform);
    const lines: InflowLine[] = [];
    for (const [productId, line] of merged) {
      const product = await getRow<Product & Record<string, unknown>>(platform.db, "products", productId);
      if (!product) throw new Error("A product in this inflow no longer exists");
      if (product.category.trim().toLowerCase() === "services") throw new Error(`${product.name} is a service and has no stock`);
      const stock = Number(product.stock) + line.quantity;
      const cost = input.updateCost !== false && line.unitCost !== undefined ? Math.round(line.unitCost) : product.cost;
      await putRow(platform.db, "products", productId, { ...product, stock, cost, archived: false, updatedAt: now() }, settings.branchId);
      await recordMovement(platform, settings, product, line.quantity, `Inflow ${number}${input.supplier?.trim() ? ` from ${input.supplier.trim()}` : ""}`, "receipt", stock, {
        reference: id,
        unitCost: line.unitCost
      });
      lines.push({ productId, productName: product.name, quantity: line.quantity, unitCost: line.unitCost ?? null });
    }
    inflow = {
      id,
      number,
      supplier: input.supplier?.trim() || null,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      lines,
      totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      totalCost: lines.reduce((sum, line) => sum + line.quantity * (line.unitCost ?? 0), 0),
      createdBy: input.staffId,
      createdAt: now()
    };
    await putRow(platform.db, "stock_inflows", id, inflow as unknown as Record<string, unknown>, settings.branchId);
  });
  return inflow as unknown as Inflow;
}

export async function listInflows(platform: Platform, limit = 200) {
  const rows = await platform.db.all<{ data: string }>(
    "SELECT data FROM rows WHERE tbl = 'stock_inflows' ORDER BY json_extract(data, '$.createdAt') DESC, rowid DESC LIMIT ?",
    [limit]
  );
  return rows.map((row) => JSON.parse(row.data) as Inflow);
}

/**
 * Cancels an inflow entered by mistake: takes the quantities back out. Refused if any
 * of that stock has already been sold (current stock lower than what was received).
 */
export async function cancelInflow(platform: Platform, inflowId: string, staffId: string, reason: string) {
  const settings = await context(platform);
  if (reason.trim().length < 3) throw new Error("Enter the reason for cancelling");
  await platform.db.transaction(async () => {
    const inflow = await getRow<Inflow>(platform.db, "stock_inflows", inflowId);
    if (!inflow) throw new Error("Inflow not found");
    if (inflow.cancelled) throw new Error("This inflow is already cancelled");
    for (const line of inflow.lines) {
      const product = await getRow<Product & Record<string, unknown>>(platform.db, "products", line.productId);
      if (!product) continue;
      if (Number(product.stock) < line.quantity) {
        throw new Error(`Cannot cancel: only ${product.stock} ${product.name} left, ${line.quantity} were received. Use Stock → Remove for what is actually missing.`);
      }
    }
    for (const line of inflow.lines) {
      const product = await getRow<Product & Record<string, unknown>>(platform.db, "products", line.productId);
      if (!product) continue;
      const stock = Number(product.stock) - line.quantity;
      await putRow(platform.db, "products", product.id, { ...product, stock, updatedAt: now() }, settings.branchId);
      await recordMovement(platform, settings, product, -line.quantity, `Cancelled ${inflow.number}`, "adjustment", stock, { reference: inflow.id });
    }
    await putRow(platform.db, "stock_inflows", inflow.id, { ...inflow, cancelled: { at: now(), by: staffId, reason: reason.trim() } } as unknown as Record<string, unknown>, settings.branchId);
  });
}

// ----- report --------------------------------------------------------------------------

export interface StockReportRow {
  productId: string;
  name: string;
  category: string;
  archived: boolean;
  tracked: boolean;
  opening: number;
  inflow: number;
  sold: number;
  adjusted: number;
  closing: number;
  /** Quantity right now (equals closing when the period ends now). */
  current: number;
  inflowCost: number;
  salesValue: number;
  costPrice: number;
}

export interface StockReport {
  from: string;
  to: string;
  rows: StockReportRow[];
  totals: { inflow: number; sold: number; adjusted: number; inflowCost: number; salesValue: number; stockValue: number };
  /** Products whose movement history does not add up to their stock (should be empty). */
  mismatched: string[];
}

interface MovementRow {
  productId: string;
  type: string;
  quantityDelta: number;
  reason: string;
  unitCost?: number;
  createdAt: string;
}

function classify(movement: MovementRow): "inflow" | "sold" | "adjusted" {
  if (movement.type === "receipt" || movement.type === "count") return "inflow";
  if (movement.type === "issue" || movement.type === "return") return "sold";
  // Voids recorded before "return" existed were stored as adjustments named "Void ...".
  if (movement.type === "adjustment" && movement.reason.startsWith("Void ")) return "sold";
  return "adjusted";
}

/** Inflow vs sales vs stock per product for [from, to). */
export async function stockReport(platform: Platform, range: { from: Date; to: Date }): Promise<StockReport> {
  const settings = await context(platform);
  const from = range.from.toISOString();
  const to = range.to.toISOString();

  const products = (await platform.db.all<{ data: string }>("SELECT data FROM rows WHERE tbl = 'products' AND branchId = ?", [settings.branchId])).map(
    (row) => JSON.parse(row.data) as Product
  );
  const movements = (await platform.db.all<{ data: string }>("SELECT data FROM rows WHERE tbl = 'stock_movements' AND json_extract(data, '$.createdAt') >= ?", [from])).map(
    (row) => JSON.parse(row.data) as MovementRow
  );
  const sales = await platform.db.all<{ data: string }>("SELECT data FROM sales WHERE status <> 'voided' AND createdAt >= ? AND createdAt < ?", [from, to]);

  const salesByProduct = new Map<string, { quantity: number; value: number }>();
  for (const sale of sales) {
    const record = JSON.parse(sale.data) as { summary: { lines: { productId: string; quantity: number; subtotal: number; discount: number }[] } };
    for (const line of record.summary.lines) {
      const current = salesByProduct.get(line.productId) ?? { quantity: 0, value: 0 };
      salesByProduct.set(line.productId, { quantity: current.quantity + line.quantity, value: current.value + line.subtotal - line.discount });
    }
  }

  const rows: StockReportRow[] = [];
  const mismatched: string[] = [];
  for (const product of products) {
    const tracked = product.category.trim().toLowerCase() !== "services";
    const mine = movements.filter((movement) => movement.productId === product.id);
    const inRange = mine.filter((movement) => movement.createdAt < to);
    const afterRange = mine.filter((movement) => movement.createdAt >= to);
    const current = Number(product.stock);
    const sumDelta = (list: MovementRow[]) => list.reduce((sum, movement) => sum + Number(movement.quantityDelta), 0);

    const closing = current - sumDelta(afterRange);
    const opening = closing - sumDelta(inRange);
    const inflow = sumDelta(inRange.filter((movement) => classify(movement) === "inflow"));
    const soldMovements = 0 - sumDelta(inRange.filter((movement) => classify(movement) === "sold")) || 0;
    const adjusted = sumDelta(inRange.filter((movement) => classify(movement) === "adjusted"));
    const inflowCost = inRange
      .filter((movement) => movement.type === "receipt")
      .reduce((sum, movement) => sum + Number(movement.quantityDelta) * Number(movement.unitCost ?? product.cost ?? 0), 0);
    const salesLine = salesByProduct.get(product.id);
    const sold = tracked ? soldMovements : salesLine?.quantity ?? 0;

    const active = inflow || sold || adjusted || closing || opening || salesLine;
    if (!active && product.archived) continue;
    if (tracked && opening + inflow - soldMovements + adjusted !== closing) mismatched.push(product.name);

    rows.push({
      productId: product.id,
      name: product.name,
      category: product.category,
      archived: Boolean(product.archived),
      tracked,
      opening: tracked ? opening : 0,
      inflow,
      sold,
      adjusted,
      closing: tracked ? closing : 0,
      current: tracked ? current : 0,
      inflowCost,
      salesValue: salesLine?.value ?? 0,
      costPrice: Number(product.cost ?? 0)
    });
  }
  rows.sort((left, right) => left.name.localeCompare(right.name));

  return {
    from,
    to,
    rows,
    mismatched,
    totals: {
      inflow: rows.reduce((sum, row) => sum + row.inflow, 0),
      sold: rows.reduce((sum, row) => sum + row.sold, 0),
      adjusted: rows.reduce((sum, row) => sum + row.adjusted, 0),
      inflowCost: rows.reduce((sum, row) => sum + row.inflowCost, 0),
      salesValue: rows.reduce((sum, row) => sum + row.salesValue, 0),
      stockValue: rows.reduce((sum, row) => sum + (row.tracked ? Math.max(0, row.closing) * row.costPrice : 0), 0)
    }
  };
}

/** CSV for sharing/opening in a spreadsheet. */
export function stockReportCsv(report: StockReport, options: { includeCosts: boolean }) {
  const header = ["Product", "Category", "Opening", "Inflow", "Sold", "Adjusted", "Closing", ...(options.includeCosts ? ["Inflow cost", "Sales value"] : [])];
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [header.join(",")];
  for (const row of report.rows) {
    lines.push(
      [row.name, row.category, row.tracked ? row.opening : "", row.inflow, row.sold, row.adjusted, row.tracked ? row.closing : "", ...(options.includeCosts ? [row.inflowCost, row.salesValue] : [])]
        .map(escape)
        .join(",")
    );
  }
  lines.push(["TOTAL", "", "", report.totals.inflow, report.totals.sold, report.totals.adjusted, "", ...(options.includeCosts ? [report.totals.inflowCost, report.totals.salesValue] : [])].map(escape).join(","));
  return lines.join("\n");
}

export type ReportPeriod = "today" | "yesterday" | "week" | "month" | "last30" | "all";

export function periodRange(period: ReportPeriod, now = new Date()) {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 24 * 60 * 60 * 1000;
  // Upper bound slightly in the future so movements recorded "now" are included.
  const end = new Date(now.getTime() + 60_000);
  switch (period) {
    case "today":
      return { from: startOfDay, to: end };
    case "yesterday":
      return { from: new Date(startOfDay.getTime() - day), to: startOfDay };
    case "week": {
      const monday = new Date(startOfDay.getTime() - ((startOfDay.getDay() + 6) % 7) * day);
      return { from: monday, to: end };
    }
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: end };
    case "last30":
      return { from: new Date(startOfDay.getTime() - 29 * day), to: end };
    default:
      return { from: new Date(2000, 0, 1), to: end };
  }
}

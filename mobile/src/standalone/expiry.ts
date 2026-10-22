import type { Db, Platform } from "../data/db";
import type { Product } from "../data/readModel";
import { activeClearance } from "../pos/clearance";
import type { DeviceSettings } from "../sync/settings";
import { context, getRow, now, putRow } from "./store";

/**
 * Stock batches ("lots") and expiry dates.
 *
 * Every delivery (inflow line, opening stock, stock received) is a batch with its quantity
 * and, optionally, the expiry date printed on it. What is left of each batch is worked out
 * from the product's current stock, assuming the oldest units are sold first: the newest
 * batches hold the units on the shelf. So sales, voids and stock counts need no extra
 * bookkeeping. Stock from before batches were recorded counts as older than every batch.
 */

export interface StockLot {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  productName: string;
  quantity: number;
  /** YYYY-MM-DD, or null when no date was entered. */
  expiryDate: string | null;
  source: "inflow" | "opening" | "received";
  reference: string | null;
  createdBy: string;
  createdAt: string;
}

export interface LotWithRemaining extends StockLot {
  remaining: number;
  /** Days until expiry (0 = expires today, negative = expired); null without a date. */
  daysLeft: number | null;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export function validExpiryDate(value: string | null | undefined) {
  if (!value) return null;
  if (!isoDate.test(value)) throw new Error("Expiry date must look like 2026-12-31");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error("That expiry date does not exist");
  return value;
}

export function daysUntil(expiryDate: string, today = new Date()) {
  const [year, month, day] = expiryDate.split("-").map(Number);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((new Date(year, month - 1, day).getTime() - start) / 86_400_000);
}

/** Records a batch. Call inside the transaction that raises the stock. */
export async function addLot(
  db: Db,
  settings: DeviceSettings,
  input: { id: string; product: Pick<Product, "id" | "name">; quantity: number; expiryDate?: string | null; source: StockLot["source"]; reference?: string | null; createdBy: string }
) {
  if (input.quantity <= 0) return null;
  const lot: StockLot = {
    id: input.id,
    tenantId: settings.tenantId,
    branchId: settings.branchId,
    productId: input.product.id,
    productName: input.product.name,
    quantity: input.quantity,
    expiryDate: validExpiryDate(input.expiryDate),
    source: input.source,
    reference: input.reference ?? null,
    createdBy: input.createdBy,
    createdAt: now()
  };
  await putRow(db, "stock_lots", lot.id, lot as unknown as Record<string, unknown>, settings.branchId);
  return lot;
}

/** Works out what is left of each batch from the current stock (newest batches first). */
export function allocateStock(stock: number, lots: StockLot[], today = new Date()): LotWithRemaining[] {
  let left = Math.max(0, stock);
  const newestFirst = [...lots].sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));
  return newestFirst.map((lot) => {
    const remaining = Math.min(lot.quantity, left);
    left -= remaining;
    return { ...lot, remaining, daysLeft: lot.expiryDate ? daysUntil(lot.expiryDate, today) : null };
  });
}

async function lotsByProduct(db: Db, productId?: string) {
  const rows = await db.all<{ data: string }>(
    productId
      ? "SELECT data FROM rows WHERE tbl = 'stock_lots' AND json_extract(data, '$.productId') = ?"
      : "SELECT data FROM rows WHERE tbl = 'stock_lots'",
    productId ? [productId] : []
  );
  const map = new Map<string, StockLot[]>();
  for (const row of rows) {
    const lot = JSON.parse(row.data) as StockLot;
    map.set(lot.productId, [...(map.get(lot.productId) ?? []), lot]);
  }
  return map;
}

/** A product's batches with what is left of each, newest first. */
export async function productLots(platform: Platform, product: Pick<Product, "id" | "stock">, today = new Date()) {
  const lots = (await lotsByProduct(platform.db, product.id)).get(product.id) ?? [];
  return allocateStock(Number(product.stock), lots, today);
}

export interface ExpiringRow {
  product: Product;
  lot: LotWithRemaining;
}

/** Batches still on the shelf that expire within `withinDays` (or already expired), soonest first. */
export async function expiringSoon(platform: Platform, options: { withinDays?: number; today?: Date } = {}) {
  const settings = await context(platform);
  const withinDays = options.withinDays ?? 30;
  const today = options.today ?? new Date();
  const products = (await platform.db.all<{ data: string }>("SELECT data FROM rows WHERE tbl = 'products' AND branchId = ?", [settings.branchId])).map(
    (row) => JSON.parse(row.data) as Product
  );
  const lots = await lotsByProduct(platform.db);
  const rows: ExpiringRow[] = [];
  for (const product of products) {
    if (product.archived) continue;
    for (const lot of allocateStock(Number(product.stock), lots.get(product.id) ?? [], today)) {
      if (lot.remaining > 0 && lot.daysLeft !== null && lot.daysLeft <= withinDays) rows.push({ product, lot });
    }
  }
  return rows.sort((a, b) => a.lot.daysLeft! - b.lot.daysLeft! || a.product.name.localeCompare(b.product.name));
}

/** Products currently on clearance. */
export async function productsOnClearance(platform: Platform) {
  const settings = await context(platform);
  const products = (await platform.db.all<{ data: string }>("SELECT data FROM rows WHERE tbl = 'products' AND branchId = ?", [settings.branchId])).map(
    (row) => JSON.parse(row.data) as Product
  );
  return products.filter((product) => activeClearance(product)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Clearance price for a percentage off (rounded to the nearest whole unit). */
export function priceForPercent(price: number, percent: number) {
  return Math.max(0, Math.round(price * (1 - percent / 100)));
}

/**
 * Puts `units` of a product on clearance at `clearancePrice` until `endsAt` (inclusive).
 * Replaces any clearance already on the product.
 */
export async function setClearance(
  platform: Platform,
  input: { productId: string; clearancePrice: number; units: number; endsAt?: string | null; expiryDate?: string | null; staffId: string }
) {
  const settings = await context(platform);
  const product = await getRow<Product & Record<string, unknown>>(platform.db, "products", input.productId);
  if (!product) throw new Error("Product not found");
  if (!Number.isInteger(input.clearancePrice) || input.clearancePrice < 0) throw new Error("Enter the clearance price");
  if (input.clearancePrice >= product.price) throw new Error(`The clearance price must be below the normal price of ${product.price.toLocaleString()}`);
  if (!Number.isInteger(input.units) || input.units <= 0) throw new Error("Enter how many units are on clearance");
  if (input.units > Number(product.stock)) throw new Error(`Only ${product.stock} ${product.name} in stock`);
  const endsAt = validExpiryDate(input.endsAt);
  if (endsAt && daysUntil(endsAt) < 0) throw new Error("The end date has already passed");
  const updated = {
    ...product,
    clearancePrice: input.clearancePrice,
    clearancePercent: Math.round(((product.price - input.clearancePrice) / product.price) * 100),
    clearanceRemaining: input.units,
    clearanceEndsAt: endsAt,
    clearanceExpiry: validExpiryDate(input.expiryDate),
    clearanceSetBy: input.staffId,
    clearanceSetAt: now(),
    updatedAt: now()
  };
  await putRow(platform.db, "products", product.id, updated, settings.branchId);
  return updated as unknown as Product;
}

export async function endClearance(platform: Platform, productId: string) {
  const settings = await context(platform);
  const product = await getRow<Product & Record<string, unknown>>(platform.db, "products", productId);
  if (!product) throw new Error("Product not found");
  await putRow(
    platform.db,
    "products",
    product.id,
    { ...product, clearancePrice: null, clearancePercent: null, clearanceRemaining: 0, clearanceEndsAt: null, clearanceExpiry: null, updatedAt: now() },
    settings.branchId
  );
}

/** Uses up clearance units sold (or gives them back on a void). Call inside the sale's transaction. */
export async function adjustClearanceRemaining(db: Db, productId: string, delta: number) {
  await db.run(
    "UPDATE rows SET data = json_set(data, '$.clearanceRemaining', MAX(0, COALESCE(json_extract(data, '$.clearanceRemaining'), 0) + ?)) WHERE tbl = 'products' AND id = ?",
    [delta, productId]
  );
}

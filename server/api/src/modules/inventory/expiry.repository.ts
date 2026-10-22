import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { appendAudit, demoProducts, stockLots, type DemoProduct, type StockLot } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";


import { activeClearance, allocateStock, clearanceFieldsOf, daysUntil, isValidExpiryDate } from "../../shared/inventory/expiry";

const useDemoStore = process.env.NODE_ENV === "test";

type BranchScope = { branchId?: string; branchIds?: string[] };

const inScope = (scope: BranchScope, branchId: string) =>
  scope.branchIds?.length ? scope.branchIds.includes(branchId) : scope.branchId ? scope.branchId === branchId : true;

export function newLotId() {
  return `lot-${randomUUID()}`;
}

export interface LotInput {
  tenantId: string;
  branchId: string;
  productId: string;
  productName: string;
  quantity: number;
  expiryDate?: string | null;
  source: string;
  reference?: string | null;
  createdBy: string;
}

function lotRecord(input: LotInput): StockLot {
  return {
    id: newLotId(),
    tenantId: input.tenantId,
    branchId: input.branchId,
    productId: input.productId,
    productName: input.productName,
    quantity: input.quantity,
    expiryDate: input.expiryDate || null,
    source: input.source,
    reference: input.reference ?? null,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString()
  };
}

/** Records a received batch. Pass the transaction when called inside one (Prisma). */
export async function recordStockLot(input: LotInput, tx?: Prisma.TransactionClient) {
  if (input.quantity <= 0) return null;
  const lot = lotRecord(input);
  if (useDemoStore) {
    stockLots.push(lot);
    return lot;
  }
  await (tx ?? prisma).stockLot.create({ data: { ...lot, createdAt: new Date(lot.createdAt) } });
  return lot;
}

export function invalidExpiryDate(value: string | undefined | null) {
  return Boolean(value) && !isValidExpiryDate(value!);
}

/** Batches still on the shelf expiring within `days` (or already expired), soonest first. */
export async function listExpiringLots(tenantId: string, scope: BranchScope, days: number) {
  const now = new Date();
  const products: { id: string; branchId: string; name: string; stock: number; price: number; category: string }[] & Record<string, unknown>[] = useDemoStore
    ? (demoProducts.filter((product) => product.tenantId === tenantId && inScope(scope, product.branchId)) as never)
    : ((await prisma.product.findMany({
        where: { tenantId, ...(scope.branchIds?.length ? { branchId: { in: scope.branchIds } } : scope.branchId ? { branchId: scope.branchId } : {}) }
      })) as never);
  const lots = useDemoStore
    ? stockLots.filter((lot) => lot.tenantId === tenantId && inScope(scope, lot.branchId))
    : (await prisma.stockLot.findMany({ where: { tenantId, productId: { in: products.map((product) => product.id) } } })).map((lot) => ({ ...lot, createdAt: lot.createdAt.toISOString() }));

  const byProduct = new Map<string, typeof lots>();
  for (const lot of lots) byProduct.set(lot.productId, [...(byProduct.get(lot.productId) ?? []), lot]);

  const rows = [];
  for (const product of products) {
    for (const lot of allocateStock(product.stock, byProduct.get(product.id) ?? [], now)) {
      if (lot.remaining > 0 && lot.daysLeft !== null && lot.daysLeft <= days) {
        rows.push({
          lot: { id: lot.id, quantity: lot.quantity, remaining: lot.remaining, expiryDate: lot.expiryDate, daysLeft: lot.daysLeft, reference: lot.reference, source: lot.source, createdAt: lot.createdAt },
          product: { id: product.id, branchId: product.branchId, name: product.name, category: product.category, price: product.price, stock: product.stock, ...clearanceFieldsOf(product as never) }
        });
      }
    }
  }
  return rows.sort((a, b) => a.lot.daysLeft! - b.lot.daysLeft! || a.product.name.localeCompare(b.product.name));
}

export interface ClearanceInput {
  clearancePrice: number;
  units: number;
  endsAt?: string;
  expiryDate?: string;
}

/** Puts units of a product on clearance (replaces any running clearance). */
export async function setProductClearance(tenantId: string, scope: BranchScope, userId: string, productId: string, input: ClearanceInput) {
  const endsAt = input.endsAt || null;
  const expiryDate = input.expiryDate || null;
  if ((endsAt && !isValidExpiryDate(endsAt)) || (expiryDate && !isValidExpiryDate(expiryDate))) return { status: "invalid_date" as const };
  if (endsAt && daysUntil(endsAt) < 0) return { status: "ends_in_past" as const };

  const load = async () =>
    useDemoStore
      ? demoProducts.find((product) => product.tenantId === tenantId && product.id === productId && inScope(scope, product.branchId))
      : await prisma.product.findFirst({ where: { tenantId, id: productId } });
  const product = await load();
  if (!product || !inScope(scope, product.branchId)) return { status: "product_not_found" as const };
  if (input.clearancePrice >= product.price) return { status: "price_not_lower" as const, price: product.price };
  if (input.units > product.stock) return { status: "not_enough_stock" as const, stock: product.stock };

  const fields = {
    clearancePrice: input.clearancePrice,
    clearancePercent: Math.round(((product.price - input.clearancePrice) / product.price) * 100),
    clearanceRemaining: input.units,
    clearanceEndsAt: endsAt,
    clearanceExpiry: expiryDate,
    clearanceSetBy: userId
  };
  const audit = { tenantId, branchId: product.branchId, userId, action: "product.clearance_set" as const, entityType: "product", entityId: product.id, metadata: { ...fields } };

  if (useDemoStore) {
    Object.assign(product as DemoProduct, fields, { clearanceSetAt: new Date().toISOString() });
    appendAudit(audit);
    return { status: "set" as const, product: { ...(product as DemoProduct) } };
  }
  const updated = await prisma.product.update({ where: { id: product.id }, data: { ...fields, clearanceSetAt: new Date() } });
  await prisma.auditEvent.create({ data: { id: `audit-${randomUUID()}`, ...audit, metadata: audit.metadata as Prisma.InputJsonValue } });
  return { status: "set" as const, product: { ...updated, taxRate: Number(updated.taxRate), ...clearanceFieldsOf(updated) } };
}

export async function endProductClearance(tenantId: string, scope: BranchScope, userId: string, productId: string) {
  const cleared = { clearancePrice: null, clearancePercent: null, clearanceRemaining: 0, clearanceEndsAt: null, clearanceExpiry: null };
  if (useDemoStore) {
    const product = demoProducts.find((item) => item.tenantId === tenantId && item.id === productId && inScope(scope, item.branchId));
    if (!product) return { status: "product_not_found" as const };
    Object.assign(product, cleared);
    appendAudit({ tenantId, branchId: product.branchId, userId, action: "product.clearance_ended", entityType: "product", entityId: product.id, metadata: {} });
    return { status: "ended" as const };
  }
  const product = await prisma.product.findFirst({ where: { tenantId, id: productId } });
  if (!product || !inScope(scope, product.branchId)) return { status: "product_not_found" as const };
  await prisma.product.update({ where: { id: product.id }, data: cleared });
  await prisma.auditEvent.create({
    data: { id: `audit-${randomUUID()}`, tenantId, branchId: product.branchId, userId, action: "product.clearance_ended", entityType: "product", entityId: product.id, metadata: {} }
  });
  return { status: "ended" as const };
}

export { activeClearance };

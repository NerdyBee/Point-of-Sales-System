import type { quotationInputSchema } from "@pos/validation";
import type { z } from "zod";
import { appendAudit, demoProducts, demoTenants, quotations as demoQuotations, type Quotation } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { previewSaleTotal, type SaleCatalogProduct } from "../sales/sales.service";

const useDemoStore = process.env.NODE_ENV === "test";

export type QuotationInput = z.infer<typeof quotationInputSchema>;
export type QuotationStatus = Quotation["status"];

const prefixes = { quotation: "QT", proforma: "PF" } as const;

/** Which status changes are allowed: converted and cancelled are final. */
const allowed: Record<QuotationStatus, QuotationStatus[]> = {
  open: ["accepted", "cancelled", "converted"],
  accepted: ["cancelled", "converted"],
  converted: [],
  cancelled: []
};

function endOfDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

/** As sent to the screens: dates as ISO strings, and whether an open quote has run out. */
function toApi(row: Omit<Quotation, "validUntil" | "createdAt" | "updatedAt" | "customerId" | "customerPhone" | "customerEmail" | "note" | "saleId"> & {
  validUntil: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
  customerId?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  note?: string | null;
  saleId?: string | null;
}) {
  const validUntil = new Date(row.validUntil);
  return {
    id: row.id,
    branchId: row.branchId,
    kind: row.kind as Quotation["kind"],
    number: row.number,
    status: row.status as QuotationStatus,
    expired: (row.status === "open" || row.status === "accepted") && validUntil.getTime() < Date.now(),
    customerId: row.customerId ?? "",
    customerName: row.customerName,
    customerPhone: row.customerPhone ?? "",
    customerEmail: row.customerEmail ?? "",
    summary: (typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary) as ReturnType<typeof previewSaleTotal>,
    validUntil: validUntil.toISOString(),
    note: row.note ?? "",
    saleId: row.saleId ?? "",
    createdBy: row.createdBy,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString()
  };
}

export type ApiQuotation = ReturnType<typeof toApi>;

/** Prices the lines from the branch's catalogue, with the business's VAT and service charge. */
async function price(tenantId: string, input: QuotationInput) {
  let catalog: SaleCatalogProduct[];
  let settings: Record<string, any>;
  if (useDemoStore) {
    catalog = demoProducts;
    settings = demoTenants.find((tenant) => tenant.id === tenantId)?.settings ?? {};
  } else {
    const products = await prisma.product.findMany({
      where: { tenantId, branchId: input.branchId, id: { in: input.lines.map((line) => line.productId) } },
      select: { id: true, tenantId: true, branchId: true, name: true, category: true, price: true, taxRate: true }
    });
    catalog = products.map((product) => ({ ...product, taxRate: Number(product.taxRate) }));
    settings = ((await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }))?.settings ?? {}) as Record<string, any>;
  }
  const { paid: _paid, balance: _balance, ...summary } = previewSaleTotal(
    tenantId,
    { branchId: input.branchId, terminalId: "quotation", idempotencyKey: "quotation-preview", lines: input.lines.map((line) => ({ ...line, discount: line.discount ?? 0 })), payments: [] },
    { vatRate: settings.defaultTaxRate ?? undefined, serviceChargeEnabled: settings.serviceChargeEnabled ?? true, serviceChargeRate: settings.serviceChargeRate ?? 0.05 },
    catalog
  );
  return summary;
}

export async function listQuotations(tenantId: string, filters: { branchIds?: string[]; status?: string; search?: string }) {
  const search = filters.search?.trim().toLowerCase();
  if (useDemoStore) {
    return demoQuotations
      .filter((row) => row.tenantId === tenantId && (!filters.branchIds || filters.branchIds.includes(row.branchId)) && (!filters.status || row.status === filters.status))
      .filter((row) => !search || `${row.number} ${row.customerName} ${row.customerPhone ?? ""}`.toLowerCase().includes(search))
      .map(toApi);
  }
  const rows = await prisma.quotation.findMany({
    where: {
      tenantId,
      ...(filters.branchIds ? { branchId: { in: filters.branchIds } } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(search ? { OR: [{ number: { contains: search } }, { customerName: { contains: search } }, { customerPhone: { contains: search } }] } : {})
    },
    orderBy: { createdAt: "desc" },
    take: 500
  });
  return rows.map((row) => toApi({ ...row, kind: row.kind as Quotation["kind"], status: row.status as QuotationStatus }));
}

export async function getQuotation(tenantId: string, id: string) {
  if (useDemoStore) {
    const row = demoQuotations.find((item) => item.tenantId === tenantId && item.id === id);
    return row ? toApi(row) : null;
  }
  const row = await prisma.quotation.findFirst({ where: { tenantId, id } });
  return row ? toApi({ ...row, kind: row.kind as Quotation["kind"], status: row.status as QuotationStatus }) : null;
}

export async function createQuotation(tenantId: string, userId: string, input: QuotationInput) {
  let summary: Awaited<ReturnType<typeof price>>;
  try {
    summary = await price(tenantId, input);
  } catch (error) {
    return { status: "invalid_product" as const, message: error instanceof Error ? error.message : "Product not found" };
  }
  const base = {
    tenantId,
    branchId: input.branchId,
    kind: input.kind,
    status: "open" as const,
    customerId: input.customerId || undefined,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone || undefined,
    customerEmail: input.customerEmail || undefined,
    note: input.note || undefined,
    createdBy: userId
  };
  const prefix = prefixes[input.kind];
  const numberAfter = (count: number) => `${prefix}-${String(count + 1).padStart(6, "0")}`;

  if (useDemoStore) {
    const now = new Date().toISOString();
    const row: Quotation = {
      ...base,
      id: `quote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      number: numberAfter(demoQuotations.filter((item) => item.tenantId === tenantId && item.kind === input.kind).length),
      summary,
      validUntil: endOfDay(input.validUntil).toISOString(),
      createdAt: now,
      updatedAt: now
    };
    demoQuotations.unshift(row);
    appendAudit({ tenantId, branchId: input.branchId, userId, action: input.kind === "proforma" ? ("proforma.created" as const) : ("quotation.created" as const), entityType: "quotation", entityId: row.id, metadata: { number: row.number, total: summary.total } });
    return { status: "created" as const, quotation: toApi(row) };
  }

  // Two tills saving at once can pick the same number: try the next one.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const count = await prisma.quotation.count({ where: { tenantId, kind: input.kind } });
    try {
      const row = await prisma.quotation.create({
        data: {
          ...base,
          id: `quote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          number: numberAfter(count + attempt),
          summary,
          validUntil: endOfDay(input.validUntil)
        }
      });
      await prisma.auditEvent.create({
        data: { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tenantId, branchId: input.branchId, userId, action: input.kind === "proforma" ? ("proforma.created" as const) : ("quotation.created" as const), entityType: "quotation", entityId: row.id, metadata: { number: row.number, total: summary.total } }
      });
      return { status: "created" as const, quotation: toApi({ ...row, kind: row.kind as Quotation["kind"], status: row.status as QuotationStatus }) };
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  throw new Error("Could not number the quotation; try again");
}

export async function setQuotationStatus(tenantId: string, userId: string, id: string, status: QuotationStatus, saleId?: string, branchIds?: string[]) {
  const current = await getQuotation(tenantId, id);
  if (!current || (branchIds && !branchIds.includes(current.branchId))) return { status: "not_found" as const };
  if (!allowed[current.status].includes(status)) return { status: "not_allowed" as const, from: current.status };

  if (useDemoStore) {
    const row = demoQuotations.find((item) => item.id === id)!;
    row.status = status;
    if (saleId) row.saleId = saleId;
    row.updatedAt = new Date().toISOString();
    appendAudit({ tenantId, branchId: row.branchId, userId, action: `quotation.${status as Exclude<QuotationStatus, "open">}` as const, entityType: "quotation", entityId: id, metadata: { number: row.number, saleId } });
    return { status: "updated" as const, quotation: toApi(row) };
  }
  const row = await prisma.quotation.update({ where: { id }, data: { status, ...(saleId ? { saleId } : {}) } });
  await prisma.auditEvent.create({
    data: { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tenantId, branchId: row.branchId, userId, action: `quotation.${status as Exclude<QuotationStatus, "open">}` as const, entityType: "quotation", entityId: id, metadata: { number: row.number, saleId } }
  });
  return { status: "updated" as const, quotation: toApi({ ...row, kind: row.kind as Quotation["kind"], status: row.status as QuotationStatus }) };
}

import type { Prisma, Product as DbProduct } from "@prisma/client";
import { appendAudit, branches, demoProducts, demoTenants, type DemoProduct } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";

export type ProductInput = Omit<DemoProduct, "id" | "tenantId" | "taxRate"> & { taxRate?: number };

const useDemoStore = process.env.NODE_ENV === "test";

function toApiProduct(product: DbProduct): DemoProduct {
  return {
    id: product.id,
    tenantId: product.tenantId,
    branchId: product.branchId,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    category: product.category,
    price: product.price,
    cost: product.cost,
    taxRate: Number(product.taxRate),
    image: product.image,
    stock: product.stock,
    reorderPoint: product.reorderPoint,
    station: product.station as DemoProduct["station"],
    modifiers: Array.isArray(product.modifiers) ? product.modifiers.map(String) : []
  };
}

function nextProductId() {
  return `p${demoProducts.length + 1}`;
}

export async function listCatalogProducts(tenantId: string, branchId?: string) {
  if (useDemoStore) {
    return demoProducts.filter((product) => product.tenantId === tenantId && (!branchId || product.branchId === branchId));
  }

  const products = await prisma.product.findMany({
    where: { tenantId, branchId: branchId ? branchId : undefined },
    orderBy: { name: "asc" }
  });

  return products.map(toApiProduct);
}

export async function getTenantSettings(tenantId: string) {
  if (useDemoStore) {
    return demoTenants.find((tenant) => tenant.id === tenantId)?.settings ?? null;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true }
  });

  return tenant?.settings as (typeof demoTenants)[number]["settings"] | null;
}

export async function catalogBranchExists(tenantId: string, branchId: string) {
  if (useDemoStore) {
    return branches.some((branch) => branch.tenantId === tenantId && branch.id === branchId);
  }

  const branch = await prisma.branch.findFirst({
    where: { tenantId, id: branchId },
    select: { id: true }
  });

  return Boolean(branch);
}

export async function createCatalogProductRecord(tenantId: string, input: ProductInput) {
  if (useDemoStore) {
    const tenant = demoTenants.find((item) => item.id === tenantId);
    const product = {
      id: nextProductId(),
      tenantId,
      ...input,
      taxRate: input.taxRate ?? tenant?.settings.defaultTaxRate ?? 0
    };
    demoProducts.push(product);
    return product;
  }

  const product = await prisma.product.create({
    data: {
      id: `p${Date.now()}`,
      tenantId,
      branchId: input.branchId,
      name: input.name,
      sku: input.sku,
      barcode: input.barcode,
      category: input.category,
      price: input.price,
      cost: input.cost,
      taxRate: input.taxRate ?? 0,
      image: input.image,
      stock: input.stock,
      reorderPoint: input.reorderPoint,
      station: input.station,
      modifiers: input.modifiers
    }
  });

  return toApiProduct(product);
}

export async function updateCatalogProductRecord(tenantId: string, productId: string, input: Partial<ProductInput>) {
  if (useDemoStore) {
    const productIndex = demoProducts.findIndex((product) => product.tenantId === tenantId && product.id === productId);

    if (productIndex === -1) {
      return null;
    }

    const product = {
      ...demoProducts[productIndex],
      ...input
    };

    demoProducts[productIndex] = product;
    return product;
  }

  const existing = await prisma.product.findFirst({
    where: { tenantId, id: productId }
  });

  if (!existing) {
    return null;
  }

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      branchId: input.branchId,
      name: input.name,
      sku: input.sku,
      barcode: input.barcode,
      category: input.category,
      price: input.price,
      cost: input.cost,
      taxRate: input.taxRate,
      image: input.image,
      stock: input.stock,
      reorderPoint: input.reorderPoint,
      station: input.station,
      modifiers: input.modifiers
    }
  });

  return toApiProduct(product);
}

export async function catalogSkuExists(tenantId: string, sku: string, exceptProductId?: string) {
  if (useDemoStore) {
    return demoProducts.some((product) => product.tenantId === tenantId && product.sku === sku && product.id !== exceptProductId);
  }

  const product = await prisma.product.findFirst({
    where: {
      tenantId,
      sku,
      NOT: exceptProductId ? { id: exceptProductId } : undefined
    }
  });

  return Boolean(product);
}

export async function catalogBarcodeExists(tenantId: string, barcode: string, exceptProductId?: string) {
  if (useDemoStore) {
    return demoProducts.some((product) => product.tenantId === tenantId && product.barcode === barcode && product.id !== exceptProductId);
  }

  const product = await prisma.product.findFirst({
    where: {
      tenantId,
      barcode,
      NOT: exceptProductId ? { id: exceptProductId } : undefined
    }
  });

  return Boolean(product);
}

export async function appendCatalogAudit(event: Parameters<typeof appendAudit>[0]) {
  if (useDemoStore) {
    appendAudit(event);
    return;
  }

  await prisma.auditEvent.create({
    data: {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: event.tenantId,
      branchId: event.branchId,
      userId: event.userId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata as Prisma.InputJsonValue
    }
  });
}

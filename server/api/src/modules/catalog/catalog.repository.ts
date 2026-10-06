import type { Prisma, Product as DbProduct } from "@prisma/client";
import { appendAudit, branches, demoProducts, demoTenants, type DemoProduct } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";

export type ProductInput = Omit<DemoProduct, "id" | "tenantId" | "taxRate"> & { taxRate?: number };
type BranchScopeFilter = { branchId?: string; branchIds?: string[] };

const useDemoStore = process.env.NODE_ENV === "test";

function matchesBranchScope(scope: BranchScopeFilter, branchId: string) {
  if (scope.branchId) return branchId === scope.branchId;
  if (scope.branchIds?.length) return scope.branchIds.includes(branchId);
  return true;
}

function branchWhere(scope: BranchScopeFilter) {
  if (scope.branchId) return scope.branchId;
  if (scope.branchIds?.length) return { in: scope.branchIds };
  return undefined;
}

function isServiceCategory(category: string) {
  return category.trim().toLowerCase() === "services";
}

function normalizeProductInput<T extends Partial<ProductInput>>(input: T): T {
  if (!input.category || !isServiceCategory(input.category)) {
    return input;
  }

  return {
    ...input,
    stock: 0,
    reorderPoint: 0
  };
}

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

export async function listCatalogProducts(tenantId: string, scope: BranchScopeFilter = {}) {
  if (useDemoStore) {
    return demoProducts.filter((product) => product.tenantId === tenantId && matchesBranchScope(scope, product.branchId));
  }

  const products = await prisma.product.findMany({
    where: { tenantId, branchId: branchWhere(scope) },
    orderBy: { name: "asc" }
  });

  return products.map(toApiProduct);
}

export async function getCatalogProductRecord(tenantId: string, productId: string) {
  if (useDemoStore) {
    return demoProducts.find((product) => product.tenantId === tenantId && product.id === productId) ?? null;
  }

  const product = await prisma.product.findFirst({
    where: { tenantId, id: productId }
  });

  return product ? toApiProduct(product) : null;
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
  const normalizedInput = normalizeProductInput(input);

  if (useDemoStore) {
    const tenant = demoTenants.find((item) => item.id === tenantId);
    const product = {
      id: nextProductId(),
      tenantId,
      ...normalizedInput,
      taxRate: normalizedInput.taxRate ?? tenant?.settings.defaultTaxRate ?? 0
    };
    demoProducts.push(product);
    return product;
  }

  const product = await prisma.product.create({
    data: {
      id: `p${Date.now()}`,
      tenantId,
      branchId: normalizedInput.branchId,
      name: normalizedInput.name,
      sku: normalizedInput.sku,
      barcode: normalizedInput.barcode,
      category: normalizedInput.category,
      price: normalizedInput.price,
      cost: normalizedInput.cost,
      taxRate: normalizedInput.taxRate ?? 0,
      image: normalizedInput.image,
      stock: normalizedInput.stock,
      reorderPoint: normalizedInput.reorderPoint,
      station: normalizedInput.station,
      modifiers: normalizedInput.modifiers
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

    const normalizedInput = normalizeProductInput({
      ...input,
      category: input.category ?? demoProducts[productIndex].category
    });

    const product = {
      ...demoProducts[productIndex],
      ...normalizedInput
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

  const normalizedInput = normalizeProductInput({
    ...input,
    category: input.category ?? existing.category
  });

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      branchId: normalizedInput.branchId,
      name: normalizedInput.name,
      sku: normalizedInput.sku,
      barcode: normalizedInput.barcode,
      category: normalizedInput.category,
      price: normalizedInput.price,
      cost: normalizedInput.cost,
      taxRate: normalizedInput.taxRate,
      image: normalizedInput.image,
      stock: normalizedInput.stock,
      reorderPoint: normalizedInput.reorderPoint,
      station: normalizedInput.station,
      modifiers: normalizedInput.modifiers
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

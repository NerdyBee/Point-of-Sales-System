import type { Prisma, Product as DbProduct, StockMovement as DbStockMovement, Supplier as DbSupplier } from "@prisma/client";
import {
  appendAudit,
  appendStockMovement,
  branches,
  demoProducts,
  stockMovements,
  suppliers,
  type DemoProduct,
  type StockMovement,
  type Supplier
} from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";

const useDemoStore = process.env.NODE_ENV === "test";

type SupplierInput = Omit<Supplier, "id" | "tenantId" | "createdAt">;
type StockAdjustmentInput = {
  productId: string;
  branchId: string;
  type: StockMovement["type"];
  quantityDelta: number;
  reason: string;
  reference?: string;
};
type StockCountInput = {
  branchId: string;
  reference: string;
  reason: string;
  counts: Array<{ productId: string; countedQuantity: number }>;
};

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

function toApiMovement(movement: DbStockMovement): StockMovement {
  return {
    id: movement.id,
    tenantId: movement.tenantId,
    branchId: movement.branchId,
    productId: movement.productId,
    productName: movement.productName,
    supplierId: movement.supplierId ?? undefined,
    supplierName: movement.supplierName ?? undefined,
    type: movement.type as StockMovement["type"],
    quantityDelta: movement.quantityDelta,
    balanceAfter: movement.balanceAfter,
    reason: movement.reason,
    reference: movement.reference ?? undefined,
    createdAt: movement.createdAt.toISOString(),
    createdBy: movement.createdBy
  };
}

function toApiSupplier(supplier: DbSupplier & { products?: Array<{ productId: string }> }): Supplier {
  return {
    id: supplier.id,
    tenantId: supplier.tenantId,
    branchId: supplier.branchId,
    name: supplier.name,
    contactPerson: supplier.contactPerson,
    phone: supplier.phone,
    email: supplier.email ?? undefined,
    leadTimeDays: supplier.leadTimeDays,
    active: supplier.active,
    productIds: supplier.products?.map((product) => product.productId) ?? [],
    createdAt: supplier.createdAt.toISOString()
  };
}

function nextStockMovementId() {
  return `move-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextSupplierId() {
  return `sup-${Date.now()}`;
}

async function branchBelongsToTenant(tenantId: string, branchId: string) {
  if (useDemoStore) {
    return branches.some((branch) => branch.tenantId === tenantId && branch.id === branchId);
  }

  const branch = await prisma.branch.findFirst({
    where: { tenantId, id: branchId },
    select: { id: true }
  });

  return Boolean(branch);
}

export async function listInventoryStock(tenantId: string, branchId?: string) {
  if (useDemoStore) {
    return {
      products: demoProducts.filter((product) => product.tenantId === tenantId && (!branchId || product.branchId === branchId)),
      movements: stockMovements.filter((movement) => movement.tenantId === tenantId && (!branchId || movement.branchId === branchId)).slice(0, 20)
    };
  }

  const [products, movements] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, branchId: branchId ? branchId : undefined },
      orderBy: { name: "asc" }
    }),
    prisma.stockMovement.findMany({
      where: { tenantId, branchId: branchId ? branchId : undefined },
      orderBy: { createdAt: "desc" },
      take: 20
    })
  ]);

  return {
    products: products.map(toApiProduct),
    movements: movements.map(toApiMovement)
  };
}

export async function listInventorySuppliers(tenantId: string, branchId?: string) {
  if (useDemoStore) {
    return suppliers.filter((supplier) => supplier.tenantId === tenantId && (!branchId || supplier.branchId === branchId));
  }

  const supplierRecords = await prisma.supplier.findMany({
    where: { tenantId, branchId: branchId ? branchId : undefined },
    include: { products: true },
    orderBy: { name: "asc" }
  });

  return supplierRecords.map(toApiSupplier);
}

export async function createInventorySupplier(tenantId: string, input: SupplierInput) {
  if (!(await branchBelongsToTenant(tenantId, input.branchId))) {
    return { status: "branch_not_found" as const };
  }

  if (useDemoStore) {
    const supplierProducts = input.productIds.map((productId) =>
      demoProducts.find((product) => product.tenantId === tenantId && product.branchId === input.branchId && product.id === productId)
    );

    if (supplierProducts.some((product) => !product)) {
      return { status: "missing_products" as const };
    }

    const supplier = {
      id: `sup-${suppliers.length + 1}`,
      tenantId,
      ...input,
      createdAt: new Date().toISOString()
    };

    suppliers.unshift(supplier);
    return { status: "created" as const, supplier };
  }

  const productCount = await prisma.product.count({
    where: {
      tenantId,
      branchId: input.branchId,
      id: { in: input.productIds }
    }
  });

  if (productCount !== input.productIds.length) {
    return { status: "missing_products" as const };
  }

  const supplier = await prisma.supplier.create({
    data: {
      id: nextSupplierId(),
      tenantId,
      branchId: input.branchId,
      name: input.name,
      contactPerson: input.contactPerson,
      phone: input.phone,
      email: input.email || undefined,
      leadTimeDays: input.leadTimeDays,
      active: input.active,
      products: {
        createMany: {
          data: input.productIds.map((productId) => ({ productId }))
        }
      }
    },
    include: { products: true }
  });

  return { status: "created" as const, supplier: toApiSupplier(supplier) };
}

export async function receiveSupplierPurchase(
  tenantId: string,
  userId: string,
  input: { supplierId: string; branchId: string; productId: string; quantity: number; reference: string; note: string }
) {
  if (!(await branchBelongsToTenant(tenantId, input.branchId))) {
    return { status: "branch_not_found" as const };
  }

  if (useDemoStore) {
    const supplier = suppliers.find(
      (item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === input.supplierId && item.active
    );

    if (!supplier) return { status: "supplier_not_found" as const };
    if (!supplier.productIds.includes(input.productId)) return { status: "supplier_product_mismatch" as const };

    const product = demoProducts.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === input.productId);

    if (!product) return { status: "product_not_found" as const };

    const balanceAfter = product.stock + input.quantity;
    product.stock = balanceAfter;

    const movement = appendStockMovement({
      tenantId,
      branchId: input.branchId,
      productId: product.id,
      productName: product.name,
      supplierId: supplier.id,
      supplierName: supplier.name,
      type: "receipt",
      quantityDelta: input.quantity,
      balanceAfter,
      reason: input.note,
      reference: input.reference,
      createdBy: userId
    });

    return { status: "received" as const, product, movement, supplier };
  }

  const supplier = await prisma.supplier.findFirst({
    where: { tenantId, branchId: input.branchId, id: input.supplierId, active: true },
    include: { products: true }
  });

  if (!supplier) return { status: "supplier_not_found" as const };
  if (!supplier.products.some((product) => product.productId === input.productId)) return { status: "supplier_product_mismatch" as const };

  const result = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { tenantId, branchId: input.branchId, id: input.productId }
    });

    if (!product) return { status: "product_not_found" as const };

    const balanceAfter = product.stock + input.quantity;
    const updatedProduct = await tx.product.update({
      where: { id: product.id },
      data: { stock: balanceAfter }
    });
    const movement = await tx.stockMovement.create({
      data: {
        id: nextStockMovementId(),
        tenantId,
        branchId: input.branchId,
        productId: product.id,
        productName: product.name,
        supplierId: supplier.id,
        supplierName: supplier.name,
        type: "receipt",
        quantityDelta: input.quantity,
        balanceAfter,
        reason: input.note,
        reference: input.reference,
        createdBy: userId
      }
    });

    return { status: "received" as const, product: toApiProduct(updatedProduct), movement: toApiMovement(movement), supplier: toApiSupplier(supplier) };
  });

  return result;
}

export async function applyInventoryAdjustment(tenantId: string, userId: string, input: StockAdjustmentInput) {
  if (!(await branchBelongsToTenant(tenantId, input.branchId))) {
    return { status: "branch_not_found" as const };
  }

  if (useDemoStore) {
    const product = demoProducts.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === input.productId);

    if (!product) return { status: "product_not_found" as const };

    const balanceAfter = product.stock + input.quantityDelta;

    if (balanceAfter < 0) return { status: "negative_stock" as const };

    product.stock = balanceAfter;

    const movement = appendStockMovement({
      tenantId,
      branchId: input.branchId,
      productId: product.id,
      productName: product.name,
      type: input.type,
      quantityDelta: input.quantityDelta,
      balanceAfter,
      reason: input.reason,
      reference: input.reference,
      createdBy: userId
    });

    return { status: "adjusted" as const, product, movement };
  }

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findFirst({
      where: { tenantId, branchId: input.branchId, id: input.productId }
    });

    if (!product) return { status: "product_not_found" as const };

    const balanceAfter = product.stock + input.quantityDelta;

    if (balanceAfter < 0) return { status: "negative_stock" as const };

    const updatedProduct = await tx.product.update({
      where: { id: product.id },
      data: { stock: balanceAfter }
    });
    const movement = await tx.stockMovement.create({
      data: {
        id: nextStockMovementId(),
        tenantId,
        branchId: input.branchId,
        productId: product.id,
        productName: product.name,
        type: input.type,
        quantityDelta: input.quantityDelta,
        balanceAfter,
        reason: input.reason,
        reference: input.reference,
        createdBy: userId
      }
    });

    return { status: "adjusted" as const, product: toApiProduct(updatedProduct), movement: toApiMovement(movement) };
  });
}

export async function postInventoryCount(tenantId: string, userId: string, input: StockCountInput) {
  if (!(await branchBelongsToTenant(tenantId, input.branchId))) {
    return { status: "branch_not_found" as const };
  }

  if (useDemoStore) {
    const movements = [];
    const products = [];

    for (const count of input.counts) {
      const product = demoProducts.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === count.productId);

      if (!product) return { status: "product_not_found" as const, productId: count.productId };

      const quantityDelta = count.countedQuantity - product.stock;
      product.stock = count.countedQuantity;
      products.push(product);

      if (quantityDelta !== 0) {
        movements.push(
          appendStockMovement({
            tenantId,
            branchId: input.branchId,
            productId: product.id,
            productName: product.name,
            type: "count",
            quantityDelta,
            balanceAfter: product.stock,
            reason: input.reason,
            reference: input.reference,
            createdBy: userId
          })
        );
      }
    }

    return { status: "counted" as const, products, movements };
  }

  return prisma.$transaction(async (tx) => {
    const products = [];
    const movements = [];

    for (const count of input.counts) {
      const product = await tx.product.findFirst({
        where: { tenantId, branchId: input.branchId, id: count.productId }
      });

      if (!product) return { status: "product_not_found" as const, productId: count.productId };

      const quantityDelta = count.countedQuantity - product.stock;
      const updatedProduct = await tx.product.update({
        where: { id: product.id },
        data: { stock: count.countedQuantity }
      });
      products.push(toApiProduct(updatedProduct));

      if (quantityDelta !== 0) {
        const movement = await tx.stockMovement.create({
          data: {
            id: nextStockMovementId(),
            tenantId,
            branchId: input.branchId,
            productId: product.id,
            productName: product.name,
            type: "count",
            quantityDelta,
            balanceAfter: count.countedQuantity,
            reason: input.reason,
            reference: input.reference,
            createdBy: userId
          }
        });
        movements.push(toApiMovement(movement));
      }
    }

    return { status: "counted" as const, products, movements };
  });
}

export async function appendInventoryAudit(event: Parameters<typeof appendAudit>[0]) {
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

import type { InventoryTransfer as DbInventoryTransfer, Prisma, Product as DbProduct, PurchaseOrder as DbPurchaseOrder, StockMovement as DbStockMovement, Supplier as DbSupplier, SupplierInvoice as DbSupplierInvoice, SupplierReturn as DbSupplierReturn } from "@prisma/client";
import {
  appendAudit,
  appendStockMovement,
  branches,
  demoProducts,
  inventoryTransfers,
  purchaseOrders,
  supplierInvoices,
  supplierReturns,
  stockMovements,
  suppliers,
  type DemoProduct,
  type InventoryTransfer,
  type PurchaseOrder,
  type PurchaseOrderLine,
  type SupplierInvoice,
  type SupplierInvoiceCredit,
  type SupplierInvoicePayment,
  type SupplierReturn,
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
type StockTransferInput = {
  sourceBranchId: string;
  destinationBranchId: string;
  sourceProductId: string;
  destinationProductId: string;
  quantity: number;
  reference: string;
  note: string;
};
type PurchaseOrderInput = {
  branchId: string;
  supplierId: string;
  expectedAt?: string;
  note?: string;
  lines: Array<{ productId: string; quantity: number; unitCost?: number }>;
};
type SupplierInvoiceInput = {
  branchId: string;
  supplierId: string;
  purchaseOrderId?: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  amount: number;
  note?: string;
};
type SupplierInvoicePaymentInput = {
  amount: number;
  paymentMethod: SupplierInvoicePayment["paymentMethod"];
  reference: string;
  paidAt: string;
  note?: string;
};
type SupplierReturnInput = {
  branchId: string;
  supplierId: string;
  productId: string;
  supplierInvoiceId?: string;
  quantity: number;
  unitCost?: number;
  reference: string;
  reason: string;
  returnedAt: string;
};
type SupplierStatementEntry = {
  id: string;
  date: string;
  type: "invoice" | "payment" | "credit";
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
};

function isServiceProduct(product: { category: string }) {
  return product.category.trim().toLowerCase() === "services";
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

function toApiPurchaseOrder(order: DbPurchaseOrder): PurchaseOrder {
  return {
    id: order.id,
    tenantId: order.tenantId,
    branchId: order.branchId,
    supplierId: order.supplierId,
    supplierName: order.supplierName,
    orderNumber: order.orderNumber,
    status: order.status as PurchaseOrder["status"],
    expectedAt: order.expectedAt?.toISOString(),
    lines: Array.isArray(order.lines) ? (order.lines as unknown as PurchaseOrderLine[]) : [],
    subtotal: order.subtotal,
    note: order.note ?? undefined,
    createdBy: order.createdBy,
    approvedBy: order.approvedBy ?? undefined,
    approvedAt: order.approvedAt?.toISOString(),
    receivedAt: order.receivedAt?.toISOString(),
    cancelledAt: order.cancelledAt?.toISOString(),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString()
  };
}

function toApiSupplierInvoice(invoice: DbSupplierInvoice): SupplierInvoice {
  return {
    id: invoice.id,
    tenantId: invoice.tenantId,
    branchId: invoice.branchId,
    supplierId: invoice.supplierId,
    supplierName: invoice.supplierName,
    purchaseOrderId: invoice.purchaseOrderId ?? undefined,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status as SupplierInvoice["status"],
    invoiceDate: invoice.invoiceDate.toISOString(),
    dueDate: invoice.dueDate?.toISOString(),
    amount: invoice.amount,
    amountPaid: invoice.amountPaid,
    creditTotal: invoice.creditTotal,
    balanceDue: invoice.balanceDue,
    payments: Array.isArray(invoice.payments) ? (invoice.payments as unknown as SupplierInvoicePayment[]) : [],
    credits: Array.isArray(invoice.credits) ? (invoice.credits as unknown as SupplierInvoiceCredit[]) : [],
    note: invoice.note ?? undefined,
    createdBy: invoice.createdBy,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString()
  };
}

function toApiSupplierReturn(record: DbSupplierReturn): SupplierReturn {
  return {
    id: record.id,
    tenantId: record.tenantId,
    branchId: record.branchId,
    supplierId: record.supplierId,
    supplierName: record.supplierName,
    productId: record.productId,
    productName: record.productName,
    supplierInvoiceId: record.supplierInvoiceId ?? undefined,
    quantity: record.quantity,
    unitCost: record.unitCost,
    creditAmount: record.creditAmount,
    reference: record.reference,
    reason: record.reason,
    returnedAt: record.returnedAt.toISOString(),
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString()
  };
}

function toApiInventoryTransfer(record: DbInventoryTransfer): InventoryTransfer {
  return {
    id: record.id,
    tenantId: record.tenantId,
    sourceBranchId: record.sourceBranchId,
    destinationBranchId: record.destinationBranchId,
    sourceProductId: record.sourceProductId,
    destinationProductId: record.destinationProductId,
    productName: record.productName,
    quantity: record.quantity,
    reference: record.reference,
    note: record.note,
    sourceMovementId: record.sourceMovementId,
    destinationMovementId: record.destinationMovementId,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString()
  };
}

function nextStockMovementId() {
  return `move-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextSupplierId() {
  return `sup-${Date.now()}`;
}

function nextPurchaseOrderId() {
  return `po-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextPurchaseOrderNumber() {
  return `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function nextSupplierInvoiceId() {
  return `sinv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextSupplierPaymentId() {
  return `spay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextSupplierReturnId() {
  return `sret-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextSupplierCreditId() {
  return `scred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextInventoryTransferId() {
  return `trf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

export async function getSupplierStatement(tenantId: string, branchId: string | undefined, supplierId: string) {
  if (useDemoStore) {
    const supplier = suppliers.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === supplierId);
    if (!supplier) return { status: "supplier_not_found" as const };
    const supplierInvoiceRows = supplierInvoices.filter((invoice) => invoice.tenantId === tenantId && invoice.supplierId === supplierId && (!branchId || invoice.branchId === branchId));
    const entries = supplierInvoiceRows.flatMap((invoice) => [
      {
        id: invoice.id,
        date: invoice.invoiceDate,
        type: "invoice" as const,
        reference: invoice.invoiceNumber,
        description: `Supplier invoice ${invoice.invoiceNumber}`,
        debit: invoice.amount,
        credit: 0
      },
      ...invoice.payments.map((payment) => ({
        id: payment.id,
        date: payment.paidAt,
        type: "payment" as const,
        reference: payment.reference,
        description: `Payment for ${invoice.invoiceNumber}`,
        debit: 0,
        credit: payment.amount
      })),
      ...invoice.credits.map((credit) => ({
        id: credit.id,
        date: credit.creditedAt,
        type: "credit" as const,
        reference: credit.reference,
        description: `Return credit for ${invoice.invoiceNumber}`,
        debit: 0,
        credit: credit.amount
      }))
    ]);
    let balance = 0;
    const statementEntries: SupplierStatementEntry[] = entries
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
      .map((entry) => {
        balance += entry.debit - entry.credit;
        return { ...entry, balance };
      });
    const totals = {
      invoiced: supplierInvoiceRows.reduce((sum, invoice) => sum + invoice.amount, 0),
      paid: supplierInvoiceRows.reduce((sum, invoice) => sum + invoice.amountPaid, 0),
      credited: supplierInvoiceRows.reduce((sum, invoice) => sum + invoice.creditTotal, 0),
      balanceDue: supplierInvoiceRows.reduce((sum, invoice) => sum + invoice.balanceDue, 0)
    };
    return { status: "found" as const, statement: { supplier, totals, entries: statementEntries } };
  }

  const supplier = await prisma.supplier.findFirst({
    where: { tenantId, id: supplierId, branchId: branchId ? branchId : undefined },
    include: { products: true }
  });
  if (!supplier) return { status: "supplier_not_found" as const };
  const supplierInvoiceRows = (await prisma.supplierInvoice.findMany({
    where: { tenantId, supplierId, branchId: branchId ? branchId : undefined },
    orderBy: { invoiceDate: "asc" }
  })).map(toApiSupplierInvoice);
  const entries = supplierInvoiceRows.flatMap((invoice) => [
    {
      id: invoice.id,
      date: invoice.invoiceDate,
      type: "invoice" as const,
      reference: invoice.invoiceNumber,
      description: `Supplier invoice ${invoice.invoiceNumber}`,
      debit: invoice.amount,
      credit: 0
    },
    ...invoice.payments.map((payment) => ({
      id: payment.id,
      date: payment.paidAt,
      type: "payment" as const,
      reference: payment.reference,
      description: `Payment for ${invoice.invoiceNumber}`,
      debit: 0,
      credit: payment.amount
    })),
    ...invoice.credits.map((credit) => ({
      id: credit.id,
      date: credit.creditedAt,
      type: "credit" as const,
      reference: credit.reference,
      description: `Return credit for ${invoice.invoiceNumber}`,
      debit: 0,
      credit: credit.amount
    }))
  ]);
  let balance = 0;
  const statementEntries: SupplierStatementEntry[] = entries
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
    .map((entry) => {
      balance += entry.debit - entry.credit;
      return { ...entry, balance };
    });
  const totals = {
    invoiced: supplierInvoiceRows.reduce((sum, invoice) => sum + invoice.amount, 0),
    paid: supplierInvoiceRows.reduce((sum, invoice) => sum + invoice.amountPaid, 0),
    credited: supplierInvoiceRows.reduce((sum, invoice) => sum + invoice.creditTotal, 0),
    balanceDue: supplierInvoiceRows.reduce((sum, invoice) => sum + invoice.balanceDue, 0)
  };
  return { status: "found" as const, statement: { supplier: toApiSupplier(supplier), totals, entries: statementEntries } };
}

export async function listPurchaseOrders(tenantId: string, filters: { branchId?: string; status?: string }) {
  if (useDemoStore) {
    return purchaseOrders.filter((order) => {
      const branchMatch = filters.branchId ? order.branchId === filters.branchId : true;
      const statusMatch = filters.status && filters.status !== "all" ? order.status === filters.status : true;
      return order.tenantId === tenantId && branchMatch && statusMatch;
    });
  }

  const orders = await prisma.purchaseOrder.findMany({
    where: {
      tenantId,
      branchId: filters.branchId ? filters.branchId : undefined,
      status: filters.status && filters.status !== "all" ? filters.status : undefined
    },
    orderBy: { createdAt: "desc" }
  });
  return orders.map(toApiPurchaseOrder);
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

    if (supplierProducts.some((product) => product && isServiceProduct(product))) {
      return { status: "non_stock_product" as const };
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

  const linkedProducts = await prisma.product.findMany({
    where: {
      tenantId,
      branchId: input.branchId,
      id: { in: input.productIds }
    },
    select: { id: true, category: true }
  });

  if (linkedProducts.length !== input.productIds.length) {
    return { status: "missing_products" as const };
  }

  if (linkedProducts.some(isServiceProduct)) {
    return { status: "non_stock_product" as const };
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

export async function createPurchaseOrder(tenantId: string, userId: string, input: PurchaseOrderInput) {
  if (!(await branchBelongsToTenant(tenantId, input.branchId))) {
    return { status: "branch_not_found" as const };
  }

  if (useDemoStore) {
    const supplier = suppliers.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === input.supplierId && item.active);
    if (!supplier) return { status: "supplier_not_found" as const };

    const lines: PurchaseOrderLine[] = [];
    for (const line of input.lines) {
      if (!supplier.productIds.includes(line.productId)) return { status: "supplier_product_mismatch" as const, productId: line.productId };
      const product = demoProducts.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === line.productId);
      if (!product) return { status: "product_not_found" as const, productId: line.productId };
      if (isServiceProduct(product)) return { status: "non_stock_product" as const, productId: line.productId };
      const unitCost = line.unitCost ?? product.cost;
      lines.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: line.quantity,
        receivedQuantity: 0,
        unitCost,
        total: unitCost * line.quantity
      });
    }

    const now = new Date().toISOString();
    const order: PurchaseOrder = {
      id: nextPurchaseOrderId(),
      tenantId,
      branchId: input.branchId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      orderNumber: nextPurchaseOrderNumber(),
      status: "draft",
      expectedAt: input.expectedAt || undefined,
      lines,
      subtotal: lines.reduce((sum, line) => sum + line.total, 0),
      note: input.note || undefined,
      createdBy: userId,
      createdAt: now,
      updatedAt: now
    };
    purchaseOrders.unshift(order);
    appendAudit({
      tenantId,
      branchId: order.branchId,
      userId,
      action: "purchase_order.created",
      entityType: "purchaseOrder",
      entityId: order.id,
      metadata: { orderNumber: order.orderNumber, supplierId: order.supplierId, lineCount: order.lines.length, subtotal: order.subtotal }
    });
    return { status: "created" as const, order };
  }

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { tenantId, branchId: input.branchId, id: input.supplierId, active: true }, include: { products: true } });
    if (!supplier) return { status: "supplier_not_found" as const };

    const lines: PurchaseOrderLine[] = [];
    for (const line of input.lines) {
      if (!supplier.products.some((item) => item.productId === line.productId)) return { status: "supplier_product_mismatch" as const, productId: line.productId };
      const product = await tx.product.findFirst({ where: { tenantId, branchId: input.branchId, id: line.productId } });
      if (!product) return { status: "product_not_found" as const, productId: line.productId };
      if (isServiceProduct(product)) return { status: "non_stock_product" as const, productId: line.productId };
      const unitCost = line.unitCost ?? product.cost;
      lines.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: line.quantity,
        receivedQuantity: 0,
        unitCost,
        total: unitCost * line.quantity
      });
    }

    const order = await tx.purchaseOrder.create({
      data: {
        id: nextPurchaseOrderId(),
        tenantId,
        branchId: input.branchId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        orderNumber: nextPurchaseOrderNumber(),
        status: "draft",
        expectedAt: input.expectedAt ? new Date(input.expectedAt) : undefined,
        lines: lines as unknown as Prisma.InputJsonValue,
        subtotal: lines.reduce((sum, line) => sum + line.total, 0),
        note: input.note || undefined,
        createdBy: userId
      }
    });
    await tx.auditEvent.create({
      data: {
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tenantId,
        branchId: order.branchId,
        userId,
        action: "purchase_order.created",
        entityType: "purchaseOrder",
        entityId: order.id,
        metadata: { orderNumber: order.orderNumber, supplierId: order.supplierId, lineCount: lines.length, subtotal: order.subtotal }
      }
    });
    return { status: "created" as const, order: toApiPurchaseOrder(order) };
  });
}

export async function updatePurchaseOrderStatus(tenantId: string, branchId: string | undefined, userId: string, orderId: string, input: { status: "pending_approval" | "approved" | "cancelled"; note?: string }) {
  if (useDemoStore) {
    const order = purchaseOrders.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === orderId);
    if (!order) return { status: "order_not_found" as const };
    if (["received", "partially_received", "cancelled"].includes(order.status)) return { status: "locked" as const };
    const previousStatus = order.status;
    order.status = input.status;
    order.updatedAt = new Date().toISOString();
    if (input.status === "approved") {
      order.approvedBy = userId;
      order.approvedAt = order.updatedAt;
    }
    if (input.status === "cancelled") order.cancelledAt = order.updatedAt;
    if (input.note) order.note = [order.note, input.note].filter(Boolean).join(" | ");
    appendAudit({ tenantId, branchId: order.branchId, userId, action: "purchase_order.status_changed", entityType: "purchaseOrder", entityId: order.id, metadata: { previousStatus, status: order.status, note: input.note } });
    return { status: "updated" as const, order };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: orderId } });
    if (!existing) return { status: "order_not_found" as const };
    if (["received", "partially_received", "cancelled"].includes(existing.status)) return { status: "locked" as const };
    const updatedAt = new Date();
    const order = await tx.purchaseOrder.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        note: input.note ? [existing.note, input.note].filter(Boolean).join(" | ") : existing.note,
        approvedBy: input.status === "approved" ? userId : existing.approvedBy,
        approvedAt: input.status === "approved" ? updatedAt : existing.approvedAt,
        cancelledAt: input.status === "cancelled" ? updatedAt : existing.cancelledAt
      }
    });
    await tx.auditEvent.create({
      data: {
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tenantId,
        branchId: order.branchId,
        userId,
        action: "purchase_order.status_changed",
        entityType: "purchaseOrder",
        entityId: order.id,
        metadata: { previousStatus: existing.status, status: order.status, note: input.note }
      }
    });
    return { status: "updated" as const, order: toApiPurchaseOrder(order) };
  });
}

export async function listSupplierInvoices(tenantId: string, filters: { branchId?: string; supplierId?: string; status?: string }) {
  if (useDemoStore) {
    return supplierInvoices.filter((invoice) => {
      const branchMatch = filters.branchId ? invoice.branchId === filters.branchId : true;
      const supplierMatch = filters.supplierId ? invoice.supplierId === filters.supplierId : true;
      const statusMatch = filters.status && filters.status !== "all" ? invoice.status === filters.status : true;
      return invoice.tenantId === tenantId && branchMatch && supplierMatch && statusMatch;
    });
  }

  const records = await prisma.supplierInvoice.findMany({
    where: {
      tenantId,
      branchId: filters.branchId ? filters.branchId : undefined,
      supplierId: filters.supplierId ? filters.supplierId : undefined,
      status: filters.status && filters.status !== "all" ? filters.status : undefined
    },
    orderBy: { invoiceDate: "desc" }
  });

  return records.map(toApiSupplierInvoice);
}

export async function createSupplierInvoice(tenantId: string, userId: string, input: SupplierInvoiceInput) {
  if (!(await branchBelongsToTenant(tenantId, input.branchId))) {
    return { status: "branch_not_found" as const };
  }

  if (useDemoStore) {
    const supplier = suppliers.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === input.supplierId && item.active);
    if (!supplier) return { status: "supplier_not_found" as const };
    const duplicate = supplierInvoices.some((invoice) => invoice.tenantId === tenantId && invoice.supplierId === input.supplierId && invoice.invoiceNumber === input.invoiceNumber);
    if (duplicate) return { status: "duplicate_invoice" as const };
    if (input.purchaseOrderId) {
      const order = purchaseOrders.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.supplierId === input.supplierId && item.id === input.purchaseOrderId);
      if (!order) return { status: "purchase_order_not_found" as const };
    }

    const now = new Date().toISOString();
    const invoice: SupplierInvoice = {
      id: nextSupplierInvoiceId(),
      tenantId,
      branchId: input.branchId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      purchaseOrderId: input.purchaseOrderId || undefined,
      invoiceNumber: input.invoiceNumber,
      status: "open",
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate || undefined,
      amount: input.amount,
      amountPaid: 0,
      creditTotal: 0,
      balanceDue: input.amount,
      payments: [],
      credits: [],
      note: input.note || undefined,
      createdBy: userId,
      createdAt: now,
      updatedAt: now
    };
    supplierInvoices.unshift(invoice);
    appendAudit({
      tenantId,
      branchId: invoice.branchId,
      userId,
      action: "supplier_invoice.created",
      entityType: "supplierInvoice",
      entityId: invoice.id,
      metadata: { supplierId: invoice.supplierId, invoiceNumber: invoice.invoiceNumber, amount: invoice.amount }
    });
    return { status: "created" as const, invoice };
  }

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { tenantId, branchId: input.branchId, id: input.supplierId, active: true } });
    if (!supplier) return { status: "supplier_not_found" as const };
    const duplicate = await tx.supplierInvoice.findFirst({ where: { tenantId, supplierId: input.supplierId, invoiceNumber: input.invoiceNumber } });
    if (duplicate) return { status: "duplicate_invoice" as const };
    if (input.purchaseOrderId) {
      const order = await tx.purchaseOrder.findFirst({ where: { tenantId, branchId: input.branchId, supplierId: input.supplierId, id: input.purchaseOrderId } });
      if (!order) return { status: "purchase_order_not_found" as const };
    }

    const invoice = await tx.supplierInvoice.create({
      data: {
        id: nextSupplierInvoiceId(),
        tenantId,
        branchId: input.branchId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        purchaseOrderId: input.purchaseOrderId || null,
        invoiceNumber: input.invoiceNumber,
        status: "open",
        invoiceDate: new Date(input.invoiceDate),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        amount: input.amount,
        amountPaid: 0,
        creditTotal: 0,
        balanceDue: input.amount,
        payments: [] as unknown as Prisma.InputJsonValue,
        credits: [] as unknown as Prisma.InputJsonValue,
        note: input.note || null,
        createdBy: userId
      }
    });
    await tx.auditEvent.create({
      data: {
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tenantId,
        branchId: invoice.branchId,
        userId,
        action: "supplier_invoice.created",
        entityType: "supplierInvoice",
        entityId: invoice.id,
        metadata: { supplierId: invoice.supplierId, invoiceNumber: invoice.invoiceNumber, amount: invoice.amount }
      }
    });
    return { status: "created" as const, invoice: toApiSupplierInvoice(invoice) };
  });
}

export async function recordSupplierInvoicePayment(tenantId: string, branchId: string | undefined, userId: string, invoiceId: string, input: SupplierInvoicePaymentInput) {
  if (useDemoStore) {
    const invoice = supplierInvoices.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === invoiceId);
    if (!invoice) return { status: "invoice_not_found" as const };
    if (invoice.status === "paid" || invoice.status === "voided") return { status: "locked" as const };
    if (input.amount > invoice.balanceDue) return { status: "overpayment" as const };
    const payment: SupplierInvoicePayment = { id: nextSupplierPaymentId(), ...input, createdBy: userId };
    invoice.payments.unshift(payment);
    invoice.amountPaid += input.amount;
    invoice.balanceDue = invoice.amount - invoice.amountPaid;
    invoice.status = invoice.balanceDue === 0 ? "paid" : "partially_paid";
    invoice.updatedAt = new Date().toISOString();
    appendAudit({
      tenantId,
      branchId: invoice.branchId,
      userId,
      action: "supplier_invoice.payment_recorded",
      entityType: "supplierInvoice",
      entityId: invoice.id,
      metadata: { paymentId: payment.id, amount: payment.amount, balanceDue: invoice.balanceDue }
    });
    return { status: "paid" as const, invoice, payment };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.supplierInvoice.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: invoiceId } });
    if (!existing) return { status: "invoice_not_found" as const };
    if (existing.status === "paid" || existing.status === "voided") return { status: "locked" as const };
    if (input.amount > existing.balanceDue) return { status: "overpayment" as const };
    const payment: SupplierInvoicePayment = { id: nextSupplierPaymentId(), ...input, createdBy: userId };
    const payments = Array.isArray(existing.payments) ? (existing.payments as unknown as SupplierInvoicePayment[]) : [];
    const amountPaid = existing.amountPaid + input.amount;
    const balanceDue = existing.amount - amountPaid;
    const invoice = await tx.supplierInvoice.update({
      where: { id: existing.id },
      data: {
        amountPaid,
        balanceDue,
        status: balanceDue === 0 ? "paid" : "partially_paid",
        payments: [payment, ...payments] as unknown as Prisma.InputJsonValue
      }
    });
    await tx.auditEvent.create({
      data: {
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tenantId,
        branchId: invoice.branchId,
        userId,
        action: "supplier_invoice.payment_recorded",
        entityType: "supplierInvoice",
        entityId: invoice.id,
        metadata: { paymentId: payment.id, amount: payment.amount, balanceDue: invoice.balanceDue }
      }
    });
    return { status: "paid" as const, invoice: toApiSupplierInvoice(invoice), payment };
  });
}

export async function listSupplierReturns(tenantId: string, filters: { branchId?: string; supplierId?: string }) {
  if (useDemoStore) {
    return supplierReturns.filter((item) => item.tenantId === tenantId && (!filters.branchId || item.branchId === filters.branchId) && (!filters.supplierId || item.supplierId === filters.supplierId));
  }

  const records = await prisma.supplierReturn.findMany({
    where: {
      tenantId,
      branchId: filters.branchId ? filters.branchId : undefined,
      supplierId: filters.supplierId ? filters.supplierId : undefined
    },
    orderBy: { returnedAt: "desc" }
  });
  return records.map(toApiSupplierReturn);
}

export async function createSupplierReturn(tenantId: string, userId: string, input: SupplierReturnInput) {
  if (!(await branchBelongsToTenant(tenantId, input.branchId))) {
    return { status: "branch_not_found" as const };
  }

  if (useDemoStore) {
    const supplier = suppliers.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === input.supplierId && item.active);
    if (!supplier) return { status: "supplier_not_found" as const };
    if (!supplier.productIds.includes(input.productId)) return { status: "supplier_product_mismatch" as const };
    const product = demoProducts.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === input.productId);
    if (!product) return { status: "product_not_found" as const };
    if (isServiceProduct(product)) return { status: "non_stock_product" as const, productName: product.name };
    if (product.stock < input.quantity) return { status: "insufficient_stock" as const, productName: product.name };
    const invoice = input.supplierInvoiceId ? supplierInvoices.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.supplierId === input.supplierId && item.id === input.supplierInvoiceId) : undefined;
    if (input.supplierInvoiceId && !invoice) return { status: "invoice_not_found" as const };
    const unitCost = input.unitCost ?? product.cost;
    const creditAmount = unitCost * input.quantity;
    if (invoice && creditAmount > invoice.balanceDue) return { status: "credit_exceeds_balance" as const };

    product.stock -= input.quantity;
    const now = new Date().toISOString();
    const movement = appendStockMovement({
      tenantId,
      branchId: input.branchId,
      productId: product.id,
      productName: product.name,
      supplierId: supplier.id,
      supplierName: supplier.name,
      type: "waste",
      quantityDelta: -input.quantity,
      balanceAfter: product.stock,
      reason: input.reason,
      reference: input.reference,
      createdBy: userId
    });
    const record: SupplierReturn = {
      id: nextSupplierReturnId(),
      tenantId,
      branchId: input.branchId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      productId: product.id,
      productName: product.name,
      supplierInvoiceId: input.supplierInvoiceId || undefined,
      quantity: input.quantity,
      unitCost,
      creditAmount,
      reference: input.reference,
      reason: input.reason,
      returnedAt: input.returnedAt,
      createdBy: userId,
      createdAt: now
    };
    supplierReturns.unshift(record);
    if (invoice) {
      const credit: SupplierInvoiceCredit = { id: nextSupplierCreditId(), supplierReturnId: record.id, amount: creditAmount, reference: input.reference, creditedAt: input.returnedAt, createdBy: userId };
      invoice.credits.unshift(credit);
      invoice.creditTotal += creditAmount;
      invoice.balanceDue = invoice.amount - invoice.amountPaid - invoice.creditTotal;
      invoice.status = invoice.balanceDue === 0 ? "paid" : invoice.amountPaid > 0 || invoice.creditTotal > 0 ? "partially_paid" : "open";
      invoice.updatedAt = now;
    }
    appendAudit({ tenantId, branchId: input.branchId, userId, action: "supplier_return.created", entityType: "supplierReturn", entityId: record.id, metadata: { supplierId: supplier.id, productId: product.id, quantity: input.quantity, creditAmount } });
    return { status: "created" as const, supplierReturn: record, product, movement, supplierInvoice: invoice };
  }

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { tenantId, branchId: input.branchId, id: input.supplierId, active: true }, include: { products: true } });
    if (!supplier) return { status: "supplier_not_found" as const };
    if (!supplier.products.some((item) => item.productId === input.productId)) return { status: "supplier_product_mismatch" as const };
    const product = await tx.product.findFirst({ where: { tenantId, branchId: input.branchId, id: input.productId } });
    if (!product) return { status: "product_not_found" as const };
    if (isServiceProduct(product)) return { status: "non_stock_product" as const, productName: product.name };
    if (product.stock < input.quantity) return { status: "insufficient_stock" as const, productName: product.name };
    const invoice = input.supplierInvoiceId ? await tx.supplierInvoice.findFirst({ where: { tenantId, branchId: input.branchId, supplierId: input.supplierId, id: input.supplierInvoiceId } }) : null;
    if (input.supplierInvoiceId && !invoice) return { status: "invoice_not_found" as const };
    const unitCost = input.unitCost ?? product.cost;
    const creditAmount = unitCost * input.quantity;
    if (invoice && creditAmount > invoice.balanceDue) return { status: "credit_exceeds_balance" as const };

    const updatedProduct = await tx.product.update({ where: { id: product.id }, data: { stock: product.stock - input.quantity } });
    const movement = await tx.stockMovement.create({
      data: {
        id: nextStockMovementId(),
        tenantId,
        branchId: input.branchId,
        productId: product.id,
        productName: product.name,
        supplierId: supplier.id,
        supplierName: supplier.name,
        type: "waste",
        quantityDelta: -input.quantity,
        balanceAfter: updatedProduct.stock,
        reason: input.reason,
        reference: input.reference,
        createdBy: userId
      }
    });
    const record = await tx.supplierReturn.create({
      data: {
        id: nextSupplierReturnId(),
        tenantId,
        branchId: input.branchId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        productId: product.id,
        productName: product.name,
        supplierInvoiceId: input.supplierInvoiceId || null,
        quantity: input.quantity,
        unitCost,
        creditAmount,
        reference: input.reference,
        reason: input.reason,
        returnedAt: new Date(input.returnedAt),
        createdBy: userId
      }
    });
    let updatedInvoice: SupplierInvoice | undefined;
    if (invoice) {
      const credits = Array.isArray(invoice.credits) ? (invoice.credits as unknown as SupplierInvoiceCredit[]) : [];
      const credit: SupplierInvoiceCredit = { id: nextSupplierCreditId(), supplierReturnId: record.id, amount: creditAmount, reference: input.reference, creditedAt: input.returnedAt, createdBy: userId };
      const creditTotal = invoice.creditTotal + creditAmount;
      const balanceDue = invoice.amount - invoice.amountPaid - creditTotal;
      const invoiceRecord = await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: {
          creditTotal,
          balanceDue,
          status: balanceDue === 0 ? "paid" : invoice.amountPaid > 0 || creditTotal > 0 ? "partially_paid" : "open",
          credits: [credit, ...credits] as unknown as Prisma.InputJsonValue
        }
      });
      updatedInvoice = toApiSupplierInvoice(invoiceRecord);
    }
    await tx.auditEvent.create({ data: { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tenantId, branchId: input.branchId, userId, action: "supplier_return.created", entityType: "supplierReturn", entityId: record.id, metadata: { supplierId: supplier.id, productId: product.id, quantity: input.quantity, creditAmount } } });
    return { status: "created" as const, supplierReturn: toApiSupplierReturn(record), product: toApiProduct(updatedProduct), movement: toApiMovement(movement), supplierInvoice: updatedInvoice };
  });
}

export async function receiveSupplierPurchase(
  tenantId: string,
  userId: string,
  input: { supplierId: string; branchId: string; productId: string; quantity: number; reference: string; note: string; purchaseOrderId?: string }
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
    if (isServiceProduct(product)) return { status: "non_stock_product" as const, productName: product.name };
    const purchaseOrder = input.purchaseOrderId
      ? purchaseOrders.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === input.purchaseOrderId)
      : undefined;
    if (input.purchaseOrderId && !purchaseOrder) return { status: "purchase_order_not_found" as const };
    if (purchaseOrder && !["approved", "partially_received"].includes(purchaseOrder.status)) return { status: "purchase_order_not_receivable" as const };
    const purchaseOrderLine = purchaseOrder?.lines.find((line) => line.productId === input.productId);
    if (purchaseOrder && !purchaseOrderLine) return { status: "purchase_order_line_not_found" as const };
    if (purchaseOrderLine && purchaseOrderLine.receivedQuantity + input.quantity > purchaseOrderLine.quantity) return { status: "purchase_order_over_received" as const };

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
    if (purchaseOrder && purchaseOrderLine) {
      purchaseOrderLine.receivedQuantity += input.quantity;
      const fullyReceived = purchaseOrder.lines.every((line) => line.receivedQuantity >= line.quantity);
      purchaseOrder.status = fullyReceived ? "received" : "partially_received";
      purchaseOrder.receivedAt = new Date().toISOString();
      purchaseOrder.updatedAt = purchaseOrder.receivedAt;
    }

    return { status: "received" as const, product, movement, supplier, purchaseOrder };
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
    if (isServiceProduct(product)) return { status: "non_stock_product" as const, productName: product.name };
    const purchaseOrder = input.purchaseOrderId
      ? await tx.purchaseOrder.findFirst({ where: { tenantId, branchId: input.branchId, id: input.purchaseOrderId } })
      : null;
    if (input.purchaseOrderId && !purchaseOrder) return { status: "purchase_order_not_found" as const };
    if (purchaseOrder && !["approved", "partially_received"].includes(purchaseOrder.status)) return { status: "purchase_order_not_receivable" as const };
    const purchaseOrderLines = purchaseOrder ? (purchaseOrder.lines as unknown as PurchaseOrderLine[]) : [];
    const purchaseOrderLine = purchaseOrderLines.find((line) => line.productId === input.productId);
    if (purchaseOrder && !purchaseOrderLine) return { status: "purchase_order_line_not_found" as const };
    if (purchaseOrderLine && purchaseOrderLine.receivedQuantity + input.quantity > purchaseOrderLine.quantity) return { status: "purchase_order_over_received" as const };

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
    let updatedPurchaseOrder: PurchaseOrder | undefined;
    if (purchaseOrder && purchaseOrderLine) {
      const nextLines = purchaseOrderLines.map((line) => line.productId === input.productId ? { ...line, receivedQuantity: line.receivedQuantity + input.quantity } : line);
      const fullyReceived = nextLines.every((line) => line.receivedQuantity >= line.quantity);
      const order = await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: {
          lines: nextLines as unknown as Prisma.InputJsonValue,
          status: fullyReceived ? "received" : "partially_received",
          receivedAt: new Date()
        }
      });
      updatedPurchaseOrder = toApiPurchaseOrder(order);
    }

    return { status: "received" as const, product: toApiProduct(updatedProduct), movement: toApiMovement(movement), supplier: toApiSupplier(supplier), purchaseOrder: updatedPurchaseOrder };
  });

  return result;
}

export async function listInventoryTransfers(tenantId: string, filters: { branchId?: string }) {
  if (useDemoStore) {
    return inventoryTransfers.filter((transfer) => {
      const branchMatch = filters.branchId ? transfer.sourceBranchId === filters.branchId || transfer.destinationBranchId === filters.branchId : true;
      return transfer.tenantId === tenantId && branchMatch;
    });
  }

  const records = await prisma.inventoryTransfer.findMany({
    where: {
      tenantId,
      OR: filters.branchId ? [{ sourceBranchId: filters.branchId }, { destinationBranchId: filters.branchId }] : undefined
    },
    orderBy: { createdAt: "desc" }
  });

  return records.map(toApiInventoryTransfer);
}

export async function createInventoryTransfer(tenantId: string, userId: string, input: StockTransferInput) {
  if (input.sourceBranchId === input.destinationBranchId) return { status: "same_branch" as const };
  if (!(await branchBelongsToTenant(tenantId, input.sourceBranchId))) return { status: "source_branch_not_found" as const };
  if (!(await branchBelongsToTenant(tenantId, input.destinationBranchId))) return { status: "destination_branch_not_found" as const };

  if (useDemoStore) {
    const duplicate = inventoryTransfers.some((transfer) => transfer.tenantId === tenantId && transfer.reference === input.reference);
    if (duplicate) return { status: "duplicate_reference" as const };
    const sourceProduct = demoProducts.find((product) => product.tenantId === tenantId && product.branchId === input.sourceBranchId && product.id === input.sourceProductId);
    const destinationProduct = demoProducts.find((product) => product.tenantId === tenantId && product.branchId === input.destinationBranchId && product.id === input.destinationProductId);
    if (!sourceProduct) return { status: "source_product_not_found" as const };
    if (!destinationProduct) return { status: "destination_product_not_found" as const };
    if (isServiceProduct(sourceProduct) || isServiceProduct(destinationProduct)) return { status: "non_stock_product" as const, productName: isServiceProduct(sourceProduct) ? sourceProduct.name : destinationProduct.name };
    if (sourceProduct.stock < input.quantity) return { status: "insufficient_stock" as const, productName: sourceProduct.name };

    sourceProduct.stock -= input.quantity;
    destinationProduct.stock += input.quantity;
    const sourceMovement = appendStockMovement({
      tenantId,
      branchId: input.sourceBranchId,
      productId: sourceProduct.id,
      productName: sourceProduct.name,
      type: "transfer",
      quantityDelta: -input.quantity,
      balanceAfter: sourceProduct.stock,
      reason: input.note,
      reference: input.reference,
      createdBy: userId
    });
    const destinationMovement = appendStockMovement({
      tenantId,
      branchId: input.destinationBranchId,
      productId: destinationProduct.id,
      productName: destinationProduct.name,
      type: "transfer",
      quantityDelta: input.quantity,
      balanceAfter: destinationProduct.stock,
      reason: input.note,
      reference: input.reference,
      createdBy: userId
    });
    const transfer: InventoryTransfer = {
      id: nextInventoryTransferId(),
      tenantId,
      sourceBranchId: input.sourceBranchId,
      destinationBranchId: input.destinationBranchId,
      sourceProductId: sourceProduct.id,
      destinationProductId: destinationProduct.id,
      productName: sourceProduct.name,
      quantity: input.quantity,
      reference: input.reference,
      note: input.note,
      sourceMovementId: sourceMovement.id,
      destinationMovementId: destinationMovement.id,
      createdBy: userId,
      createdAt: new Date().toISOString()
    };
    inventoryTransfers.unshift(transfer);
    appendAudit({ tenantId, branchId: input.sourceBranchId, userId, action: "inventory.transfer_created", entityType: "inventoryTransfer", entityId: transfer.id, metadata: { destinationBranchId: input.destinationBranchId, sourceProductId: sourceProduct.id, destinationProductId: destinationProduct.id, quantity: input.quantity } });
    return { status: "created" as const, transfer, sourceProduct, destinationProduct, sourceMovement, destinationMovement };
  }

  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.inventoryTransfer.findFirst({ where: { tenantId, reference: input.reference } });
    if (duplicate) return { status: "duplicate_reference" as const };
    const sourceProduct = await tx.product.findFirst({ where: { tenantId, branchId: input.sourceBranchId, id: input.sourceProductId } });
    const destinationProduct = await tx.product.findFirst({ where: { tenantId, branchId: input.destinationBranchId, id: input.destinationProductId } });
    if (!sourceProduct) return { status: "source_product_not_found" as const };
    if (!destinationProduct) return { status: "destination_product_not_found" as const };
    if (isServiceProduct(sourceProduct) || isServiceProduct(destinationProduct)) return { status: "non_stock_product" as const, productName: isServiceProduct(sourceProduct) ? sourceProduct.name : destinationProduct.name };
    if (sourceProduct.stock < input.quantity) return { status: "insufficient_stock" as const, productName: sourceProduct.name };

    const updatedSourceProduct = await tx.product.update({ where: { id: sourceProduct.id }, data: { stock: sourceProduct.stock - input.quantity } });
    const updatedDestinationProduct = await tx.product.update({ where: { id: destinationProduct.id }, data: { stock: destinationProduct.stock + input.quantity } });
    const sourceMovement = await tx.stockMovement.create({
      data: {
        id: nextStockMovementId(),
        tenantId,
        branchId: input.sourceBranchId,
        productId: sourceProduct.id,
        productName: sourceProduct.name,
        type: "transfer",
        quantityDelta: -input.quantity,
        balanceAfter: updatedSourceProduct.stock,
        reason: input.note,
        reference: input.reference,
        createdBy: userId
      }
    });
    const destinationMovement = await tx.stockMovement.create({
      data: {
        id: nextStockMovementId(),
        tenantId,
        branchId: input.destinationBranchId,
        productId: destinationProduct.id,
        productName: destinationProduct.name,
        type: "transfer",
        quantityDelta: input.quantity,
        balanceAfter: updatedDestinationProduct.stock,
        reason: input.note,
        reference: input.reference,
        createdBy: userId
      }
    });
    const transfer = await tx.inventoryTransfer.create({
      data: {
        id: nextInventoryTransferId(),
        tenantId,
        sourceBranchId: input.sourceBranchId,
        destinationBranchId: input.destinationBranchId,
        sourceProductId: sourceProduct.id,
        destinationProductId: destinationProduct.id,
        productName: sourceProduct.name,
        quantity: input.quantity,
        reference: input.reference,
        note: input.note,
        sourceMovementId: sourceMovement.id,
        destinationMovementId: destinationMovement.id,
        createdBy: userId
      }
    });
    await tx.auditEvent.create({ data: { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, tenantId, branchId: input.sourceBranchId, userId, action: "inventory.transfer_created", entityType: "inventoryTransfer", entityId: transfer.id, metadata: { destinationBranchId: input.destinationBranchId, sourceProductId: sourceProduct.id, destinationProductId: destinationProduct.id, quantity: input.quantity } } });
    return { status: "created" as const, transfer: toApiInventoryTransfer(transfer), sourceProduct: toApiProduct(updatedSourceProduct), destinationProduct: toApiProduct(updatedDestinationProduct), sourceMovement: toApiMovement(sourceMovement), destinationMovement: toApiMovement(destinationMovement) };
  });
}

export async function applyInventoryAdjustment(tenantId: string, userId: string, input: StockAdjustmentInput) {
  if (!(await branchBelongsToTenant(tenantId, input.branchId))) {
    return { status: "branch_not_found" as const };
  }

  if (useDemoStore) {
    const product = demoProducts.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === input.productId);

    if (!product) return { status: "product_not_found" as const };
    if (isServiceProduct(product)) return { status: "non_stock_product" as const, productName: product.name };

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
    if (isServiceProduct(product)) return { status: "non_stock_product" as const, productName: product.name };

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
      if (isServiceProduct(product)) return { status: "non_stock_product" as const, productName: product.name };

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
      if (isServiceProduct(product)) return { status: "non_stock_product" as const, productName: product.name };

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

import type { Prisma, CompletedSale as DbCompletedSale, Customer as DbCustomer, PaymentRecord as DbPaymentRecord, Product as DbProduct } from "@prisma/client";
import {
  appendAudit,
  appendCompletedSale,
  appendCustomerLedger,
  appendPaymentRecord,
  appendStockMovement,
  branches,
  completedSales,
  customers,
  demoProducts,
  demoTenants,
  paymentRecords,
  registerShifts,
  restaurantTables,
  saleLedger,
  terminals,
  tableOrders,
  type CompletedSale,
  type CompletedSaleSummary,
  type DemoProduct,
  type PaymentRecord
} from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { createSaleSchema, previewSaleTotal } from "./sales.service";
import type { z } from "zod";

const useDemoStore = process.env.NODE_ENV === "test";

type SaleInput = z.infer<typeof createSaleSchema>;
type SaleAction = "refund" | "void";
type SerializedSale = CompletedSale & {
  customer?: Pick<DbCustomer, "id" | "name" | "phone" | "group" | "loyaltyPoints" | "outstandingBalance">;
  payments: PaymentRecord[];
};

const paymentSettingKey = {
  cash: "cash",
  card: "card",
  bank_transfer: "bankTransfer",
  mobile_money: "mobileMoney"
} as const;

function nextSaleIdFromCount(count: number) {
  return `INV-${String(count + 1).padStart(5, "0")}`;
}

function nextPaymentId() {
  return `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextStockMovementId() {
  return `move-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextLedgerId() {
  return `cust-ledger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function toApiPayment(payment: DbPaymentRecord): PaymentRecord {
  return {
    id: payment.id,
    tenantId: payment.tenantId,
    branchId: payment.branchId,
    saleId: payment.saleId,
    shiftId: payment.shiftId,
    method: payment.method as PaymentRecord["method"],
    amount: payment.amount,
    reference: payment.reference ?? undefined,
    reconciliationStatus: payment.reconciliationStatus as PaymentRecord["reconciliationStatus"],
    createdAt: payment.createdAt.toISOString()
  };
}

async function validateSaleTerminal(tenantId: string, branchId: string, terminalId: string) {
  if (useDemoStore) {
    const branch = branches.find((item) => item.tenantId === tenantId && item.id === branchId);
    if (!branch) return { status: "branch_not_found" as const };
    if (branch.status !== "active") return { status: "branch_not_active" as const };

    const terminal = terminals.find((item) => item.tenantId === tenantId && item.id === terminalId);
    if (!terminal) return { status: "terminal_not_found" as const };
    if (terminal.branchId !== branchId) return { status: "terminal_branch_mismatch" as const };
    if (terminal.status !== "online") return { status: "terminal_not_online" as const };

    return { status: "valid" as const };
  }

  const [branch, terminal] = await Promise.all([
    prisma.branch.findFirst({ where: { tenantId, id: branchId } }),
    prisma.terminal.findFirst({ where: { tenantId, id: terminalId } })
  ]);

  if (!branch) return { status: "branch_not_found" as const };
  if (branch.status !== "active") return { status: "branch_not_active" as const };
  if (!terminal) return { status: "terminal_not_found" as const };
  if (terminal.branchId !== branchId) return { status: "terminal_branch_mismatch" as const };
  if (terminal.status !== "online") return { status: "terminal_not_online" as const };

  return { status: "valid" as const };
}

function parseSummary(summary: Prisma.JsonValue): CompletedSaleSummary {
  return summary as unknown as CompletedSaleSummary;
}

function parseReceipt(receipt: Prisma.JsonValue): CompletedSale["receipt"] {
  return receipt as unknown as CompletedSale["receipt"];
}

function toApiSale(sale: DbCompletedSale): CompletedSale {
  return {
    id: sale.id,
    tenantId: sale.tenantId,
    branchId: sale.branchId,
    terminalId: sale.terminalId,
    shiftId: sale.shiftId,
    cashierId: sale.cashierId,
    customerId: sale.customerId ?? undefined,
    tableId: sale.tableId ?? undefined,
    tableOrderId: sale.tableOrderId ?? undefined,
    idempotencyKey: sale.idempotencyKey,
    summary: parseSummary(sale.summary),
    status: sale.status as CompletedSale["status"],
    refundTotal: sale.refundTotal,
    receipt: parseReceipt(sale.receipt),
    voidReason: sale.voidReason ?? undefined,
    refundReason: sale.refundReason ?? undefined,
    createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString()
  };
}

function serializeDemoSale(sale: (typeof saleLedger)[number]) {
  const customer = sale.customerId ? customers.find((item) => item.tenantId === sale.tenantId && item.id === sale.customerId) : undefined;

  return {
    ...sale,
    customer: customer
      ? {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          group: customer.group,
          loyaltyPoints: customer.loyaltyPoints,
          outstandingBalance: customer.outstandingBalance
        }
      : undefined,
    payments: paymentRecords.filter((payment) => payment.saleId === sale.id)
  };
}

async function serializeDbSale(sale: DbCompletedSale): Promise<SerializedSale> {
  const [customer, payments] = await Promise.all([
    sale.customerId ? prisma.customer.findFirst({ where: { tenantId: sale.tenantId, id: sale.customerId } }) : Promise.resolve(null),
    prisma.paymentRecord.findMany({ where: { tenantId: sale.tenantId, saleId: sale.id }, orderBy: { createdAt: "desc" } })
  ]);
  const apiSale = toApiSale(sale);

  return {
    ...apiSale,
    customer: customer
      ? {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          group: customer.group,
          loyaltyPoints: customer.loyaltyPoints,
          outstandingBalance: customer.outstandingBalance
        }
      : undefined,
    payments: payments.map(toApiPayment)
  };
}

function aggregateSaleQuantities(lines: Array<{ productId: string; quantity: number }>) {
  return lines.reduce<Record<string, number>>((totals, line) => {
    totals[line.productId] = (totals[line.productId] ?? 0) + line.quantity;
    return totals;
  }, {});
}

function refundedQuantitiesForSale(sale: CompletedSale, refundTotal: number) {
  return sale.summary.lines.reduce<Record<string, number>>((totals, line) => {
    totals[line.productId] = Math.floor((line.quantity * refundTotal) / sale.summary.total);
    return totals;
  }, {});
}

function customerCreditPaidForDemoSale(saleId: string) {
  return paymentRecords.filter((payment) => payment.saleId === saleId && payment.method === "customer_credit").reduce((sum, payment) => sum + payment.amount, 0);
}

async function customerCreditPaidForDbSale(saleId: string) {
  const payments = await prisma.paymentRecord.findMany({ where: { saleId, method: "customer_credit" } });
  return payments.reduce((sum, payment) => sum + payment.amount, 0);
}

function applyDemoCustomerSaleReversal(
  sale: CompletedSale,
  reversal: { creditAmount: number; loyaltyPoints: number; reason: string; action: SaleAction; userId: string }
) {
  if (!sale.customerId) return;

  const customer = customers.find((item) => item.tenantId === sale.tenantId && item.id === sale.customerId);
  if (!customer) return;

  const creditReversal = Math.min(customer.outstandingBalance, reversal.creditAmount);
  const pointsReversal = Math.min(customer.loyaltyPoints, reversal.loyaltyPoints);

  if (creditReversal > 0) {
    customer.outstandingBalance -= creditReversal;
    appendCustomerLedger({
      tenantId: sale.tenantId,
      customerId: customer.id,
      type: "payment",
      amount: -creditReversal,
      pointsDelta: 0,
      balanceAfter: customer.outstandingBalance,
      pointsAfter: customer.loyaltyPoints,
      note: `${reversal.action === "void" ? "Voided" : "Refunded"} credit from ${sale.id}: ${reversal.reason}`,
      createdBy: reversal.userId
    });
  }

  if (pointsReversal > 0) {
    customer.loyaltyPoints -= pointsReversal;
    appendCustomerLedger({
      tenantId: sale.tenantId,
      customerId: customer.id,
      type: "loyalty_adjustment",
      amount: 0,
      pointsDelta: -pointsReversal,
      balanceAfter: customer.outstandingBalance,
      pointsAfter: customer.loyaltyPoints,
      note: `${reversal.action === "void" ? "Voided" : "Refunded"} loyalty from ${sale.id}: ${reversal.reason}`,
      createdBy: reversal.userId
    });
  }
}

function returnDemoSaleStock(sale: CompletedSale, returnedQuantities: Record<string, number>, reason: string, action: SaleAction, userId: string) {
  const returns = Object.entries(returnedQuantities)
    .filter(([, quantity]) => quantity > 0)
    .map(([productId, quantity]) => {
      const product = demoProducts.find((item) => item.tenantId === sale.tenantId && item.branchId === sale.branchId && item.id === productId);
      return { productId, quantity, product };
    });

  returns.forEach(({ product, quantity }) => {
    if (!product) return;

    const balanceAfter = product.stock + quantity;
    product.stock = balanceAfter;
    appendStockMovement({
      tenantId: sale.tenantId,
      branchId: sale.branchId,
      productId: product.id,
      productName: product.name,
      type: "receipt",
      quantityDelta: quantity,
      balanceAfter,
      reason: `${action === "void" ? "Voided" : "Refunded"} sale ${sale.id}: ${reason}`,
      reference: sale.id,
      createdBy: userId
    });
  });

  if (returns.length > 0) {
    appendAudit({
      tenantId: sale.tenantId,
      branchId: sale.branchId,
      userId,
      action: "inventory.sale_stock_returned",
      entityType: "sale",
      entityId: sale.id,
      metadata: { action, reason, lines: returns.map(({ productId, quantity }) => ({ productId, quantity })) }
    });
  }
}

async function returnDbSaleStock(
  tx: Prisma.TransactionClient,
  sale: CompletedSale,
  returnedQuantities: Record<string, number>,
  reason: string,
  action: SaleAction,
  userId: string
) {
  const returns = Object.entries(returnedQuantities).filter(([, quantity]) => quantity > 0);

  for (const [productId, quantity] of returns) {
    const product = await tx.product.findFirst({ where: { tenantId: sale.tenantId, branchId: sale.branchId, id: productId } });
    if (!product) continue;

    const balanceAfter = product.stock + quantity;
    await tx.product.update({ where: { id: product.id }, data: { stock: balanceAfter } });
    await tx.stockMovement.create({
      data: {
        id: nextStockMovementId(),
        tenantId: sale.tenantId,
        branchId: sale.branchId,
        productId: product.id,
        productName: product.name,
        type: "receipt",
        quantityDelta: quantity,
        balanceAfter,
        reason: `${action === "void" ? "Voided" : "Refunded"} sale ${sale.id}: ${reason}`,
        reference: sale.id,
        createdBy: userId
      }
    });
  }

  if (returns.length > 0) {
    await tx.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId: sale.tenantId,
        branchId: sale.branchId,
        userId,
        action: "inventory.sale_stock_returned",
        entityType: "sale",
        entityId: sale.id,
        metadata: { action, reason, lines: returns.map(([productId, quantity]) => ({ productId, quantity })) }
      }
    });
  }
}

async function applyDbCustomerSaleReversal(
  tx: Prisma.TransactionClient,
  sale: CompletedSale,
  reversal: { creditAmount: number; loyaltyPoints: number; reason: string; action: SaleAction; userId: string }
) {
  if (!sale.customerId) return;

  const customer = await tx.customer.findFirst({ where: { tenantId: sale.tenantId, id: sale.customerId } });
  if (!customer) return;

  const creditReversal = Math.min(customer.outstandingBalance, reversal.creditAmount);
  const pointsReversal = Math.min(customer.loyaltyPoints, reversal.loyaltyPoints);
  let nextBalance = customer.outstandingBalance;
  let nextPoints = customer.loyaltyPoints;

  if (creditReversal > 0) {
    nextBalance -= creditReversal;
    await tx.customer.update({ where: { id: customer.id }, data: { outstandingBalance: nextBalance } });
    await tx.customerLedgerEntry.create({
      data: {
        id: nextLedgerId(),
        tenantId: sale.tenantId,
        customerId: customer.id,
        type: "payment",
        amount: -creditReversal,
        pointsDelta: 0,
        balanceAfter: nextBalance,
        pointsAfter: nextPoints,
        note: `${reversal.action === "void" ? "Voided" : "Refunded"} credit from ${sale.id}: ${reversal.reason}`,
        createdBy: reversal.userId
      }
    });
  }

  if (pointsReversal > 0) {
    nextPoints -= pointsReversal;
    await tx.customer.update({ where: { id: customer.id }, data: { loyaltyPoints: nextPoints } });
    await tx.customerLedgerEntry.create({
      data: {
        id: nextLedgerId(),
        tenantId: sale.tenantId,
        customerId: customer.id,
        type: "loyalty_adjustment",
        amount: 0,
        pointsDelta: -pointsReversal,
        balanceAfter: nextBalance,
        pointsAfter: nextPoints,
        note: `${reversal.action === "void" ? "Voided" : "Refunded"} loyalty from ${sale.id}: ${reversal.reason}`,
        createdBy: reversal.userId
      }
    });
  }
}

export async function listSales(tenantId: string, filters: { branchId?: string; status?: string; cashierId?: string } = {}) {
  if (useDemoStore) {
    return saleLedger
      .filter((sale) => sale.tenantId === tenantId)
      .filter((sale) => !filters.branchId || sale.branchId === filters.branchId)
      .filter((sale) => !filters.cashierId || sale.cashierId === filters.cashierId)
      .filter((sale) => !filters.status || filters.status === "all" || sale.status === filters.status)
      .map((sale) => serializeDemoSale(sale));
  }

  const sales = await prisma.completedSale.findMany({
    where: {
      tenantId,
      branchId: filters.branchId ? filters.branchId : undefined,
      cashierId: filters.cashierId ? filters.cashierId : undefined,
      status: filters.status && filters.status !== "all" ? filters.status : undefined
    },
    orderBy: { createdAt: "desc" }
  });

  return Promise.all(sales.map((sale) => serializeDbSale(sale)));
}

export async function createSale(tenantId: string, userId: string, input: SaleInput) {
  const terminalValidation = await validateSaleTerminal(tenantId, input.branchId, input.terminalId);
  if (terminalValidation.status !== "valid") return terminalValidation;

  if (useDemoStore) {
    const idempotencyKey = `${tenantId}:${input.idempotencyKey}`;
    const shift = registerShifts.find(
      (item) => item.tenantId === tenantId && item.branchId === input.branchId && item.terminalId === input.terminalId && item.status === "open"
    );

    if (!shift) return { status: "no_open_shift" as const };

    const tenant = demoTenants.find((item) => item.id === tenantId);
    if (!tenant) return { status: "tenant_not_found" as const };
    const summary = previewSaleTotal(tenantId, input, {
      vatRate: tenant.settings.defaultTaxRate,
      serviceChargeEnabled: tenant.settings.serviceChargeEnabled,
      serviceChargeRate: tenant.settings.serviceChargeRate
    });

    const disabledPayment = input.payments.find((payment) => {
      const key = paymentSettingKey[payment.method as keyof typeof paymentSettingKey];
      return key ? tenant.settings.paymentMethods[key] === false : false;
    });

    if (disabledPayment) return { status: "payment_disabled" as const, method: disabledPayment.method };
    if (summary.paid !== summary.total) return { status: "payment_total_mismatch" as const, total: summary.total, paid: summary.paid };

    const customer = input.customerId ? customers.find((item) => item.tenantId === tenantId && item.id === input.customerId) : undefined;
    if (input.customerId && !customer) return { status: "customer_not_found" as const };

    const creditAmount = input.payments.filter((payment) => payment.method === "customer_credit").reduce((sum, payment) => sum + payment.amount, 0);
    if (creditAmount > 0 && !customer) return { status: "credit_requires_customer" as const };
    if (customer && creditAmount > 0 && customer.outstandingBalance + creditAmount > customer.creditLimit) {
      return { status: "credit_limit_exceeded" as const };
    }

    if (completedSales.has(idempotencyKey)) {
      const completedSale = completedSales.get(idempotencyKey)!;
      appendAudit({
        tenantId,
        branchId: input.branchId,
        userId,
        action: "sale.replayed",
        entityType: "sale",
        entityId: completedSale.saleId,
        metadata: { idempotencyKey: input.idempotencyKey }
      });
      return { status: "replayed" as const, response: completedSale };
    }

    const stockIssues = Object.entries(aggregateSaleQuantities(input.lines)).map(([productId, quantity]) => {
      const product = demoProducts.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === productId);
      return { productId, quantity, product };
    });
    const missingStockProduct = stockIssues.find((issue) => !issue.product);
    if (missingStockProduct) return { status: "stock_not_found" as const, productId: missingStockProduct.productId };
    const insufficientStock = stockIssues.find((issue) => issue.product!.stock < issue.quantity);
    if (insufficientStock) return { status: "insufficient_stock" as const, productName: insufficientStock.product!.name };

    const saleId = nextSaleIdFromCount(saleLedger.length);
    appendAudit({
      tenantId,
      branchId: input.branchId,
      userId,
      action: "sale.created",
      entityType: "sale",
      entityId: saleId,
      metadata: { terminalId: input.terminalId, tableId: input.tableId, tableOrderId: input.tableOrderId, idempotencyKey: input.idempotencyKey, total: summary.total }
    });

    stockIssues.forEach(({ product, quantity }) => {
      const balanceAfter = product!.stock - quantity;
      product!.stock = balanceAfter;
      appendStockMovement({
        tenantId,
        branchId: input.branchId,
        productId: product!.id,
        productName: product!.name,
        type: "issue",
        quantityDelta: -quantity,
        balanceAfter,
        reason: `Sale ${saleId}`,
        reference: saleId,
        createdBy: userId
      });
    });

    if (stockIssues.length > 0) {
      appendAudit({
        tenantId,
        branchId: input.branchId,
        userId,
        action: "inventory.sale_stock_issued",
        entityType: "sale",
        entityId: saleId,
        metadata: { lines: stockIssues.map(({ product, quantity }) => ({ productId: product!.id, quantity })) }
      });
    }

    input.payments.forEach((payment) => {
      appendPaymentRecord({
        tenantId,
        branchId: input.branchId,
        saleId,
        shiftId: shift.id,
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference,
        reconciliationStatus: payment.method === "cash" ? "matched" : "pending"
      });

      if (payment.method === "cash") shift.expectedCash += payment.amount;
    });

    appendAudit({
      tenantId,
      branchId: input.branchId,
      userId,
      action: "payment.recorded",
      entityType: "sale",
      entityId: saleId,
      metadata: { methods: input.payments.map((payment) => payment.method), paid: summary.paid }
    });

    const receipt = {
      businessName: tenant.settings.businessName,
      taxId: tenant.settings.taxId,
      currency: tenant.settings.currency,
      footer: tenant.settings.receiptFooter,
      whatsappEnabled: tenant.settings.whatsappReceipts,
      printerName: tenant.settings.hardware.printer.trim() || undefined,
      printEnabled: Boolean(tenant.settings.hardware.printer.trim())
    };
    const response = { saleId, summary, receipt };
    completedSales.set(idempotencyKey, response);
    appendCompletedSale({
      id: saleId,
      tenantId,
      branchId: input.branchId,
      terminalId: input.terminalId,
      shiftId: shift.id,
      cashierId: userId,
      customerId: input.customerId,
      tableId: input.tableId,
      tableOrderId: input.tableOrderId,
      idempotencyKey: input.idempotencyKey,
      summary,
      status: "completed",
      refundTotal: 0,
      receipt
    });

    if (customer) {
      const loyaltyPoints = Math.floor(summary.total / 100);
      customer.lastVisitAt = new Date().toISOString();

      if (creditAmount > 0) {
        customer.outstandingBalance += creditAmount;
        appendCustomerLedger({
          tenantId,
          customerId: customer.id,
          type: "credit_sale",
          amount: creditAmount,
          pointsDelta: 0,
          balanceAfter: customer.outstandingBalance,
          pointsAfter: customer.loyaltyPoints,
          note: `Credit sale ${saleId}`,
          createdBy: userId
        });
      }

      if (loyaltyPoints > 0) {
        customer.loyaltyPoints += loyaltyPoints;
        appendCustomerLedger({
          tenantId,
          customerId: customer.id,
          type: "loyalty_adjustment",
          amount: 0,
          pointsDelta: loyaltyPoints,
          balanceAfter: customer.outstandingBalance,
          pointsAfter: customer.loyaltyPoints,
          note: `Loyalty earned from ${saleId}`,
          createdBy: userId
        });
      }
    }

    if (input.tableOrderId) {
      const tableOrder = tableOrders.find((item) => item.tenantId === tenantId && item.id === input.tableOrderId && item.status !== "closed" && item.status !== "cancelled");
      const table = restaurantTables.find((item) => item.tenantId === tenantId && item.id === (input.tableId ?? tableOrder?.tableId));
      if (tableOrder) tableOrder.status = "closed";
      if (table) {
        Object.assign(table, {
          state: "available",
          guests: 0,
          waiterId: undefined,
          orderId: undefined,
          customerName: undefined,
          specialInstructions: undefined,
          openedAt: undefined
        });
      }
    }

    return { status: "created" as const, response };
  }

  const products = await prisma.product.findMany({ where: { tenantId, id: { in: input.lines.map((line) => line.productId) } } });
  const productCatalog = products.map(toApiProduct);
  const idempotentSale = await prisma.completedSale.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }
  });

  if (idempotentSale) {
    await prisma.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId: input.branchId,
        userId,
        action: "sale.replayed",
        entityType: "sale",
        entityId: idempotentSale.id,
        metadata: { idempotencyKey: input.idempotencyKey }
      }
    });
    return { status: "replayed" as const, response: { saleId: idempotentSale.id, summary: parseSummary(idempotentSale.summary), receipt: parseReceipt(idempotentSale.receipt) } };
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { status: "tenant_not_found" as const };

  const settings = tenant.settings as Record<string, any>;
  const summary = previewSaleTotal(tenantId, input, {
    vatRate: settings.defaultTaxRate ?? undefined,
    serviceChargeEnabled: settings.serviceChargeEnabled ?? true,
    serviceChargeRate: settings.serviceChargeRate ?? 0.05
  }, productCatalog);
  const disabledPayment = input.payments.find((payment) => {
    const key = paymentSettingKey[payment.method as keyof typeof paymentSettingKey];
    return key ? settings.paymentMethods?.[key] === false : false;
  });

  if (disabledPayment) return { status: "payment_disabled" as const, method: disabledPayment.method };
  if (summary.paid !== summary.total) return { status: "payment_total_mismatch" as const, total: summary.total, paid: summary.paid };

  const customer = input.customerId ? await prisma.customer.findFirst({ where: { tenantId, id: input.customerId } }) : null;
  if (input.customerId && !customer) return { status: "customer_not_found" as const };

  const creditAmount = input.payments.filter((payment) => payment.method === "customer_credit").reduce((sum, payment) => sum + payment.amount, 0);
  if (creditAmount > 0 && !customer) return { status: "credit_requires_customer" as const };
  if (customer && creditAmount > 0 && customer.outstandingBalance + creditAmount > customer.creditLimit) {
    return { status: "credit_limit_exceeded" as const };
  }

  const result = await prisma.$transaction(async (tx) => {
    const shift = await tx.registerShift.findFirst({
      where: { tenantId, branchId: input.branchId, terminalId: input.terminalId, status: "open" }
    });

    if (!shift) return { status: "no_open_shift" as const };

    const saleCount = await tx.completedSale.count();
    const saleId = nextSaleIdFromCount(saleCount);
    const stockIssues = [];

    for (const [productId, quantity] of Object.entries(aggregateSaleQuantities(input.lines))) {
      const product = await tx.product.findFirst({ where: { tenantId, branchId: input.branchId, id: productId } });
      if (!product) return { status: "stock_not_found" as const, productId };
      if (product.stock < quantity) return { status: "insufficient_stock" as const, productName: product.name };
      stockIssues.push({ product, quantity });
    }

    await tx.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId: input.branchId,
        userId,
        action: "sale.created",
        entityType: "sale",
        entityId: saleId,
        metadata: { terminalId: input.terminalId, tableId: input.tableId, tableOrderId: input.tableOrderId, idempotencyKey: input.idempotencyKey, total: summary.total }
      }
    });

    for (const { product, quantity } of stockIssues) {
      const balanceAfter = product.stock - quantity;
      await tx.product.update({ where: { id: product.id }, data: { stock: balanceAfter } });
      await tx.stockMovement.create({
        data: {
          id: nextStockMovementId(),
          tenantId,
          branchId: input.branchId,
          productId: product.id,
          productName: product.name,
          type: "issue",
          quantityDelta: -quantity,
          balanceAfter,
          reason: `Sale ${saleId}`,
          reference: saleId,
          createdBy: userId
        }
      });
    }

    if (stockIssues.length > 0) {
      await tx.auditEvent.create({
        data: {
          id: nextAuditId(),
          tenantId,
          branchId: input.branchId,
          userId,
          action: "inventory.sale_stock_issued",
          entityType: "sale",
          entityId: saleId,
          metadata: { lines: stockIssues.map(({ product, quantity }) => ({ productId: product.id, quantity })) }
        }
      });
    }

    const receipt = {
      businessName: settings.businessName,
      taxId: settings.taxId,
      currency: settings.currency,
      footer: settings.receiptFooter,
      whatsappEnabled: Boolean(settings.whatsappReceipts),
      printerName: settings.hardware?.printer?.trim() || undefined,
      printEnabled: Boolean(settings.hardware?.printer?.trim())
    };

    await tx.completedSale.create({
      data: {
        id: saleId,
        tenantId,
        branchId: input.branchId,
        terminalId: input.terminalId,
        shiftId: shift.id,
        cashierId: userId,
        customerId: input.customerId,
        tableId: input.tableId,
        tableOrderId: input.tableOrderId,
        idempotencyKey: input.idempotencyKey,
        summary: summary as unknown as Prisma.InputJsonValue,
        status: "completed",
        refundTotal: 0,
        receipt: receipt as Prisma.InputJsonValue
      }
    });

    let cashTotal = 0;
    for (const payment of input.payments) {
      await tx.paymentRecord.create({
        data: {
          id: nextPaymentId(),
          tenantId,
          branchId: input.branchId,
          saleId,
          shiftId: shift.id,
          method: payment.method,
          amount: payment.amount,
          reference: payment.reference,
          reconciliationStatus: payment.method === "cash" ? "matched" : "pending"
        }
      });
      if (payment.method === "cash") cashTotal += payment.amount;
    }

    if (cashTotal > 0) {
      await tx.registerShift.update({ where: { id: shift.id }, data: { expectedCash: shift.expectedCash + cashTotal } });
    }

    await tx.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId: input.branchId,
        userId,
        action: "payment.recorded",
        entityType: "sale",
        entityId: saleId,
        metadata: { methods: input.payments.map((payment) => payment.method), paid: summary.paid }
      }
    });

    if (customer) {
      const loyaltyPoints = Math.floor(summary.total / 100);
      let nextBalance = customer.outstandingBalance;
      let nextPoints = customer.loyaltyPoints;

      if (creditAmount > 0) {
        nextBalance += creditAmount;
        await tx.customerLedgerEntry.create({
          data: {
            id: nextLedgerId(),
            tenantId,
            customerId: customer.id,
            type: "credit_sale",
            amount: creditAmount,
            pointsDelta: 0,
            balanceAfter: nextBalance,
            pointsAfter: nextPoints,
            note: `Credit sale ${saleId}`,
            createdBy: userId
          }
        });
      }

      if (loyaltyPoints > 0) {
        nextPoints += loyaltyPoints;
        await tx.customerLedgerEntry.create({
          data: {
            id: nextLedgerId(),
            tenantId,
            customerId: customer.id,
            type: "loyalty_adjustment",
            amount: 0,
            pointsDelta: loyaltyPoints,
            balanceAfter: nextBalance,
            pointsAfter: nextPoints,
            note: `Loyalty earned from ${saleId}`,
            createdBy: userId
          }
        });
      }

      await tx.customer.update({
        where: { id: customer.id },
        data: { outstandingBalance: nextBalance, loyaltyPoints: nextPoints, lastVisitAt: new Date() }
      });
    }

    if (input.tableOrderId) {
      const tableOrder = await tx.tableOrder.findFirst({
        where: { tenantId, id: input.tableOrderId, status: { notIn: ["closed", "cancelled"] } }
      });
      const tableId = input.tableId ?? tableOrder?.tableId;

      if (tableOrder) await tx.tableOrder.update({ where: { id: tableOrder.id }, data: { status: "closed" } });
      if (tableId) {
        await tx.restaurantTable.updateMany({
          where: { tenantId, id: tableId },
          data: {
            state: "available",
            guests: 0,
            waiterId: null,
            orderId: null,
            customerName: null,
            specialInstructions: null,
            openedAt: null
          }
        });
      }
    }

    return { status: "created" as const, response: { saleId, summary, receipt } };
  });

  return result;
}

export async function queueReceiptAction(tenantId: string, branchId: string | undefined, userId: string, saleId: string, channel: "print" | "whatsapp") {
  const sale = useDemoStore
    ? saleLedger.find((item) => item.tenantId === tenantId && item.id === saleId && (!branchId || item.branchId === branchId))
    : await prisma.completedSale
        .findFirst({ where: { tenantId, id: saleId, branchId: branchId ? branchId : undefined } })
        .then((item) => (item ? toApiSale(item) : undefined));

  if (!sale) return { status: "sale_not_found" as const };
  if (channel === "print" && !sale.receipt.printEnabled) return { status: "print_disabled" as const };
  if (channel === "whatsapp" && !sale.receipt.whatsappEnabled) return { status: "whatsapp_disabled" as const };

  const queuedAt = new Date().toISOString();
  const action = channel === "print" ? "receipt.print_queued" : "receipt.whatsapp_queued";

  if (useDemoStore) {
    appendAudit({
      tenantId,
      branchId: sale.branchId,
      userId,
      action,
      entityType: "sale",
      entityId: sale.id,
      metadata: { channel, printerName: sale.receipt.printerName, customerId: sale.customerId, queuedAt }
    });
  } else {
    await prisma.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId: sale.branchId,
        userId,
        action,
        entityType: "sale",
        entityId: sale.id,
        metadata: { channel, printerName: sale.receipt.printerName, customerId: sale.customerId, queuedAt }
      }
    });
  }

  return { status: "queued" as const, delivery: { saleId: sale.id, channel, status: "queued", queuedAt } };
}

export async function voidSale(tenantId: string, branchId: string | undefined, userId: string, saleId: string, reason: string) {
  if (useDemoStore) {
    const sale = saleLedger.find((item) => item.tenantId === tenantId && item.id === saleId && (!branchId || item.branchId === branchId));
    if (!sale) return { status: "sale_not_found" as const };
    if (sale.status !== "completed") return { status: "not_completed" as const };

    applyDemoCustomerSaleReversal(sale, {
      creditAmount: customerCreditPaidForDemoSale(sale.id),
      loyaltyPoints: Math.floor(sale.summary.total / 100),
      reason,
      action: "void",
      userId
    });
    returnDemoSaleStock(sale, aggregateSaleQuantities(sale.summary.lines), reason, "void", userId);
    sale.status = "voided";
    sale.voidReason = reason;
    sale.updatedAt = new Date().toISOString();
    appendAudit({
      tenantId,
      branchId: sale.branchId,
      userId,
      action: "sale.voided",
      entityType: "sale",
      entityId: sale.id,
      metadata: { reason, total: sale.summary.total }
    });

    return { status: "voided" as const, sale: serializeDemoSale(sale) };
  }

  const saleRecord = await prisma.completedSale.findFirst({ where: { tenantId, id: saleId, branchId: branchId ? branchId : undefined } });
  if (!saleRecord) return { status: "sale_not_found" as const };
  const sale = toApiSale(saleRecord);
  if (sale.status !== "completed") return { status: "not_completed" as const };
  const creditAmount = await customerCreditPaidForDbSale(sale.id);

  await prisma.$transaction(async (tx) => {
    await applyDbCustomerSaleReversal(tx, sale, {
      creditAmount,
      loyaltyPoints: Math.floor(sale.summary.total / 100),
      reason,
      action: "void",
      userId
    });
    await returnDbSaleStock(tx, sale, aggregateSaleQuantities(sale.summary.lines), reason, "void", userId);
    await tx.completedSale.update({ where: { id: sale.id }, data: { status: "voided", voidReason: reason } });
    await tx.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId: sale.branchId,
        userId,
        action: "sale.voided",
        entityType: "sale",
        entityId: sale.id,
        metadata: { reason, total: sale.summary.total }
      }
    });
  });

  const updatedSale = await prisma.completedSale.findUniqueOrThrow({ where: { id: sale.id } });
  return { status: "voided" as const, sale: await serializeDbSale(updatedSale) };
}

export async function refundSale(tenantId: string, branchId: string | undefined, userId: string, saleId: string, amount: number, reason: string) {
  if (useDemoStore) {
    const sale = saleLedger.find((item) => item.tenantId === tenantId && item.id === saleId && (!branchId || item.branchId === branchId));
    if (!sale) return { status: "sale_not_found" as const };
    if (sale.status === "voided" || sale.status === "refunded") return { status: "cannot_refund" as const };

    const nextRefundTotal = sale.refundTotal + amount;
    if (nextRefundTotal > sale.summary.total) return { status: "refund_exceeds_total" as const };

    const creditAmount = customerCreditPaidForDemoSale(sale.id);
    const previousReturnedQuantities = refundedQuantitiesForSale(sale, sale.refundTotal);
    const nextReturnedQuantities = refundedQuantitiesForSale(sale, nextRefundTotal);
    const deltaReturnedQuantities = Object.fromEntries(
      sale.summary.lines.map((line) => [
        line.productId,
        (nextReturnedQuantities[line.productId] ?? 0) - (previousReturnedQuantities[line.productId] ?? 0)
      ])
    );

    applyDemoCustomerSaleReversal(sale, {
      creditAmount: Math.min(nextRefundTotal, creditAmount) - Math.min(sale.refundTotal, creditAmount),
      loyaltyPoints: Math.floor(nextRefundTotal / 100) - Math.floor(sale.refundTotal / 100),
      reason,
      action: "refund",
      userId
    });
    returnDemoSaleStock(sale, deltaReturnedQuantities, reason, "refund", userId);
    sale.refundTotal = nextRefundTotal;
    sale.refundReason = reason;
    sale.status = nextRefundTotal === sale.summary.total ? "refunded" : "partially_refunded";
    sale.updatedAt = new Date().toISOString();
    appendAudit({
      tenantId,
      branchId: sale.branchId,
      userId,
      action: "sale.refunded",
      entityType: "sale",
      entityId: sale.id,
      metadata: { reason, amount, refundTotal: sale.refundTotal }
    });

    return { status: "refunded" as const, sale: serializeDemoSale(sale) };
  }

  const saleRecord = await prisma.completedSale.findFirst({ where: { tenantId, id: saleId, branchId: branchId ? branchId : undefined } });
  if (!saleRecord) return { status: "sale_not_found" as const };
  const sale = toApiSale(saleRecord);
  if (sale.status === "voided" || sale.status === "refunded") return { status: "cannot_refund" as const };

  const nextRefundTotal = sale.refundTotal + amount;
  if (nextRefundTotal > sale.summary.total) return { status: "refund_exceeds_total" as const };

  const creditAmount = await customerCreditPaidForDbSale(sale.id);
  const previousReturnedQuantities = refundedQuantitiesForSale(sale, sale.refundTotal);
  const nextReturnedQuantities = refundedQuantitiesForSale(sale, nextRefundTotal);
  const deltaReturnedQuantities = Object.fromEntries(
    sale.summary.lines.map((line) => [
      line.productId,
      (nextReturnedQuantities[line.productId] ?? 0) - (previousReturnedQuantities[line.productId] ?? 0)
    ])
  );

  await prisma.$transaction(async (tx) => {
    await applyDbCustomerSaleReversal(tx, sale, {
      creditAmount: Math.min(nextRefundTotal, creditAmount) - Math.min(sale.refundTotal, creditAmount),
      loyaltyPoints: Math.floor(nextRefundTotal / 100) - Math.floor(sale.refundTotal / 100),
      reason,
      action: "refund",
      userId
    });
    await returnDbSaleStock(tx, sale, deltaReturnedQuantities, reason, "refund", userId);
    await tx.completedSale.update({
      where: { id: sale.id },
      data: {
        refundTotal: nextRefundTotal,
        refundReason: reason,
        status: nextRefundTotal === sale.summary.total ? "refunded" : "partially_refunded"
      }
    });
    await tx.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId: sale.branchId,
        userId,
        action: "sale.refunded",
        entityType: "sale",
        entityId: sale.id,
        metadata: { reason, amount, refundTotal: nextRefundTotal }
      }
    });
  });

  const updatedSale = await prisma.completedSale.findUniqueOrThrow({ where: { id: sale.id } });
  return { status: "refunded" as const, sale: await serializeDbSale(updatedSale) };
}

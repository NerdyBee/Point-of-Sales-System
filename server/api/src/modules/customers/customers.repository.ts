import type { Customer as DbCustomer, CustomerLedgerEntry as DbCustomerLedgerEntry, Prisma } from "@prisma/client";
import { appendAudit, appendCashMovement, appendCustomerLedger, customerLedger, customers, registerShifts } from "../../shared/data/demoStore";
import type { Customer, CustomerLedgerEntry } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";

const useDemoStore = process.env.NODE_ENV === "test";

type CustomerInput = {
  name: string;
  phone: string;
  email?: string;
  group: Customer["group"];
  creditLimit: number;
  loyaltyPoints: number;
  notes?: string;
};

type CustomerPatchInput = Partial<CustomerInput>;
type LedgerInput = {
  type: CustomerLedgerEntry["type"];
  amount: number;
  pointsDelta: number;
  note: string;
  paymentMethod?: "cash" | "card" | "bank_transfer" | "mobile_money" | "voucher";
  paymentReference?: string;
  terminalId?: string;
};

function nextCustomerId() {
  return `cust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextLedgerId() {
  return `cust-ledger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextCashMovementId() {
  return `cash-move-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toApiCustomer(customer: DbCustomer): Customer {
  return {
    id: customer.id,
    tenantId: customer.tenantId,
    name: customer.name,
    phone: customer.phone,
    email: customer.email ?? undefined,
    group: customer.group as Customer["group"],
    loyaltyPoints: customer.loyaltyPoints,
    creditLimit: customer.creditLimit,
    outstandingBalance: customer.outstandingBalance,
    notes: customer.notes ?? undefined,
    lastVisitAt: customer.lastVisitAt?.toISOString(),
    createdAt: customer.createdAt.toISOString()
  };
}

function toApiLedgerEntry(entry: DbCustomerLedgerEntry): CustomerLedgerEntry {
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    branchId: entry.branchId,
    customerId: entry.customerId,
    type: entry.type as CustomerLedgerEntry["type"],
    amount: entry.amount,
    pointsDelta: entry.pointsDelta,
    balanceAfter: entry.balanceAfter,
    pointsAfter: entry.pointsAfter,
    note: entry.note,
    createdAt: entry.createdAt.toISOString(),
    createdBy: entry.createdBy
  };
}

async function appendCustomerAudit(event: Parameters<typeof appendAudit>[0]) {
  if (useDemoStore) {
    appendAudit(event);
    return;
  }

  await prisma.auditEvent.create({
    data: {
      id: nextAuditId(),
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

export async function listCustomers(tenantId: string, query = "") {
  const normalizedQuery = query.toLowerCase();

  if (useDemoStore) {
    return customers.filter((customer) => {
      const queryMatch = normalizedQuery
        ? `${customer.name} ${customer.phone} ${customer.group}`.toLowerCase().includes(normalizedQuery)
        : true;
      return customer.tenantId === tenantId && queryMatch;
    });
  }

  const where = normalizedQuery
    ? {
        tenantId,
        OR: [
          { name: { contains: normalizedQuery } },
          { phone: { contains: normalizedQuery } },
          { group: { contains: normalizedQuery } }
        ]
      }
    : { tenantId };

  const customerRecords = await prisma.customer.findMany({
    where,
    orderBy: { name: "asc" }
  });

  return customerRecords.map(toApiCustomer);
}

export async function createCustomer(tenantId: string, branchId: string | undefined, userId: string, input: CustomerInput) {
  if (useDemoStore) {
    const duplicatePhone = customers.some((customer) => customer.tenantId === tenantId && customer.phone === input.phone);

    if (duplicatePhone) return { status: "duplicate_phone" as const };

    const customer = {
      id: `cust-${customers.length + 1}`,
      tenantId,
      name: input.name,
      phone: input.phone,
      email: input.email || undefined,
      group: input.group,
      loyaltyPoints: input.loyaltyPoints,
      creditLimit: input.creditLimit,
      outstandingBalance: 0,
      notes: input.notes,
      createdAt: new Date().toISOString()
    };

    customers.unshift(customer);
    appendAudit({
      tenantId,
      branchId,
      userId,
      action: "customer.created",
      entityType: "customer",
      entityId: customer.id,
      metadata: { group: customer.group, creditLimit: customer.creditLimit }
    });

    return { status: "created" as const, customer };
  }

  const duplicatePhone = await prisma.customer.findFirst({ where: { tenantId, phone: input.phone } });

  if (duplicatePhone) return { status: "duplicate_phone" as const };

  const customer = await prisma.customer.create({
    data: {
      id: nextCustomerId(),
      tenantId,
      name: input.name,
      phone: input.phone,
      email: input.email || undefined,
      group: input.group,
      loyaltyPoints: input.loyaltyPoints,
      creditLimit: input.creditLimit,
      outstandingBalance: 0,
      notes: input.notes
    }
  });

  await appendCustomerAudit({
    tenantId,
    branchId,
    userId,
    action: "customer.created",
    entityType: "customer",
    entityId: customer.id,
    metadata: { group: customer.group, creditLimit: customer.creditLimit }
  });

  return { status: "created" as const, customer: toApiCustomer(customer) };
}

export async function updateCustomer(
  tenantId: string,
  branchId: string | undefined,
  userId: string,
  customerId: string,
  input: CustomerPatchInput
) {
  if (useDemoStore) {
    const customerIndex = customers.findIndex((customer) => customer.tenantId === tenantId && customer.id === customerId);

    if (customerIndex === -1) return { status: "not_found" as const };

    if (input.phone) {
      const duplicatePhone = customers.some((customer) => customer.tenantId === tenantId && customer.phone === input.phone && customer.id !== customerId);

      if (duplicatePhone) return { status: "duplicate_phone" as const };
    }

    const customer = {
      ...customers[customerIndex],
      ...input,
      email: input.email === "" ? undefined : input.email ?? customers[customerIndex].email
    };

    customers[customerIndex] = customer;
    appendAudit({
      tenantId,
      branchId,
      userId,
      action: "customer.updated",
      entityType: "customer",
      entityId: customer.id,
      metadata: { fields: Object.keys(input) }
    });

    return { status: "updated" as const, customer };
  }

  const existingCustomer = await prisma.customer.findFirst({ where: { tenantId, id: customerId } });

  if (!existingCustomer) return { status: "not_found" as const };

  if (input.phone) {
    const duplicatePhone = await prisma.customer.findFirst({
      where: { tenantId, phone: input.phone, id: { not: customerId } }
    });

    if (duplicatePhone) return { status: "duplicate_phone" as const };
  }

  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email === "" ? null : input.email,
      group: input.group,
      creditLimit: input.creditLimit,
      loyaltyPoints: input.loyaltyPoints,
      notes: input.notes
    }
  });

  await appendCustomerAudit({
    tenantId,
    branchId,
    userId,
    action: "customer.updated",
    entityType: "customer",
    entityId: customer.id,
    metadata: { fields: Object.keys(input) }
  });

  return { status: "updated" as const, customer: toApiCustomer(customer) };
}

export async function listCustomerLedger(
  tenantId: string,
  customerId: string,
  branchId?: string,
  filters: { startDate?: Date; endDate?: Date } = {}
) {
  if (useDemoStore) {
    const customer = customers.find((item) => item.tenantId === tenantId && item.id === customerId);

    if (!customer) return { status: "not_found" as const };

    return {
      status: "found" as const,
      entries: customerLedger
        .filter((entry) => entry.tenantId === tenantId && entry.customerId === customerId && (!branchId || entry.branchId === branchId))
        .filter((entry) => (filters.startDate ? new Date(entry.createdAt).getTime() >= filters.startDate.getTime() : true))
        .filter((entry) => (filters.endDate ? new Date(entry.createdAt).getTime() <= filters.endDate.getTime() : true))
    };
  }

  const customer = await prisma.customer.findFirst({ where: { tenantId, id: customerId } });

  if (!customer) return { status: "not_found" as const };

  const createdAt = filters.startDate || filters.endDate
    ? {
        ...(filters.startDate ? { gte: filters.startDate } : {}),
        ...(filters.endDate ? { lte: filters.endDate } : {})
      }
    : undefined;

  const entries = await prisma.customerLedgerEntry.findMany({
    where: { tenantId, customerId, branchId: branchId ? branchId : undefined, createdAt },
    orderBy: { createdAt: "desc" }
  });

  return { status: "found" as const, entries: entries.map(toApiLedgerEntry) };
}

export async function postCustomerLedger(
  tenantId: string,
  branchId: string | undefined,
  userId: string,
  customerId: string,
  input: LedgerInput
) {
  const paymentMethod = input.paymentMethod;
  const isCustomerPayment = input.type === "payment" || input.type === "voucher";
  const cashPaymentAmount = isCustomerPayment && paymentMethod === "cash" ? Math.abs(input.amount) : 0;

  if (useDemoStore) {
    const customer = customers.find((item) => item.tenantId === tenantId && item.id === customerId);

    if (!customer) return { status: "not_found" as const };

    const shift = cashPaymentAmount > 0
      ? registerShifts.find((item) => item.tenantId === tenantId && item.branchId === branchId && item.terminalId === input.terminalId && item.status === "open")
      : undefined;
    if (cashPaymentAmount > 0 && !shift) return { status: "shift_not_found" as const };

    const nextBalance = customer.outstandingBalance + input.amount;
    const nextPoints = customer.loyaltyPoints + input.pointsDelta;

    if (nextBalance > customer.creditLimit) return { status: "credit_limit_exceeded" as const };
    if (nextBalance < 0) return { status: "overpayment" as const };
    if (nextPoints < 0) return { status: "negative_points" as const };

    customer.outstandingBalance = nextBalance;
    customer.loyaltyPoints = nextPoints;
    customer.lastVisitAt = new Date().toISOString();

    const entry = appendCustomerLedger({
      tenantId,
      branchId: branchId!,
      customerId: customer.id,
      type: input.type,
      amount: input.amount,
      pointsDelta: input.pointsDelta,
      balanceAfter: nextBalance,
      pointsAfter: nextPoints,
      note: input.note,
      createdBy: userId
    });

    const movement = shift
      ? appendCashMovement({
          tenantId,
          branchId: shift.branchId,
          shiftId: shift.id,
          type: "cash_in",
          amount: cashPaymentAmount,
          reason: `Customer payment ${customer.name}`,
          createdBy: userId
        })
      : undefined;
    if (shift && movement) {
      shift.expectedCash += cashPaymentAmount;
    }

    appendAudit({
      tenantId,
      branchId,
      userId,
      action: "customer.ledger_posted",
      entityType: "customerLedger",
      entityId: entry.id,
      metadata: { customerId: customer.id, amount: entry.amount, pointsDelta: entry.pointsDelta, paymentMethod, paymentReference: input.paymentReference?.trim() }
    });

    if (movement && shift) {
      appendAudit({
        tenantId,
        branchId: shift.branchId,
        userId,
        action: "register.cash_movement",
        entityType: "cashMovement",
        entityId: movement.id,
        metadata: { type: movement.type, amount: movement.amount, expectedCash: shift.expectedCash, customerId: customer.id, ledgerEntryId: entry.id, source: "customer_payment" }
      });
    }

    return { status: "posted" as const, customer, entry, movement: movement && shift ? { ...movement, expectedCashAfter: shift.expectedCash } : undefined };
  }

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { tenantId, id: customerId } });

    if (!customer) return { status: "not_found" as const };

    const shift = cashPaymentAmount > 0
      ? await tx.registerShift.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, terminalId: input.terminalId, status: "open" } })
      : null;
    if (cashPaymentAmount > 0 && !shift) return { status: "shift_not_found" as const };

    const nextBalance = customer.outstandingBalance + input.amount;
    const nextPoints = customer.loyaltyPoints + input.pointsDelta;

    if (nextBalance > customer.creditLimit) return { status: "credit_limit_exceeded" as const };
    if (nextBalance < 0) return { status: "overpayment" as const };
    if (nextPoints < 0) return { status: "negative_points" as const };

    const [updatedCustomer, entry] = await Promise.all([
      tx.customer.update({
        where: { id: customer.id },
        data: {
          outstandingBalance: nextBalance,
          loyaltyPoints: nextPoints,
          lastVisitAt: new Date()
        }
      }),
      tx.customerLedgerEntry.create({
        data: {
          id: nextLedgerId(),
          tenantId,
          branchId: branchId!,
          customerId: customer.id,
          type: input.type,
          amount: input.amount,
          pointsDelta: input.pointsDelta,
          balanceAfter: nextBalance,
          pointsAfter: nextPoints,
          note: input.note,
          createdBy: userId
        }
      })
    ]);

    let movement: Awaited<ReturnType<typeof tx.cashMovement.create>> | null = null;
    let expectedCashAfter: number | undefined;

    if (shift && cashPaymentAmount > 0) {
      expectedCashAfter = shift.expectedCash + cashPaymentAmount;
      const [createdMovement] = await Promise.all([
        tx.cashMovement.create({
          data: {
            id: nextCashMovementId(),
            tenantId,
            branchId: shift.branchId,
            shiftId: shift.id,
            type: "cash_in",
            amount: cashPaymentAmount,
            reason: `Customer payment ${customer.name}`,
            createdBy: userId
          }
        }),
        tx.registerShift.update({ where: { id: shift.id }, data: { expectedCash: expectedCashAfter } })
      ]);
      movement = createdMovement;
    }

    await tx.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId,
        userId,
        action: "customer.ledger_posted",
        entityType: "customerLedger",
        entityId: entry.id,
        metadata: { customerId: customer.id, amount: entry.amount, pointsDelta: entry.pointsDelta, paymentMethod, paymentReference: input.paymentReference?.trim() }
      }
    });

    if (movement && expectedCashAfter !== undefined) {
      await tx.auditEvent.create({
        data: {
          id: nextAuditId(),
          tenantId,
          branchId: movement.branchId,
          userId,
          action: "register.cash_movement",
          entityType: "cashMovement",
          entityId: movement.id,
          metadata: { type: movement.type, amount: movement.amount, expectedCash: expectedCashAfter, customerId: customer.id, ledgerEntryId: entry.id, source: "customer_payment" }
        }
      });
    }

    return {
      status: "posted" as const,
      customer: toApiCustomer(updatedCustomer),
      entry: toApiLedgerEntry(entry),
      movement: movement && expectedCashAfter !== undefined
        ? {
            id: movement.id,
            tenantId: movement.tenantId,
            branchId: movement.branchId,
            shiftId: movement.shiftId,
            type: movement.type,
            amount: movement.amount,
            reason: movement.reason,
            createdBy: movement.createdBy,
            createdAt: movement.createdAt.toISOString(),
            expectedCashAfter
          }
        : undefined
    };
  });
}

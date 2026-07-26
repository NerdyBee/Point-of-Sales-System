import type { Customer as DbCustomer, CustomerLedgerEntry as DbCustomerLedgerEntry, Prisma } from "@prisma/client";
import { appendAudit, appendCustomerLedger, customerLedger, customers } from "../../shared/data/demoStore";
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
};

function nextCustomerId() {
  return `cust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextLedgerId() {
  return `cust-ledger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

export async function listCustomerLedger(tenantId: string, customerId: string) {
  if (useDemoStore) {
    const customer = customers.find((item) => item.tenantId === tenantId && item.id === customerId);

    if (!customer) return { status: "not_found" as const };

    return {
      status: "found" as const,
      entries: customerLedger.filter((entry) => entry.tenantId === tenantId && entry.customerId === customerId)
    };
  }

  const customer = await prisma.customer.findFirst({ where: { tenantId, id: customerId } });

  if (!customer) return { status: "not_found" as const };

  const entries = await prisma.customerLedgerEntry.findMany({
    where: { tenantId, customerId },
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
  if (useDemoStore) {
    const customer = customers.find((item) => item.tenantId === tenantId && item.id === customerId);

    if (!customer) return { status: "not_found" as const };

    const nextBalance = customer.outstandingBalance + input.amount;
    const nextPoints = customer.loyaltyPoints + input.pointsDelta;

    if (nextBalance > customer.creditLimit) return { status: "credit_limit_exceeded" as const };
    if (nextPoints < 0) return { status: "negative_points" as const };

    customer.outstandingBalance = nextBalance;
    customer.loyaltyPoints = nextPoints;
    customer.lastVisitAt = new Date().toISOString();

    const entry = appendCustomerLedger({
      tenantId,
      customerId: customer.id,
      type: input.type,
      amount: input.amount,
      pointsDelta: input.pointsDelta,
      balanceAfter: nextBalance,
      pointsAfter: nextPoints,
      note: input.note,
      createdBy: userId
    });

    appendAudit({
      tenantId,
      branchId,
      userId,
      action: "customer.ledger_posted",
      entityType: "customerLedger",
      entityId: entry.id,
      metadata: { customerId: customer.id, amount: entry.amount, pointsDelta: entry.pointsDelta }
    });

    return { status: "posted" as const, customer, entry };
  }

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { tenantId, id: customerId } });

    if (!customer) return { status: "not_found" as const };

    const nextBalance = customer.outstandingBalance + input.amount;
    const nextPoints = customer.loyaltyPoints + input.pointsDelta;

    if (nextBalance > customer.creditLimit) return { status: "credit_limit_exceeded" as const };
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

    await tx.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId,
        userId,
        action: "customer.ledger_posted",
        entityType: "customerLedger",
        entityId: entry.id,
        metadata: { customerId: customer.id, amount: entry.amount, pointsDelta: entry.pointsDelta }
      }
    });

    return { status: "posted" as const, customer: toApiCustomer(updatedCustomer), entry: toApiLedgerEntry(entry) };
  });
}

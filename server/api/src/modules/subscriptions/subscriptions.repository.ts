import type { Prisma, SubscriptionInvoice as DbSubscriptionInvoice, TenantSubscription as DbTenantSubscription } from "@prisma/client";
import {
  appendAudit,
  branches,
  demoTenants,
  staffMembers,
  subscriptionInvoices,
  tenantSubscriptions,
  terminals,
  type SubscriptionInvoice,
  type SubscriptionInvoiceStatus,
  type SubscriptionPlan,
  type SubscriptionStatus,
  type TenantSubscription
} from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";

const useDemoStore = process.env.NODE_ENV === "test";

export const planCatalog: Record<SubscriptionPlan, Pick<TenantSubscription, "amount" | "branchLimit" | "userLimit" | "terminalLimit" | "storageGb"> & { features: string[] }> = {
  "Free Trial": {
    amount: 0,
    branchLimit: 1,
    userLimit: 4,
    terminalLimit: 1,
    storageGb: 2,
    features: ["POS terminal", "Basic reports", "Starter records"]
  },
  Starter: {
    amount: 12000,
    branchLimit: 1,
    userLimit: 8,
    terminalLimit: 2,
    storageGb: 8,
    features: ["POS terminal", "Receipts", "Basic reports", "Customers"]
  },
  Business: {
    amount: 25000,
    branchLimit: 3,
    userLimit: 18,
    terminalLimit: 5,
    storageGb: 20,
    features: ["Inventory", "Suppliers", "Registers", "Advanced reports"]
  },
  Professional: {
    amount: 45000,
    branchLimit: 8,
    userLimit: 45,
    terminalLimit: 12,
    storageGb: 50,
    features: ["Multi-branch", "Kitchen display", "Approvals", "Profit reports"]
  },
  Enterprise: {
    amount: 0,
    branchLimit: 999,
    userLimit: 999,
    terminalLimit: 999,
    storageGb: 250,
    features: ["Custom limits", "Priority support", "Integrations", "Deployment support"]
  }
};

type SubscriptionUpdateInput = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  billingEmail: string;
  renewalDate: string;
  graceEndsAt?: string;
  notes?: string;
};

type SubscriptionInvoiceCreateInput = {
  plan: SubscriptionPlan;
  amount?: number;
  status: SubscriptionInvoiceStatus;
  issuedAt: string;
  dueAt: string;
  paymentReference?: string;
};

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextSubscriptionInvoiceNumber(tenantId: string, existingNumbers: string[]) {
  const numericSuffixes = existingNumbers
    .map((invoiceNumber) => Number(invoiceNumber.match(/(\d+)$/)?.[1] ?? 0))
    .filter((value) => Number.isFinite(value));
  const nextNumber = Math.max(1000, ...numericSuffixes) + 1;
  const tenantCode = tenantId.replace(/^tenant-/, "").split("-").map((part) => part[0]?.toUpperCase() ?? "").join("").slice(0, 4) || "TEN";
  return `SUB-${tenantCode}-${nextNumber}`;
}

function toApiSubscription(subscription: DbTenantSubscription): TenantSubscription {
  return {
    id: subscription.id,
    tenantId: subscription.tenantId,
    plan: subscription.plan as SubscriptionPlan,
    status: subscription.status as SubscriptionStatus,
    billingEmail: subscription.billingEmail,
    amount: subscription.amount,
    interval: subscription.interval as TenantSubscription["interval"],
    branchLimit: subscription.branchLimit,
    userLimit: subscription.userLimit,
    terminalLimit: subscription.terminalLimit,
    storageGb: subscription.storageGb,
    renewalDate: subscription.renewalDate.toISOString(),
    trialEndsAt: subscription.trialEndsAt?.toISOString(),
    graceEndsAt: subscription.graceEndsAt?.toISOString(),
    notes: subscription.notes ?? undefined,
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString()
  };
}

function toApiInvoice(invoice: DbSubscriptionInvoice): SubscriptionInvoice {
  return {
    id: invoice.id,
    tenantId: invoice.tenantId,
    invoiceNumber: invoice.invoiceNumber,
    plan: invoice.plan as SubscriptionPlan,
    amount: invoice.amount,
    currency: invoice.currency as SubscriptionInvoice["currency"],
    status: invoice.status as SubscriptionInvoiceStatus,
    issuedAt: invoice.issuedAt.toISOString(),
    dueAt: invoice.dueAt.toISOString(),
    paidAt: invoice.paidAt?.toISOString(),
    paymentReference: invoice.paymentReference ?? undefined,
    createdAt: invoice.createdAt.toISOString()
  };
}

async function appendSubscriptionAudit(event: Parameters<typeof appendAudit>[0]) {
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

async function getSubscriptionUsage(tenantId: string) {
  if (useDemoStore) {
    return {
      branches: branches.filter((branch) => branch.tenantId === tenantId && branch.status === "active").length,
      users: staffMembers.filter((member) => member.tenantId === tenantId && member.inviteStatus !== "revoked").length,
      terminals: terminals.filter((terminal) => terminal.tenantId === tenantId).length
    };
  }

  const [activeBranches, billableUsers, tenantTerminals] = await Promise.all([
    prisma.branch.count({ where: { tenantId, status: "active" } }),
    prisma.staffMember.count({ where: { tenantId, inviteStatus: { not: "revoked" } } }),
    prisma.terminal.count({ where: { tenantId } })
  ]);

  return {
    branches: activeBranches,
    users: billableUsers,
    terminals: tenantTerminals
  };
}

export async function getSubscriptionOverview(tenantId: string) {
  const plans = Object.entries(planCatalog).map(([plan, limits]) => ({ plan: plan as SubscriptionPlan, ...limits }));
  const usage = await getSubscriptionUsage(tenantId);

  if (useDemoStore) {
    const subscription = tenantSubscriptions.find((item) => item.tenantId === tenantId) ?? null;
    const invoices = subscriptionInvoices.filter((invoice) => invoice.tenantId === tenantId);
    return { subscription, invoices, plans, usage };
  }

  const [subscription, invoices] = await Promise.all([
    prisma.tenantSubscription.findUnique({ where: { tenantId } }),
    prisma.subscriptionInvoice.findMany({ where: { tenantId }, orderBy: { issuedAt: "desc" } })
  ]);

  if (!subscription) {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, plan: true, branchLimit: true } });
    const tenantPlan = tenant?.plan as SubscriptionPlan | undefined;
    const plan = tenantPlan && tenantPlan in planCatalog ? tenantPlan : "Professional";
    const limits = planCatalog[plan];
    const now = new Date().toISOString();

    return {
      subscription: tenant ? {
        id: `sub-${tenant.id}`,
        tenantId: tenant.id,
        plan,
        status: "active" as SubscriptionStatus,
        billingEmail: `billing@${tenant.id.replace(/^tenant-/, "")}.local`,
        amount: limits.amount,
        interval: "monthly" as const,
        branchLimit: tenant.branchLimit || limits.branchLimit,
        userLimit: limits.userLimit,
        terminalLimit: limits.terminalLimit,
        storageGb: limits.storageGb,
        renewalDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        createdAt: now,
        updatedAt: now
      } : null,
      invoices: invoices.map(toApiInvoice),
      plans,
      usage
    };
  }

  return {
    subscription: toApiSubscription(subscription),
    invoices: invoices.map(toApiInvoice),
    plans,
    usage
  };
}

export async function updateTenantSubscription(tenantId: string, userId: string, input: SubscriptionUpdateInput) {
  const planLimits = planCatalog[input.plan];
  const now = new Date().toISOString();

  if (useDemoStore) {
    let subscription = tenantSubscriptions.find((item) => item.tenantId === tenantId);

    if (!subscription) {
      subscription = {
        id: `sub-${tenantId}`,
        tenantId,
        plan: input.plan,
        status: input.status,
        billingEmail: input.billingEmail,
        amount: planLimits.amount,
        interval: "monthly",
        branchLimit: planLimits.branchLimit,
        userLimit: planLimits.userLimit,
        terminalLimit: planLimits.terminalLimit,
        storageGb: planLimits.storageGb,
        renewalDate: input.renewalDate,
        graceEndsAt: input.graceEndsAt || undefined,
        notes: input.notes || undefined,
        createdAt: now,
        updatedAt: now
      };
      tenantSubscriptions.unshift(subscription);
    } else {
      Object.assign(subscription, {
        plan: input.plan,
        status: input.status,
        billingEmail: input.billingEmail,
        amount: planLimits.amount,
        branchLimit: planLimits.branchLimit,
        userLimit: planLimits.userLimit,
        terminalLimit: planLimits.terminalLimit,
        storageGb: planLimits.storageGb,
        renewalDate: input.renewalDate,
        graceEndsAt: input.graceEndsAt || undefined,
        notes: input.notes || undefined,
        updatedAt: now
      });
    }

    const tenant = demoTenants.find((item) => item.id === tenantId);
    if (tenant) {
      tenant.plan = input.plan;
      tenant.branchLimit = planLimits.branchLimit;
    }

    await appendSubscriptionAudit({
      tenantId,
      userId,
      action: "subscription.updated",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: { plan: input.plan, status: input.status, branchLimit: planLimits.branchLimit }
    });

    return { status: "updated" as const, subscription };
  }

  const subscription = await prisma.$transaction(async (tx) => {
    const record = await tx.tenantSubscription.upsert({
      where: { tenantId },
      create: {
        id: `sub-${tenantId}`,
        tenantId,
        plan: input.plan,
        status: input.status,
        billingEmail: input.billingEmail,
        amount: planLimits.amount,
        interval: "monthly",
        branchLimit: planLimits.branchLimit,
        userLimit: planLimits.userLimit,
        terminalLimit: planLimits.terminalLimit,
        storageGb: planLimits.storageGb,
        renewalDate: new Date(input.renewalDate),
        graceEndsAt: input.graceEndsAt ? new Date(input.graceEndsAt) : null,
        notes: input.notes || null
      },
      update: {
        plan: input.plan,
        status: input.status,
        billingEmail: input.billingEmail,
        amount: planLimits.amount,
        branchLimit: planLimits.branchLimit,
        userLimit: planLimits.userLimit,
        terminalLimit: planLimits.terminalLimit,
        storageGb: planLimits.storageGb,
        renewalDate: new Date(input.renewalDate),
        graceEndsAt: input.graceEndsAt ? new Date(input.graceEndsAt) : null,
        notes: input.notes || null
      }
    });

    await tx.tenant.update({
      where: { id: tenantId },
      data: { plan: input.plan, branchLimit: planLimits.branchLimit }
    });

    return record;
  });

  await appendSubscriptionAudit({
    tenantId,
    userId,
    action: "subscription.updated",
    entityType: "subscription",
    entityId: subscription.id,
    metadata: { plan: input.plan, status: input.status, branchLimit: planLimits.branchLimit }
  });

  return { status: "updated" as const, subscription: toApiSubscription(subscription) };
}

export async function createSubscriptionInvoice(tenantId: string, userId: string, input: SubscriptionInvoiceCreateInput) {
  const planLimits = planCatalog[input.plan];
  const amount = input.amount ?? planLimits.amount;
  const now = new Date().toISOString();

  if (useDemoStore) {
    const invoice: SubscriptionInvoice = {
      id: `sub-inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      invoiceNumber: nextSubscriptionInvoiceNumber(tenantId, subscriptionInvoices.filter((item) => item.tenantId === tenantId).map((item) => item.invoiceNumber)),
      plan: input.plan,
      amount,
      currency: "NGN",
      status: input.status,
      issuedAt: input.issuedAt,
      dueAt: input.dueAt,
      paidAt: input.status === "paid" ? now : undefined,
      paymentReference: input.paymentReference?.trim() || undefined,
      createdAt: now
    };
    subscriptionInvoices.unshift(invoice);

    await appendSubscriptionAudit({
      tenantId,
      userId,
      action: "subscription.invoice_created",
      entityType: "subscription_invoice",
      entityId: invoice.id,
      metadata: { invoiceNumber: invoice.invoiceNumber, plan: invoice.plan, amount: invoice.amount, status: invoice.status }
    });

    return { status: "created" as const, invoice };
  }

  const existingInvoices = await prisma.subscriptionInvoice.findMany({
    where: { tenantId },
    select: { invoiceNumber: true }
  });
  const invoice = await prisma.subscriptionInvoice.create({
    data: {
      id: `sub-inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      invoiceNumber: nextSubscriptionInvoiceNumber(tenantId, existingInvoices.map((item) => item.invoiceNumber)),
      plan: input.plan,
      amount,
      currency: "NGN",
      status: input.status,
      issuedAt: new Date(input.issuedAt),
      dueAt: new Date(input.dueAt),
      paidAt: input.status === "paid" ? new Date() : null,
      paymentReference: input.paymentReference?.trim() || null
    }
  });

  await appendSubscriptionAudit({
    tenantId,
    userId,
    action: "subscription.invoice_created",
    entityType: "subscription_invoice",
    entityId: invoice.id,
    metadata: { invoiceNumber: invoice.invoiceNumber, plan: invoice.plan, amount: invoice.amount, status: invoice.status }
  });

  return { status: "created" as const, invoice: toApiInvoice(invoice) };
}

export async function updateSubscriptionInvoiceStatus(tenantId: string, userId: string, invoiceId: string, status: SubscriptionInvoiceStatus, paymentReference?: string) {
  if (useDemoStore) {
    const invoice = subscriptionInvoices.find((item) => item.tenantId === tenantId && item.id === invoiceId);
    if (!invoice) return { status: "not_found" as const };
    if ((invoice.status === "paid" || invoice.status === "void") && invoice.status !== status) return { status: "finalized" as const };

    invoice.status = status;
    invoice.paymentReference = paymentReference?.trim() || invoice.paymentReference;
    invoice.paidAt = status === "paid" ? new Date().toISOString() : invoice.paidAt;

    await appendSubscriptionAudit({
      tenantId,
      userId,
      action: "subscription.invoice_updated",
      entityType: "subscription_invoice",
      entityId: invoice.id,
      metadata: { status, paymentReference }
    });

    return { status: "updated" as const, invoice };
  }

  const existing = await prisma.subscriptionInvoice.findFirst({ where: { tenantId, id: invoiceId } });
  if (!existing) return { status: "not_found" as const };
  if ((existing.status === "paid" || existing.status === "void") && existing.status !== status) return { status: "finalized" as const };

  const invoice = await prisma.subscriptionInvoice.update({
    where: { id: existing.id },
    data: {
      status,
      paymentReference: paymentReference?.trim() || existing.paymentReference,
      paidAt: status === "paid" ? new Date() : existing.paidAt
    }
  });

  await appendSubscriptionAudit({
    tenantId,
    userId,
    action: "subscription.invoice_updated",
    entityType: "subscription_invoice",
    entityId: invoice.id,
    metadata: { status, paymentReference }
  });

  return { status: "updated" as const, invoice: toApiInvoice(invoice) };
}

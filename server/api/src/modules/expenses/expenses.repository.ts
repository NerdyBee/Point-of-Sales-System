import type { Expense as DbExpense, Prisma } from "@prisma/client";
import { appendAudit, branches, expenses } from "../../shared/data/demoStore";
import type { Expense } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";

const useDemoStore = process.env.NODE_ENV === "test";

type ExpenseInput = Pick<Expense, "branchId" | "category" | "description" | "vendor" | "amount" | "paymentMethod" | "reference" | "status" | "spentAt" | "note">;
type ExpenseStatus = Expense["status"];
type ExpenseAuditAction = "expense.approved" | "expense.paid" | "expense.rejected" | "expense.voided";

function nextExpenseId() {
  return `expense-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

function toApiExpense(expense: DbExpense): Expense {
  return {
    id: expense.id,
    tenantId: expense.tenantId,
    branchId: expense.branchId,
    category: expense.category,
    description: expense.description,
    vendor: expense.vendor ?? undefined,
    amount: expense.amount,
    paymentMethod: expense.paymentMethod as Expense["paymentMethod"],
    reference: expense.reference ?? undefined,
    status: expense.status as ExpenseStatus,
    spentAt: expense.spentAt.toISOString(),
    approvedBy: expense.approvedBy ?? undefined,
    approvedAt: expense.approvedAt?.toISOString(),
    paidAt: expense.paidAt?.toISOString(),
    note: expense.note ?? undefined,
    createdBy: expense.createdBy,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString()
  };
}

function auditActionForStatus(status: Extract<ExpenseStatus, "approved" | "paid" | "rejected" | "voided">): ExpenseAuditAction {
  if (status === "paid") return "expense.paid";
  if (status === "rejected") return "expense.rejected";
  if (status === "voided") return "expense.voided";
  return "expense.approved";
}

async function appendExpenseAudit(event: Parameters<typeof appendAudit>[0]) {
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

export async function listExpenses(
  tenantId: string,
  filters: { branchId?: string; status?: string; startDate?: Date; endDate?: Date }
) {
  if (useDemoStore) {
    return expenses
      .filter((expense) => expense.tenantId === tenantId)
      .filter((expense) => !filters.branchId || expense.branchId === filters.branchId)
      .filter((expense) => !filters.status || filters.status === "all" || expense.status === filters.status)
      .filter((expense) => (filters.startDate ? new Date(expense.spentAt).getTime() >= filters.startDate.getTime() : true))
      .filter((expense) => (filters.endDate ? new Date(expense.spentAt).getTime() <= filters.endDate.getTime() : true));
  }

  const spentAt = filters.startDate || filters.endDate
    ? {
        ...(filters.startDate ? { gte: filters.startDate } : {}),
        ...(filters.endDate ? { lte: filters.endDate } : {})
      }
    : undefined;

  const records = await prisma.expense.findMany({
    where: {
      tenantId,
      branchId: filters.branchId ? filters.branchId : undefined,
      status: filters.status && filters.status !== "all" ? filters.status : undefined,
      spentAt
    },
    orderBy: { spentAt: "desc" }
  });

  return records.map(toApiExpense);
}

export async function createExpense(tenantId: string, userId: string, input: ExpenseInput) {
  if (!(await branchBelongsToTenant(tenantId, input.branchId))) {
    return { status: "branch_not_found" as const };
  }

  const now = new Date().toISOString();
  const approvalStatus = input.amount >= 50000 && input.status === "paid" ? "pending_approval" : input.status;

  if (useDemoStore) {
    const expense: Expense = {
      id: nextExpenseId(),
      tenantId,
      ...input,
      status: approvalStatus,
      approvedBy: approvalStatus === "approved" || approvalStatus === "paid" ? userId : undefined,
      approvedAt: approvalStatus === "approved" || approvalStatus === "paid" ? now : undefined,
      paidAt: approvalStatus === "paid" ? now : undefined,
      createdBy: userId,
      createdAt: now,
      updatedAt: now
    };

    expenses.unshift(expense);
    await appendExpenseAudit({
      tenantId,
      branchId: expense.branchId,
      userId,
      action: "expense.created",
      entityType: "expense",
      entityId: expense.id,
      metadata: { category: expense.category, amount: expense.amount, status: expense.status }
    });
    return { status: "created" as const, expense };
  }

  const record = await prisma.expense.create({
    data: {
      id: nextExpenseId(),
      tenantId,
      ...input,
      status: approvalStatus,
      vendor: input.vendor || null,
      reference: input.reference || null,
      note: input.note || null,
      spentAt: new Date(input.spentAt),
      approvedBy: approvalStatus === "approved" || approvalStatus === "paid" ? userId : null,
      approvedAt: approvalStatus === "approved" || approvalStatus === "paid" ? new Date() : null,
      paidAt: approvalStatus === "paid" ? new Date() : null,
      createdBy: userId
    }
  });

  await appendExpenseAudit({
    tenantId,
    branchId: record.branchId,
    userId,
    action: "expense.created",
    entityType: "expense",
    entityId: record.id,
    metadata: { category: record.category, amount: record.amount, status: record.status }
  });

  return { status: "created" as const, expense: toApiExpense(record) };
}

export async function updateExpenseStatus(
  tenantId: string,
  userId: string,
  expenseId: string,
  status: Extract<ExpenseStatus, "approved" | "paid" | "rejected" | "voided">,
  note?: string,
  branchId?: string
) {
  if (useDemoStore) {
    const expense = expenses.find((item) => item.tenantId === tenantId && item.id === expenseId && (!branchId || item.branchId === branchId));
    if (!expense) return { status: "not_found" as const };
    if (expense.status === "voided") return { status: "already_voided" as const };

    expense.status = status;
    expense.note = note || expense.note;
    expense.updatedAt = new Date().toISOString();
    if (status === "approved" || status === "paid") {
      expense.approvedBy = userId;
      expense.approvedAt = expense.approvedAt ?? new Date().toISOString();
    }
    if (status === "paid") expense.paidAt = new Date().toISOString();

    await appendExpenseAudit({
      tenantId,
      branchId: expense.branchId,
      userId,
      action: auditActionForStatus(status),
      entityType: "expense",
      entityId: expense.id,
      metadata: { status, amount: expense.amount, note }
    });
    return { status: "updated" as const, expense };
  }

  const existing = await prisma.expense.findFirst({ where: { tenantId, id: expenseId, branchId } });
  if (!existing) return { status: "not_found" as const };
  if (existing.status === "voided") return { status: "already_voided" as const };

  const record = await prisma.expense.update({
    where: { id: existing.id },
    data: {
      status,
      note: note || existing.note,
      approvedBy: status === "approved" || status === "paid" ? userId : existing.approvedBy,
      approvedAt: status === "approved" || status === "paid" ? existing.approvedAt ?? new Date() : existing.approvedAt,
      paidAt: status === "paid" ? new Date() : existing.paidAt
    }
  });

  await appendExpenseAudit({
    tenantId,
    branchId: record.branchId,
    userId,
    action: auditActionForStatus(status),
    entityType: "expense",
    entityId: record.id,
    metadata: { status, amount: record.amount, note }
  });
  return { status: "updated" as const, expense: toApiExpense(record) };
}

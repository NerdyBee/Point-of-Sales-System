import type {
  CashMovement as DbCashMovement,
  PaymentRecord as DbPaymentRecord,
  RegisterShift as DbRegisterShift
} from "@prisma/client";
import { appendAudit, appendCashMovement, branches, cashMovements, paymentRecords, registerShifts, terminals } from "../../shared/data/demoStore";
import type { CashMovement, PaymentRecord, RegisterShift } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";

const useDemoStore = process.env.NODE_ENV === "test";

function nextShiftId() {
  return `shift-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextCashMovementId() {
  return `cash-move-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toApiShift(shift: DbRegisterShift): RegisterShift {
  return {
    id: shift.id,
    tenantId: shift.tenantId,
    branchId: shift.branchId,
    terminalId: shift.terminalId,
    cashierId: shift.cashierId,
    status: shift.status as RegisterShift["status"],
    openingBalance: shift.openingBalance,
    expectedCash: shift.expectedCash,
    countedCash: shift.countedCash ?? undefined,
    variance: shift.variance ?? undefined,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt?.toISOString(),
    managerNote: shift.managerNote ?? undefined
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

function toApiMovement(movement: DbCashMovement): CashMovement {
  return {
    id: movement.id,
    tenantId: movement.tenantId,
    branchId: movement.branchId,
    shiftId: movement.shiftId,
    type: movement.type as CashMovement["type"],
    amount: movement.amount,
    reason: movement.reason,
    createdBy: movement.createdBy,
    createdAt: movement.createdAt.toISOString()
  };
}

async function validateOpenRegisterTerminal(tenantId: string, branchId: string, terminalId: string) {
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

export async function getCurrentRegister(tenantId: string, branchId: string | undefined, terminalId?: string, cashierId?: string) {
  if (useDemoStore) {
    const shift = registerShifts.find(
      (item) =>
        item.tenantId === tenantId &&
        item.branchId === branchId &&
        (!terminalId || item.terminalId === terminalId) &&
        (!cashierId || item.cashierId === cashierId) &&
        item.status === "open"
    );

    return {
      shift: shift ?? null,
      payments: shift ? paymentRecords.filter((payment) => payment.shiftId === shift.id) : [],
      movements: shift ? cashMovements.filter((movement) => movement.shiftId === shift.id) : []
    };
  }

  const shift = await prisma.registerShift.findFirst({
    where: {
      tenantId,
      branchId,
      terminalId: terminalId ? terminalId : undefined,
      cashierId: cashierId ? cashierId : undefined,
      status: "open"
    },
    orderBy: { openedAt: "desc" }
  });

  if (!shift) {
    return { shift: null, payments: [], movements: [] };
  }

  const [payments, movements] = await Promise.all([
    prisma.paymentRecord.findMany({ where: { shiftId: shift.id }, orderBy: { createdAt: "desc" } }),
    prisma.cashMovement.findMany({ where: { shiftId: shift.id }, orderBy: { createdAt: "desc" } })
  ]);

  return {
    shift: toApiShift(shift),
    payments: payments.map(toApiPayment),
    movements: movements.map(toApiMovement)
  };
}

export async function openRegisterShift(
  tenantId: string,
  userId: string,
  input: { branchId: string; terminalId: string; openingBalance: number }
) {
  const terminalValidation = await validateOpenRegisterTerminal(tenantId, input.branchId, input.terminalId);
  if (terminalValidation.status !== "valid") return terminalValidation;

  if (useDemoStore) {
    const existingShift = registerShifts.find(
      (shift) =>
        shift.tenantId === tenantId &&
        shift.branchId === input.branchId &&
        shift.terminalId === input.terminalId &&
        shift.status === "open"
    );

    if (existingShift) return { status: "already_open" as const };

    const shift = {
      id: `shift-${registerShifts.length + 1}`,
      tenantId,
      branchId: input.branchId,
      terminalId: input.terminalId,
      cashierId: userId,
      status: "open" as const,
      openingBalance: input.openingBalance,
      expectedCash: input.openingBalance,
      openedAt: new Date().toISOString()
    };

    registerShifts.unshift(shift);
    appendAudit({
      tenantId,
      branchId: shift.branchId,
      userId,
      action: "register.opened",
      entityType: "registerShift",
      entityId: shift.id,
      metadata: { terminalId: shift.terminalId, openingBalance: shift.openingBalance }
    });

    return { status: "opened" as const, shift };
  }

  const existingShift = await prisma.registerShift.findFirst({
    where: { tenantId, branchId: input.branchId, terminalId: input.terminalId, status: "open" }
  });

  if (existingShift) return { status: "already_open" as const };

  const result = await prisma.$transaction(async (tx) => {
    const shift = await tx.registerShift.create({
      data: {
        id: nextShiftId(),
        tenantId,
        branchId: input.branchId,
        terminalId: input.terminalId,
        cashierId: userId,
        status: "open",
        openingBalance: input.openingBalance,
        expectedCash: input.openingBalance,
        openedAt: new Date()
      }
    });

    await tx.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId: shift.branchId,
        userId,
        action: "register.opened",
        entityType: "registerShift",
        entityId: shift.id,
        metadata: { terminalId: shift.terminalId, openingBalance: shift.openingBalance }
      }
    });

    return toApiShift(shift);
  });

  return { status: "opened" as const, shift: result };
}

export async function createCashMovement(
  tenantId: string,
  branchId: string | undefined,
  userId: string,
  input: { shiftId: string; type: CashMovement["type"]; amount: number; reason: string }
) {
  if (useDemoStore) {
    const shift = registerShifts.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === input.shiftId);

    if (!shift || shift.status !== "open") return { status: "shift_not_found" as const };

    const signedAmount = input.type === "cash_in" || input.type === "paid_in" ? input.amount : -input.amount;
    const nextExpectedCash = shift.expectedCash + signedAmount;

    if (nextExpectedCash < 0) return { status: "negative_cash" as const };

    shift.expectedCash = nextExpectedCash;
    const movement = appendCashMovement({
      tenantId,
      branchId: shift.branchId,
      shiftId: shift.id,
      type: input.type,
      amount: input.amount,
      reason: input.reason,
      createdBy: userId
    });

    appendAudit({
      tenantId,
      branchId: shift.branchId,
      userId,
      action: "register.cash_movement",
      entityType: "cashMovement",
      entityId: movement.id,
      metadata: { type: movement.type, amount: movement.amount, expectedCash: shift.expectedCash }
    });

    return { status: "created" as const, shift, movement };
  }

  return prisma.$transaction(async (tx) => {
    const shift = await tx.registerShift.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: input.shiftId } });

    if (!shift || shift.status !== "open") return { status: "shift_not_found" as const };

    const signedAmount = input.type === "cash_in" || input.type === "paid_in" ? input.amount : -input.amount;
    const nextExpectedCash = shift.expectedCash + signedAmount;

    if (nextExpectedCash < 0) return { status: "negative_cash" as const };

    const [updatedShift, movement] = await Promise.all([
      tx.registerShift.update({ where: { id: shift.id }, data: { expectedCash: nextExpectedCash } }),
      tx.cashMovement.create({
        data: {
          id: nextCashMovementId(),
          tenantId,
          branchId: shift.branchId,
          shiftId: shift.id,
          type: input.type,
          amount: input.amount,
          reason: input.reason,
          createdBy: userId
        }
      })
    ]);

    await tx.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId: shift.branchId,
        userId,
        action: "register.cash_movement",
        entityType: "cashMovement",
        entityId: movement.id,
        metadata: { type: movement.type, amount: movement.amount, expectedCash: nextExpectedCash }
      }
    });

    return { status: "created" as const, shift: toApiShift(updatedShift), movement: toApiMovement(movement) };
  });
}

export async function reconcilePayment(tenantId: string, branchId: string | undefined, userId: string, paymentId: string, note?: string) {
  if (useDemoStore) {
    const payment = paymentRecords.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === paymentId);

    if (!payment) return { status: "payment_not_found" as const };

    const shift = registerShifts.find((item) => item.tenantId === tenantId && item.id === payment.shiftId);

    if (!shift || shift.status !== "open") return { status: "shift_closed" as const };
    if (payment.reconciliationStatus === "matched") return { status: "already_reconciled" as const };

    payment.reconciliationStatus = "matched";
    appendAudit({
      tenantId,
      branchId: payment.branchId,
      userId,
      action: "register.payment_reconciled",
      entityType: "payment",
      entityId: payment.id,
      metadata: { saleId: payment.saleId, shiftId: payment.shiftId, method: payment.method, amount: payment.amount, note }
    });

    return { status: "reconciled" as const, payment };
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.paymentRecord.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: paymentId } });

    if (!payment) return { status: "payment_not_found" as const };

    const shift = await tx.registerShift.findFirst({ where: { tenantId, id: payment.shiftId } });

    if (!shift || shift.status !== "open") return { status: "shift_closed" as const };
    if (payment.reconciliationStatus === "matched") return { status: "already_reconciled" as const };

    const updatedPayment = await tx.paymentRecord.update({
      where: { id: payment.id },
      data: { reconciliationStatus: "matched" }
    });

    await tx.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId: payment.branchId,
        userId,
        action: "register.payment_reconciled",
        entityType: "payment",
        entityId: payment.id,
        metadata: { saleId: payment.saleId, shiftId: payment.shiftId, method: payment.method, amount: payment.amount, note }
      }
    });

    return { status: "reconciled" as const, payment: toApiPayment(updatedPayment) };
  });
}

export async function closeRegisterShift(
  tenantId: string,
  branchId: string | undefined,
  userId: string,
  input: { shiftId: string; countedCash: number; managerNote?: string }
) {
  if (useDemoStore) {
    const shift = registerShifts.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === input.shiftId);

    if (!shift || shift.status !== "open") return { status: "shift_not_found" as const };
    const hasPendingPayments = paymentRecords.some((payment) => payment.tenantId === tenantId && payment.shiftId === shift.id && payment.method !== "cash" && payment.reconciliationStatus === "pending");
    if (hasPendingPayments) return { status: "pending_payments" as const };

    shift.status = "closed";
    shift.countedCash = input.countedCash;
    shift.variance = input.countedCash - shift.expectedCash;
    shift.closedAt = new Date().toISOString();
    shift.managerNote = input.managerNote;

    appendAudit({
      tenantId,
      branchId: shift.branchId,
      userId,
      action: "register.closed",
      entityType: "registerShift",
      entityId: shift.id,
      metadata: { expectedCash: shift.expectedCash, countedCash: shift.countedCash, variance: shift.variance }
    });

    return { status: "closed" as const, shift };
  }

  return prisma.$transaction(async (tx) => {
    const shift = await tx.registerShift.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: input.shiftId } });

    if (!shift || shift.status !== "open") return { status: "shift_not_found" as const };
    const pendingPayments = await tx.paymentRecord.count({
      where: {
        tenantId,
        shiftId: shift.id,
        method: { not: "cash" },
        reconciliationStatus: "pending"
      }
    });
    if (pendingPayments > 0) return { status: "pending_payments" as const };

    const variance = input.countedCash - shift.expectedCash;
    const updatedShift = await tx.registerShift.update({
      where: { id: shift.id },
      data: {
        status: "closed",
        countedCash: input.countedCash,
        variance,
        closedAt: new Date(),
        managerNote: input.managerNote
      }
    });

    await tx.auditEvent.create({
      data: {
        id: nextAuditId(),
        tenantId,
        branchId: shift.branchId,
        userId,
        action: "register.closed",
        entityType: "registerShift",
        entityId: shift.id,
        metadata: { expectedCash: shift.expectedCash, countedCash: input.countedCash, variance }
      }
    });

    return { status: "closed" as const, shift: toApiShift(updatedShift) };
  });
}

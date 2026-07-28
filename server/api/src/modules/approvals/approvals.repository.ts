import type { ApprovalRequest as DbApprovalRequest, Prisma } from "@prisma/client";
import { appendApprovalRequest, appendAudit, approvalRequests, branches } from "../../shared/data/demoStore";
import type { ApprovalRequest } from "../../shared/data/demoStore";
import type { TenantContext } from "../../shared/http/tenantContext";
import { prisma } from "../../shared/db/prisma";

const useDemoStore = process.env.NODE_ENV === "test";

type ApprovalRequestInput = Omit<ApprovalRequest, "id" | "tenantId" | "status" | "createdAt" | "decidedBy" | "decidedAt" | "decisionNote">;
type ApprovalDecisionInput = { decision: "approved" | "rejected"; note: string };
type ApprovalApplyInput = {
  entityType: string;
  entityId: string;
  type: ApprovalRequest["type"];
  amount: number;
  note: string;
};
type AppliedApprovalInput = {
  branchId: string;
  entityType: string;
  entityId: string;
  type: ApprovalRequest["type"];
  amount: number;
};

function requiresManagerApplication(input: ApprovalApplyInput) {
  if (input.type === "register_close" || input.type === "refund") return true;
  return input.type === "void" && input.entityType === "sale";
}

function nextApprovalId() {
  return `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextAuditId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toApiApproval(approval: DbApprovalRequest): ApprovalRequest {
  return {
    id: approval.id,
    tenantId: approval.tenantId,
    branchId: approval.branchId,
    type: approval.type as ApprovalRequest["type"],
    entityType: approval.entityType,
    entityId: approval.entityId,
    amount: approval.amount,
    reason: approval.reason,
    status: approval.status as ApprovalRequest["status"],
    requestedBy: approval.requestedBy,
    decidedBy: approval.decidedBy ?? undefined,
    decidedAt: approval.decidedAt?.toISOString(),
    decisionNote: approval.decisionNote ?? undefined,
    createdAt: approval.createdAt.toISOString()
  };
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

async function appendApprovalAudit(tx: Prisma.TransactionClient, event: Parameters<typeof appendAudit>[0]) {
  await tx.auditEvent.create({
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

export async function listApprovals(tenantId: string, filters: { branchId?: string; status?: string; type?: string }) {
  const status = filters.status ?? "all";
  const type = filters.type ?? "all";

  if (useDemoStore) {
    return approvalRequests
      .filter((approval) => approval.tenantId === tenantId)
      .filter((approval) => (filters.branchId ? approval.branchId === filters.branchId : true))
      .filter((approval) => (status === "all" ? true : approval.status === status))
      .filter((approval) => (type === "all" ? true : approval.type === type));
  }

  const approvals = await prisma.approvalRequest.findMany({
    where: {
      tenantId,
      branchId: filters.branchId ? filters.branchId : undefined,
      status: status === "all" ? undefined : status,
      type: type === "all" ? undefined : type
    },
    orderBy: { createdAt: "desc" }
  });

  return approvals.map(toApiApproval);
}

export async function requestApproval(tenantId: string, userId: string, input: ApprovalRequestInput) {
  if (!(await branchBelongsToTenant(tenantId, input.branchId))) {
    return { status: "branch_not_found" as const };
  }

  if (useDemoStore) {
    const approval = appendApprovalRequest({
      tenantId,
      branchId: input.branchId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      amount: input.amount,
      reason: input.reason,
      requestedBy: userId
    });

    appendAudit({
      tenantId,
      branchId: approval.branchId,
      userId,
      action: "approval.requested",
      entityType: "approval",
      entityId: approval.id,
      metadata: { type: approval.type, entityType: approval.entityType, entityId: approval.entityId, amount: approval.amount }
    });

    return { status: "created" as const, approval };
  }

  const approval = await prisma.$transaction(async (tx) => {
    const approval = await tx.approvalRequest.create({
      data: {
        id: nextApprovalId(),
        tenantId,
        branchId: input.branchId,
        type: input.type,
        entityType: input.entityType,
        entityId: input.entityId,
        amount: input.amount,
        reason: input.reason,
        status: "pending",
        requestedBy: userId
      }
    });

    await appendApprovalAudit(tx, {
      tenantId,
      branchId: approval.branchId,
      userId,
      action: "approval.requested",
      entityType: "approval",
      entityId: approval.id,
      metadata: { type: approval.type, entityType: approval.entityType, entityId: approval.entityId, amount: approval.amount }
    });

    return toApiApproval(approval);
  });

  return { status: "created" as const, approval };
}

export async function decideApproval(tenantId: string, branchId: string | undefined, userId: string, approvalId: string, input: ApprovalDecisionInput) {
  if (useDemoStore) {
    const approval = approvalRequests.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === approvalId);

    if (!approval) return { status: "not_found" as const };
    if (approval.status !== "pending") return { status: "already_decided" as const };

    approval.status = input.decision;
    approval.decidedBy = userId;
    approval.decidedAt = new Date().toISOString();
    approval.decisionNote = input.note;
    appendAudit({
      tenantId,
      branchId: approval.branchId,
      userId,
      action: input.decision === "approved" ? "approval.approved" : "approval.rejected",
      entityType: "approval",
      entityId: approval.id,
      metadata: { type: approval.type, entityType: approval.entityType, entityId: approval.entityId, note: input.note }
    });

    return { status: "decided" as const, approval };
  }

  return prisma.$transaction(async (tx) => {
    const approval = await tx.approvalRequest.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: approvalId } });

    if (!approval) return { status: "not_found" as const };
    if (approval.status !== "pending") return { status: "already_decided" as const };

    const updatedApproval = await tx.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: input.decision,
        decidedBy: userId,
        decidedAt: new Date(),
        decisionNote: input.note
      }
    });

    await appendApprovalAudit(tx, {
      tenantId,
      branchId: approval.branchId,
      userId,
      action: input.decision === "approved" ? "approval.approved" : "approval.rejected",
      entityType: "approval",
      entityId: approval.id,
      metadata: { type: approval.type, entityType: approval.entityType, entityId: approval.entityId, note: input.note }
    });

    return { status: "decided" as const, approval: toApiApproval(updatedApproval) };
  });
}

export async function applyApproval(tenantContext: TenantContext, approvalId: string, input: ApprovalApplyInput) {
  if (useDemoStore) {
    const approval = approvalRequests.find(
      (item) => item.tenantId === tenantContext.tenantId && (!tenantContext.branchId || item.branchId === tenantContext.branchId) && item.id === approvalId
    );

    if (!approval) return { status: "not_found" as const };
    if (approval.status !== "approved") return { status: "not_approved" as const };
    if (approval.entityType !== input.entityType || approval.entityId !== input.entityId) return { status: "workflow_mismatch" as const };
    if (approval.type !== input.type || approval.amount < input.amount) return { status: "coverage_mismatch" as const };
    if (requiresManagerApplication(input) && !tenantContext.permissions.includes("approval.manage")) return { status: "forbidden" as const };
    if (approval.requestedBy !== tenantContext.userId && !tenantContext.permissions.includes("approval.manage")) return { status: "forbidden" as const };

    approval.status = "applied";
    approval.decidedAt = approval.decidedAt ?? new Date().toISOString();
    approval.decisionNote = `${approval.decisionNote ?? "Approved"} | Applied: ${input.note}`;
    appendAudit({
      tenantId: tenantContext.tenantId,
      branchId: approval.branchId,
      userId: tenantContext.userId,
      action: "approval.applied",
      entityType: "approval",
      entityId: approval.id,
      metadata: { type: approval.type, entityType: approval.entityType, entityId: approval.entityId, note: input.note }
    });

    return { status: "applied" as const, approval };
  }

  return prisma.$transaction(async (tx) => {
    const approval = await tx.approvalRequest.findFirst({
      where: { tenantId: tenantContext.tenantId, branchId: tenantContext.branchId ? tenantContext.branchId : undefined, id: approvalId }
    });

    if (!approval) return { status: "not_found" as const };
    if (approval.status !== "approved") return { status: "not_approved" as const };
    if (approval.entityType !== input.entityType || approval.entityId !== input.entityId) return { status: "workflow_mismatch" as const };
    if (approval.type !== input.type || approval.amount < input.amount) return { status: "coverage_mismatch" as const };
    if (requiresManagerApplication(input) && !tenantContext.permissions.includes("approval.manage")) return { status: "forbidden" as const };
    if (approval.requestedBy !== tenantContext.userId && !tenantContext.permissions.includes("approval.manage")) return { status: "forbidden" as const };

    const updatedApproval = await tx.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: "applied",
        decidedAt: approval.decidedAt ?? new Date(),
        decisionNote: `${approval.decisionNote ?? "Approved"} | Applied: ${input.note}`
      }
    });

    await appendApprovalAudit(tx, {
      tenantId: tenantContext.tenantId,
      branchId: approval.branchId,
      userId: tenantContext.userId,
      action: "approval.applied",
      entityType: "approval",
      entityId: approval.id,
      metadata: { type: approval.type, entityType: approval.entityType, entityId: approval.entityId, note: input.note }
    });

    return { status: "applied" as const, approval: toApiApproval(updatedApproval) };
  });
}

export async function validateAppliedApproval(tenantId: string, approvalId: string | undefined, input: AppliedApprovalInput) {
  if (!approvalId?.trim()) return { status: "approval_required" as const };

  if (useDemoStore) {
    const approval = approvalRequests.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === approvalId.trim());

    if (!approval) return { status: "approval_not_found" as const };
    if (approval.status !== "applied") return { status: "approval_not_applied" as const };
    if (approval.entityType !== input.entityType || approval.entityId !== input.entityId) return { status: "approval_mismatch" as const };
    if (approval.type !== input.type || approval.amount < input.amount) return { status: "approval_mismatch" as const };

    return { status: "valid" as const, approval };
  }

  const approval = await prisma.approvalRequest.findFirst({
    where: { tenantId, branchId: input.branchId, id: approvalId.trim() }
  });

  if (!approval) return { status: "approval_not_found" as const };
  if (approval.status !== "applied") return { status: "approval_not_applied" as const };
  if (approval.entityType !== input.entityType || approval.entityId !== input.entityId) return { status: "approval_mismatch" as const };
  if (approval.type !== input.type || approval.amount < input.amount) return { status: "approval_mismatch" as const };

  return { status: "valid" as const, approval: toApiApproval(approval) };
}

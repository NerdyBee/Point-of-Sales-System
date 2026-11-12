import type { AuditEvent as DbAuditEvent, Prisma } from "@prisma/client";
import { auditEvents, branches, staffMembers, type AuditEvent } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";

const useDemoStore = process.env.NODE_ENV === "test";

function toApiAuditEvent(event: DbAuditEvent): AuditEvent {
  return {
    id: event.id,
    tenantId: event.tenantId,
    branchId: event.branchId ?? undefined,
    userId: event.userId,
    action: event.action as AuditEvent["action"],
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: event.metadata as Prisma.JsonObject,
    createdAt: event.createdAt.toISOString()
  };
}

/** The audit log as people read it: who and where by name, not by ID. */
export type NamedAuditEvent = AuditEvent & { userName?: string; branchName?: string };

function withNames(events: AuditEvent[], staff: { id: string; name: string }[], branchList: { id: string; name: string }[]): NamedAuditEvent[] {
  const staffNames = new Map(staff.map((member) => [member.id, member.name]));
  const branchNames = new Map(branchList.map((branch) => [branch.id, branch.name]));
  return events.map((event) => ({
    ...event,
    userName: staffNames.get(event.userId),
    branchName: event.branchId ? branchNames.get(event.branchId) : undefined
  }));
}

export async function listAuditEvents(tenantId: string, filters: { branchId?: string; branchIds?: string[]; userId?: string; action?: string; startDate?: Date; endDate?: Date } = {}) {
  if (useDemoStore) {
    const matching = auditEvents
      .filter((event) => event.tenantId === tenantId)
      .filter((event) => !filters.branchId || event.branchId === filters.branchId)
      .filter((event) => !filters.branchIds?.length || !event.branchId || filters.branchIds.includes(event.branchId))
      .filter((event) => !filters.userId || event.userId === filters.userId)
      .filter((event) => !filters.action || event.action === filters.action)
      .filter((event) => !filters.startDate || new Date(event.createdAt).getTime() >= filters.startDate.getTime())
      .filter((event) => !filters.endDate || new Date(event.createdAt).getTime() <= filters.endDate.getTime());
    return withNames(matching, staffMembers.filter((member) => member.tenantId === tenantId), branches.filter((branch) => branch.tenantId === tenantId));
  }

  const events = await prisma.auditEvent.findMany({
    where: {
      tenantId,
      branchId: filters.branchId ? filters.branchId : filters.branchIds?.length ? { in: filters.branchIds } : undefined,
      userId: filters.userId ? filters.userId : undefined,
      action: filters.action ? filters.action : undefined,
      createdAt: filters.startDate || filters.endDate
        ? {
            gte: filters.startDate,
            lte: filters.endDate
          }
        : undefined
    },
    orderBy: { createdAt: "desc" },
    take: 250
  });

  const userIds = [...new Set(events.map((event) => event.userId))];
  const branchIds = [...new Set(events.flatMap((event) => (event.branchId ? [event.branchId] : [])))];
  const [staff, branchList] = await Promise.all([
    prisma.staffMember.findMany({ where: { tenantId, id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.branch.findMany({ where: { tenantId, id: { in: branchIds } }, select: { id: true, name: true } })
  ]);
  return withNames(events.map(toApiAuditEvent), staff, branchList);
}

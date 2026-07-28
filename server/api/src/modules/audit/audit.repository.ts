import type { AuditEvent as DbAuditEvent, Prisma } from "@prisma/client";
import { auditEvents, type AuditEvent } from "../../shared/data/demoStore";
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

export async function listAuditEvents(tenantId: string, filters: { branchId?: string; userId?: string; action?: string } = {}) {
  if (useDemoStore) {
    return auditEvents
      .filter((event) => event.tenantId === tenantId)
      .filter((event) => !filters.branchId || event.branchId === filters.branchId)
      .filter((event) => !filters.userId || event.userId === filters.userId)
      .filter((event) => !filters.action || event.action === filters.action);
  }

  const events = await prisma.auditEvent.findMany({
    where: {
      tenantId,
      branchId: filters.branchId ? filters.branchId : undefined,
      userId: filters.userId ? filters.userId : undefined,
      action: filters.action ? filters.action : undefined
    },
    orderBy: { createdAt: "desc" },
    take: 250
  });

  return events.map(toApiAuditEvent);
}

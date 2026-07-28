import { prepTicketItemStatusUpdateSchema, prepTicketPriorityUpdateSchema, prepTicketStatusUpdateSchema } from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { canAccessAllBranches, resolveBranchScope, requireAuthenticatedUser, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { listPrepTickets, updatePrepTicketItemStatus, updatePrepTicketPriority, updatePrepTicketStatus } from "../restaurant/restaurant.repository";

export const kitchenRouter = Router();

function resolveKitchenBranch(req: Request, res: Response, requestedBranchId?: string) {
  const scope = resolveBranchScope(req.tenantContext!, requestedBranchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !req.tenantContext!.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return null;
  }

  return scope;
}

kitchenRouter.get("/tickets", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const scope = resolveKitchenBranch(req, res, req.query.branchId?.toString());
  if (!scope) return;

  const tickets = await listPrepTickets(req.tenantContext!.tenantId, {
    branchId: scope.branchId,
    station: req.query.station?.toString(),
    status: req.query.status?.toString()
  });

  res.json({ tickets });
});

kitchenRouter.patch("/tickets/:ticketId/status", requireTenant, requirePermission("kitchen.manage"), async (req, res) => {
  const parsed = prepTicketStatusUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ticket status", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveKitchenBranch(req, res, req.tenantContext!.branchId);
  if (!scope) return;

  const result = await updatePrepTicketStatus(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
    req.tenantContext!.userId,
    req.params.ticketId.toString(),
    parsed.data
  );

  if (result.status === "ticket_not_found") {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.json({ ticket: result.ticket });
});

kitchenRouter.patch("/tickets/:ticketId/priority", requireTenant, requirePermission("kitchen.manage"), async (req, res) => {
  const parsed = prepTicketPriorityUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ticket priority", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveKitchenBranch(req, res, req.tenantContext!.branchId);
  if (!scope) return;

  const result = await updatePrepTicketPriority(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
    req.tenantContext!.userId,
    req.params.ticketId.toString(),
    parsed.data
  );

  if (result.status === "ticket_not_found") {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  res.json({ ticket: result.ticket });
});

kitchenRouter.patch("/tickets/:ticketId/items/:itemId/status", requireTenant, requirePermission("kitchen.manage"), async (req, res) => {
  const parsed = prepTicketItemStatusUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ticket item status", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveKitchenBranch(req, res, req.tenantContext!.branchId);
  if (!scope) return;

  const result = await updatePrepTicketItemStatus(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
    req.tenantContext!.userId,
    req.params.ticketId.toString(),
    req.params.itemId.toString(),
    parsed.data
  );

  if (result.status === "ticket_not_found") {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  if (result.status === "item_not_found") {
    res.status(404).json({ error: "Ticket item not found" });
    return;
  }

  res.json({ ticket: result.ticket });
});

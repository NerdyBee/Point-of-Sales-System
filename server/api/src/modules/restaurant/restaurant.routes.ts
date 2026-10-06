import {
  tableBillRequestSchema,
  tableCreateSchema,
  tableLayoutUpdateSchema,
  tableOrderInputSchema,
  tableOrderItemInputSchema,
  tableReservationInputSchema,
  tableReservationStatusSchema,
  tableStateUpdateSchema,
  tableTransferSchema
} from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { canAccessAllBranches, canAccessScopedBranches, resolveBranchScope, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { listStaffOptions } from "../staff/staff.repository";
import {
  addTableOrderItem,
  createReservation,
  createRestaurantTable,
  getFloorState,
  openTableOrder,
  removeTableOrderItem,
  requestTableBill,
  transferTableOrder,
  updateTableLayout,
  updateReservationStatus,
  updateTableState
} from "./restaurant.repository";

export const restaurantRouter = Router();

function requestedBranch(req: Request, bodyBranchId?: string) {
  const requested = bodyBranchId ?? req.query.branchId?.toString() ?? req.header("x-branch-id");
  if (requested) return requested;
  if (canAccessAllBranches(req.tenantContext!) || canAccessScopedBranches(req.tenantContext!)) return undefined;
  return req.tenantContext!.branchId;
}

function resolveScopedBranch(req: Request, res: Response, requestedBranchId?: string) {
  const scope = resolveBranchScope(req.tenantContext!, requestedBranchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !canAccessScopedBranches(req.tenantContext!) && !req.tenantContext!.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return null;
  }

  return scope;
}

function effectiveReadScope(scope: ReturnType<typeof resolveBranchScope>, requestedBranchId?: string) {
  return !requestedBranchId && scope.branchScopeIds?.length ? { ...scope, branchId: undefined, branchIds: scope.branchScopeIds } : { ...scope, branchIds: undefined };
}

restaurantRouter.get("/tables", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const requestedBranchId = req.query.branchId?.toString();
  const scope = resolveScopedBranch(req, res, requestedBranchId);
  if (!scope) return;
  const effectiveScope = effectiveReadScope(scope, requestedBranchId);

  const state = await getFloorState(req.tenantContext!.tenantId, { branchId: effectiveScope.branchId, branchIds: effectiveScope.branchIds });

  res.json(state);
});

restaurantRouter.get("/staff-options", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const requestedBranchId = req.query.branchId?.toString();
  const scope = resolveScopedBranch(req, res, requestedBranchId);
  if (!scope) return;
  const effectiveScope = effectiveReadScope(scope, requestedBranchId);

  const staff = await listStaffOptions(req.tenantContext!.tenantId, { branchId: effectiveScope.branchId, branchIds: effectiveScope.branchIds });
  res.json({ staff });
});

restaurantRouter.post("/reservations", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableReservationInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid reservation", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveScopedBranch(req, res, parsed.data.branchId);
  if (!scope) return;

  const result = await createReservation(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId
  });

  if (result.status === "table_not_found") {
    res.status(404).json({ error: "Table not found" });
    return;
  }

  if (result.status === "too_many_guests") {
    res.status(409).json({ error: "Guest count exceeds table capacity" });
    return;
  }

  if (result.status === "reservation_conflict") {
    res.status(409).json({ error: "Table already has a reservation in that window" });
    return;
  }

  res.status(201).json({ table: result.table, reservation: result.reservation });
});

restaurantRouter.post("/tables", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableCreateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid table", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveScopedBranch(req, res, parsed.data.branchId);
  if (!scope) return;

  const result = await createRestaurantTable(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId
  });

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Table branch not found for this tenant" });
    return;
  }

  if (result.status === "duplicate_label") {
    res.status(409).json({ error: "A table with this label already exists in this branch" });
    return;
  }

  res.status(201).json({ table: result.table });
});

restaurantRouter.patch("/reservations/:reservationId/status", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableReservationStatusSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid reservation status", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveScopedBranch(req, res, requestedBranch(req));
  if (!scope) return;

  const result = await updateReservationStatus(
    req.tenantContext!.tenantId,
    scope.branchId,
    req.tenantContext!.userId,
    req.params.reservationId.toString(),
    parsed.data
  );

  if (result.status === "reservation_not_found") {
    res.status(404).json({ error: "Reservation not found" });
    return;
  }

  if (result.status === "reservation_closed") {
    res.status(409).json({ error: "Reservation is already closed" });
    return;
  }

  res.json({ reservation: result.reservation, table: result.table });
});

restaurantRouter.post("/table-orders", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableOrderInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid table order", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveScopedBranch(req, res, requestedBranch(req));
  if (!scope) return;

  const result = await openTableOrder(req.tenantContext!.tenantId, scope.branchId, req.tenantContext!.userId, parsed.data);

  if (result.status === "table_not_found") {
    res.status(404).json({ error: "Table not found" });
    return;
  }

  if (result.status === "active_order") {
    res.status(409).json({ error: "Table already has an active order" });
    return;
  }

  res.status(201).json({ table: result.table, order: result.order });
});

restaurantRouter.post("/table-orders/:orderId/items", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableOrderItemInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid table order item", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveScopedBranch(req, res, requestedBranch(req));
  if (!scope) return;

  const result = await addTableOrderItem(
    req.tenantContext!.tenantId,
    scope.branchId,
    req.tenantContext!.userId,
    req.params.orderId.toString(),
    parsed.data
  );

  if (result.status === "order_not_found") {
    res.status(404).json({ error: "Open table order not found" });
    return;
  }

  if (result.status === "product_not_found") {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.status(201).json({ order: result.order, item: result.item, prepTicket: result.prepTicket });
});

restaurantRouter.delete("/table-orders/:orderId/items/:itemId", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const scope = resolveScopedBranch(req, res, requestedBranch(req));
  if (!scope) return;

  const result = await removeTableOrderItem(
    req.tenantContext!.tenantId,
    scope.branchId,
    req.tenantContext!.userId,
    req.params.orderId.toString(),
    req.params.itemId.toString()
  );

  if (result.status === "order_not_found") {
    res.status(404).json({ error: "Open table order not found" });
    return;
  }

  if (result.status === "item_not_found") {
    res.status(404).json({ error: "Table order item not found" });
    return;
  }

  res.json({ order: result.order, prepTicket: result.prepTicket });
});

restaurantRouter.patch("/table-orders/:orderId/bill", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableBillRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bill request", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveScopedBranch(req, res, requestedBranch(req));
  if (!scope) return;

  const result = await requestTableBill(req.tenantContext!.tenantId, scope.branchId, req.tenantContext!.userId, req.params.orderId.toString(), parsed.data.note);

  if (result.status === "order_not_found") {
    res.status(404).json({ error: "Open table order not found" });
    return;
  }

  if (result.status === "table_not_found") {
    res.status(404).json({ error: "Table not found" });
    return;
  }

  res.json({ table: result.table, order: result.order });
});

restaurantRouter.patch("/table-orders/:orderId/transfer", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableTransferSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid table transfer", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveScopedBranch(req, res, requestedBranch(req));
  if (!scope) return;

  const result = await transferTableOrder(req.tenantContext!.tenantId, scope.branchId, req.tenantContext!.userId, req.params.orderId.toString(), parsed.data);

  if (result.status === "order_not_found") {
    res.status(404).json({ error: "Open table order not found" });
    return;
  }

  if (result.status === "target_table_not_found") {
    res.status(404).json({ error: "Target table not found" });
    return;
  }

  if (result.status === "same_table") {
    res.status(409).json({ error: "Select a different table to transfer this order" });
    return;
  }

  if (result.status === "target_unavailable") {
    res.status(409).json({ error: "Target table is not available for transfer" });
    return;
  }

  res.json({ order: result.order, sourceTable: result.sourceTable, targetTable: result.targetTable });
});

restaurantRouter.patch("/tables/:tableId/state", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableStateUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid table state", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveScopedBranch(req, res, requestedBranch(req));
  if (!scope) return;

  const result = await updateTableState(req.tenantContext!.tenantId, scope.branchId, req.tenantContext!.userId, req.params.tableId.toString(), parsed.data);

  if (result.status === "table_not_found") {
    res.status(404).json({ error: "Table not found" });
    return;
  }

  res.json({ table: result.table });
});

restaurantRouter.patch("/tables/:tableId/layout", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableLayoutUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid table layout", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveScopedBranch(req, res, requestedBranch(req));
  if (!scope) return;

  const result = await updateTableLayout(req.tenantContext!.tenantId, scope.branchId, req.tenantContext!.userId, req.params.tableId.toString(), parsed.data);

  if (result.status === "table_not_found") {
    res.status(404).json({ error: "Table not found" });
    return;
  }

  res.json({ table: result.table });
});

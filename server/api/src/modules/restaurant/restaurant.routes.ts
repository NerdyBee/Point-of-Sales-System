import {
  tableBillRequestSchema,
  tableLayoutUpdateSchema,
  tableOrderInputSchema,
  tableOrderItemInputSchema,
  tableReservationInputSchema,
  tableStateUpdateSchema
} from "@pos/validation";
import { Router } from "express";
import { resolveBranchScope, requireAuthenticatedUser, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import {
  addTableOrderItem,
  createReservation,
  getFloorState,
  openTableOrder,
  removeTableOrderItem,
  requestTableBill,
  updateTableLayout,
  updateTableState
} from "./restaurant.repository";

export const restaurantRouter = Router();

restaurantRouter.get("/tables", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const state = await getFloorState(req.tenantContext!.tenantId, scope.branchId);

  res.json(state);
});

restaurantRouter.post("/reservations", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableReservationInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid reservation", issues: parsed.error.flatten() });
    return;
  }

  const result = await createReservation(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

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

restaurantRouter.post("/table-orders", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableOrderInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid table order", issues: parsed.error.flatten() });
    return;
  }

  const result = await openTableOrder(req.tenantContext!.tenantId, req.tenantContext!.branchId, req.tenantContext!.userId, parsed.data);

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

  const result = await addTableOrderItem(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
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
  const result = await removeTableOrderItem(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
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

  const result = await requestTableBill(req.tenantContext!.tenantId, req.tenantContext!.branchId, req.tenantContext!.userId, req.params.orderId.toString(), parsed.data.note);

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

restaurantRouter.patch("/tables/:tableId/state", requireTenant, requirePermission("restaurant.manage"), async (req, res) => {
  const parsed = tableStateUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid table state", issues: parsed.error.flatten() });
    return;
  }

  const result = await updateTableState(req.tenantContext!.tenantId, req.tenantContext!.branchId, req.tenantContext!.userId, req.params.tableId.toString(), parsed.data);

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

  const result = await updateTableLayout(req.tenantContext!.tenantId, req.tenantContext!.branchId, req.tenantContext!.userId, req.params.tableId.toString(), parsed.data);

  if (result.status === "table_not_found") {
    res.status(404).json({ error: "Table not found" });
    return;
  }

  res.json({ table: result.table });
});

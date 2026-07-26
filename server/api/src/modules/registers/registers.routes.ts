import { cashMovementSchema, closeRegisterShiftSchema, openRegisterShiftSchema, paymentReconciliationSchema } from "@pos/validation";
import { Router } from "express";
import { resolveBranchScope, requireAuthenticatedUser, requirePermission, requireTenant, selfScopedUserId } from "../../shared/http/tenantContext";
import {
  closeRegisterShift,
  createCashMovement,
  getCurrentRegister,
  openRegisterShift,
  reconcilePayment
} from "./registers.repository";

export const registersRouter = Router();

registersRouter.get("/current", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const terminalId = req.query.terminalId?.toString();
  const scope = resolveBranchScope(req.tenantContext!, req.query.branchId?.toString());
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const register = await getCurrentRegister(req.tenantContext!.tenantId, scope.branchId, terminalId, selfScopedUserId(req.tenantContext!));

  res.json(register);
});

registersRouter.post("/open", requireTenant, requirePermission("register.manage"), async (req, res) => {
  const parsed = openRegisterShiftSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid register opening", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await openRegisterShift(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

  if (result.status === "already_open") {
    res.status(409).json({ error: "Register is already open for this terminal" });
    return;
  }

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Branch not found" });
    return;
  }

  if (result.status === "branch_not_active") {
    res.status(409).json({ error: "Register can only open on an active branch" });
    return;
  }

  if (result.status === "terminal_not_found") {
    res.status(404).json({ error: "Terminal not found" });
    return;
  }

  if (result.status === "terminal_branch_mismatch") {
    res.status(409).json({ error: "Terminal does not belong to this branch" });
    return;
  }

  if (result.status === "terminal_not_online") {
    res.status(409).json({ error: "Register can only open on an online terminal" });
    return;
  }

  res.status(201).json({ shift: result.shift });
});

registersRouter.post("/cash-movements", requireTenant, requirePermission("register.manage"), async (req, res) => {
  const parsed = cashMovementSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid cash movement", issues: parsed.error.flatten() });
    return;
  }

  const result = await createCashMovement(req.tenantContext!.tenantId, req.tenantContext!.branchId, req.tenantContext!.userId, parsed.data);

  if (result.status === "shift_not_found") {
    res.status(404).json({ error: "Open register shift not found" });
    return;
  }

  if (result.status === "negative_cash") {
    res.status(409).json({ error: "Cash movement would make expected cash negative" });
    return;
  }

  res.status(201).json({ shift: result.shift, movement: result.movement });
});

registersRouter.patch("/payments/:paymentId/reconcile", requireTenant, requirePermission("register.manage"), async (req, res) => {
  const parsed = paymentReconciliationSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payment reconciliation", issues: parsed.error.flatten() });
    return;
  }

  const result = await reconcilePayment(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
    req.tenantContext!.userId,
    req.params.paymentId.toString(),
    parsed.data.note
  );

  if (result.status === "payment_not_found") {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  if (result.status === "shift_closed") {
    res.status(409).json({ error: "Payment belongs to a closed or missing shift" });
    return;
  }

  if (result.status === "already_reconciled") {
    res.status(409).json({ error: "Payment is already reconciled" });
    return;
  }

  res.json({ payment: result.payment });
});

registersRouter.post("/close", requireTenant, requirePermission("register.close"), async (req, res) => {
  const parsed = closeRegisterShiftSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid register closure", issues: parsed.error.flatten() });
    return;
  }

  const result = await closeRegisterShift(req.tenantContext!.tenantId, req.tenantContext!.branchId, req.tenantContext!.userId, parsed.data);

  if (result.status === "shift_not_found") {
    res.status(404).json({ error: "Open register shift not found" });
    return;
  }

  if (result.status === "pending_payments") {
    res.status(409).json({ error: "Reconcile pending non-cash payments before closing this register" });
    return;
  }

  res.json({ shift: result.shift });
});

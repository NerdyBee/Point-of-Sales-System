import { customerInputSchema, customerLedgerInputSchema } from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { canAccessAllBranches, requireAnyPermission, requirePermission, requireTenant, resolveBranchScope } from "../../shared/http/tenantContext";
import { createCustomer, listCustomerLedger, listCustomers, postCustomerLedger, updateCustomer } from "./customers.repository";

export const customersRouter = Router();

function parseCustomerLedgerDate(value: string | undefined, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requestedBranch(req: Request) {
  return req.query.branchId?.toString() ?? req.header("x-branch-id") ?? req.tenantContext!.branchId;
}

function resolveCustomerBranch(req: Request, res: Response, requireBranch = false) {
  const scope = resolveBranchScope(req.tenantContext!, requestedBranch(req));
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !req.tenantContext!.branchId) || (requireBranch && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return null;
  }

  return scope;
}

customersRouter.get("/", requireTenant, requireAnyPermission(["sale.create", "customer.manage"]), async (req, res) => {
  const query = req.query.q?.toString().toLowerCase() ?? "";
  const customers = await listCustomers(req.tenantContext!.tenantId, query);

  res.json({ customers });
});

customersRouter.post("/", requireTenant, requirePermission("customer.manage"), async (req, res) => {
  const parsed = customerInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid customer payload", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveCustomerBranch(req, res);
  if (!scope) return;

  const result = await createCustomer(req.tenantContext!.tenantId, scope.branchId, req.tenantContext!.userId, parsed.data);

  if (result.status === "duplicate_phone") {
    res.status(409).json({ error: "Customer phone already exists for this tenant" });
    return;
  }

  res.status(201).json({ customer: result.customer });
});

customersRouter.patch("/:customerId", requireTenant, requirePermission("customer.manage"), async (req, res) => {
  const parsed = customerInputSchema.partial().safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid customer payload", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveCustomerBranch(req, res);
  if (!scope) return;

  const result = await updateCustomer(
    req.tenantContext!.tenantId,
    scope.branchId,
    req.tenantContext!.userId,
    req.params.customerId.toString(),
    parsed.data
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  if (result.status === "duplicate_phone") {
    res.status(409).json({ error: "Customer phone already exists for this tenant" });
    return;
  }

  res.json({ customer: result.customer });
});

customersRouter.get("/:customerId/ledger", requireTenant, requirePermission("customer.manage"), async (req, res) => {
  const scope = resolveCustomerBranch(req, res);
  if (!scope) return;

  const startDateValue = req.query.startDate?.toString();
  const endDateValue = req.query.endDate?.toString();
  const startDate = parseCustomerLedgerDate(startDateValue);
  const endDate = parseCustomerLedgerDate(endDateValue, true);

  if ((startDateValue && !startDate) || (endDateValue && !endDate)) {
    res.status(400).json({ error: "Invalid customer ledger date range" });
    return;
  }

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    res.status(400).json({ error: "Start date must be before end date" });
    return;
  }

  const result = await listCustomerLedger(
    req.tenantContext!.tenantId,
    req.params.customerId.toString(),
    scope.branchId,
    { startDate: startDate ?? undefined, endDate: endDate ?? undefined }
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  res.json({ entries: result.entries });
});

customersRouter.post("/:customerId/ledger", requireTenant, requirePermission("customer.manage"), async (req, res) => {
  const parsed = customerLedgerInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid customer ledger entry", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveCustomerBranch(req, res, true);
  if (!scope) return;

  const result = await postCustomerLedger(
    req.tenantContext!.tenantId,
    scope.branchId,
    req.tenantContext!.userId,
    req.params.customerId.toString(),
    parsed.data
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  if (result.status === "shift_not_found") {
    res.status(409).json({ error: "Open register shift not found for this cash customer payment" });
    return;
  }

  if (result.status === "credit_limit_exceeded") {
    res.status(409).json({ error: "Credit limit would be exceeded" });
    return;
  }

  if (result.status === "overpayment") {
    res.status(409).json({ error: "Customer payment exceeds outstanding balance" });
    return;
  }

  if (result.status === "negative_points") {
    res.status(409).json({ error: "Loyalty points cannot go below zero" });
    return;
  }

  res.status(201).json({ customer: result.customer, entry: result.entry, movement: result.movement });
});

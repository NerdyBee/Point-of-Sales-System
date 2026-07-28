import { customerInputSchema, customerLedgerInputSchema } from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { canAccessAllBranches, requireAuthenticatedUser, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { createCustomer, listCustomerLedger, listCustomers, postCustomerLedger, updateCustomer } from "./customers.repository";

export const customersRouter = Router();

function requireBranchContext(req: Request, res: Response) {
  if (!canAccessAllBranches(req.tenantContext!) && !req.tenantContext!.branchId) {
    res.status(403).json({ error: "Branch access denied" });
    return false;
  }

  return true;
}

customersRouter.get("/", requireTenant, requireAuthenticatedUser, async (req, res) => {
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

  if (!requireBranchContext(req, res)) return;

  const result = await createCustomer(req.tenantContext!.tenantId, req.tenantContext!.branchId, req.tenantContext!.userId, parsed.data);

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

  if (!requireBranchContext(req, res)) return;

  const result = await updateCustomer(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
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

customersRouter.get("/:customerId/ledger", requireTenant, requireAuthenticatedUser, async (req, res) => {
  const result = await listCustomerLedger(req.tenantContext!.tenantId, req.params.customerId.toString());

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

  if (!requireBranchContext(req, res)) return;

  const result = await postCustomerLedger(
    req.tenantContext!.tenantId,
    req.tenantContext!.branchId,
    req.tenantContext!.userId,
    req.params.customerId.toString(),
    parsed.data
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Customer not found" });
    return;
  }

  if (result.status === "credit_limit_exceeded") {
    res.status(409).json({ error: "Credit limit would be exceeded" });
    return;
  }

  if (result.status === "negative_points") {
    res.status(409).json({ error: "Loyalty points cannot go below zero" });
    return;
  }

  res.status(201).json({ customer: result.customer, entry: result.entry });
});

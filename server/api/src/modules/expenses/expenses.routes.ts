import { expenseInputSchema } from "@pos/validation";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { canAccessAllBranches, resolveBranchScope, requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { createExpense, listExpenses, updateExpenseStatus } from "./expenses.repository";

export const expensesRouter = Router();

const expenseStatusUpdateSchema = z.object({
  status: z.enum(["approved", "paid", "rejected", "voided"]),
  note: z.string().min(3).max(180).optional()
});

function parseExpenseDate(value: string | undefined, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requestedBranch(req: Request) {
  const requested = req.query.branchId?.toString() ?? req.header("x-branch-id");
  if (requested) return requested;

  if (!canAccessAllBranches(req.tenantContext!) && req.tenantContext!.branchId) {
    return req.tenantContext!.branchId;
  }

  return undefined;
}

function resolveExpenseBranch(req: Request, res: Response) {
  const scope = resolveBranchScope(req.tenantContext!, requestedBranch(req));
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return null;
  }

  return scope;
}

expensesRouter.get("/", requireTenant, requirePermission("expense.manage"), async (req, res) => {
  const scope = resolveBranchScope(req.tenantContext!, requestedBranch(req));
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !scope.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const startDateValue = req.query.startDate?.toString();
  const endDateValue = req.query.endDate?.toString();
  const startDate = parseExpenseDate(startDateValue);
  const endDate = parseExpenseDate(endDateValue, true);

  if ((startDateValue && !startDate) || (endDateValue && !endDate)) {
    res.status(400).json({ error: "Invalid expense date range" });
    return;
  }

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    res.status(400).json({ error: "Start date must be before end date" });
    return;
  }

  const status = req.query.status?.toString();
  const expenses = await listExpenses(req.tenantContext!.tenantId, {
    branchId: scope.branchId,
    status,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined
  });

  res.json({ expenses });
});

expensesRouter.post("/", requireTenant, requirePermission("expense.manage"), async (req, res) => {
  const parsed = expenseInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid expense payload", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveBranchScope(req.tenantContext!, parsed.data.branchId);
  if (scope.forbidden || (!canAccessAllBranches(req.tenantContext!) && !req.tenantContext!.branchId)) {
    res.status(403).json({ error: "Branch access denied" });
    return;
  }

  const result = await createExpense(req.tenantContext!.tenantId, req.tenantContext!.userId, {
    ...parsed.data,
    branchId: scope.branchId ?? parsed.data.branchId
  });

  if (result.status === "branch_not_found") {
    res.status(404).json({ error: "Expense branch not found for this tenant" });
    return;
  }

  res.status(201).json({ expense: result.expense });
});

expensesRouter.patch("/:expenseId/status", requireTenant, requirePermission("expense.manage"), async (req, res) => {
  const parsed = expenseStatusUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid expense status", issues: parsed.error.flatten() });
    return;
  }

  const scope = resolveExpenseBranch(req, res);
  if (!scope) return;

  const result = await updateExpenseStatus(
    req.tenantContext!.tenantId,
    req.tenantContext!.userId,
    req.params.expenseId.toString(),
    parsed.data.status,
    parsed.data.note,
    scope.branchId
  );

  if (result.status === "not_found") {
    res.status(404).json({ error: "Expense not found" });
    return;
  }

  if (result.status === "already_voided") {
    res.status(409).json({ error: "Voided expenses cannot be changed" });
    return;
  }

  res.json({ expense: result.expense });
});

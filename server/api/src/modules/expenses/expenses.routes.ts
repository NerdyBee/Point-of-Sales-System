import { expenseInputSchema } from "@pos/validation";
import { Router } from "express";
import { z } from "zod";
import { requirePermission, requireTenant } from "../../shared/http/tenantContext";
import { createExpense, listExpenses, updateExpenseStatus } from "./expenses.repository";

export const expensesRouter = Router();

const expenseStatusUpdateSchema = z.object({
  status: z.enum(["approved", "paid", "rejected", "voided"]),
  note: z.string().min(3).max(180).optional()
});

expensesRouter.get("/", requireTenant, requirePermission("expense.manage"), async (req, res) => {
  const branchId = req.query.branchId?.toString() ?? req.tenantContext!.branchId;
  const status = req.query.status?.toString();
  const expenses = await listExpenses(req.tenantContext!.tenantId, { branchId, status });

  res.json({ expenses });
});

expensesRouter.post("/", requireTenant, requirePermission("expense.manage"), async (req, res) => {
  const parsed = expenseInputSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid expense payload", issues: parsed.error.flatten() });
    return;
  }

  const result = await createExpense(req.tenantContext!.tenantId, req.tenantContext!.userId, parsed.data);

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

  const result = await updateExpenseStatus(
    req.tenantContext!.tenantId,
    req.tenantContext!.userId,
    req.params.expenseId.toString(),
    parsed.data.status,
    parsed.data.note,
    req.tenantContext!.branchId
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

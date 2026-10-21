import type { Platform } from "../data/db";
import { getKv, setKv } from "../sync/settings";
import { context, getRow, now, putRow } from "./store";

/**
 * Shop expenses on a standalone device (same fields as the server's expenses table).
 *
 * Every expense records how it was paid. Cash paid out of the till drawer is taken off the
 * open register's expected cash (shifts.cashOut), so the end-of-day count still balances;
 * cash paid from elsewhere (e.g. the owner's pocket) is recorded but leaves the drawer alone.
 */

export type ExpensePaymentMethod = "cash" | "bank_transfer" | "card" | "mobile_money";

export const expenseCategories = ["Supplies", "Transport", "Utilities", "Rent", "Repairs", "Staff welfare", "Marketing", "Other"] as const;

export const expensePaymentLabels: Record<ExpensePaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Transfer",
  card: "Card",
  mobile_money: "Mobile money"
};

export interface Expense {
  id: string;
  number: string;
  tenantId: string;
  branchId: string;
  category: string;
  description: string;
  vendor: string | null;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  reference: string | null;
  /** Cash taken out of the till drawer (only for cash expenses). */
  fromDrawer: boolean;
  shiftId: string | null;
  note: string | null;
  status: "paid" | "voided";
  spentAt: string;
  paidAt: string;
  createdBy: string;
  createdAt: string;
  voided?: { at: string; by: string; reason: string };
}

export interface ExpenseInput {
  category: string;
  description: string;
  vendor?: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  reference?: string;
  /** Cash expenses only: take it out of the open register's drawer. */
  fromDrawer?: boolean;
  note?: string;
  staffId: string;
}

export class ExpenseError extends Error {}

async function nextExpenseNumber(platform: Platform) {
  const next = Number((await getKv(platform, "expense.counter")) ?? 0) + 1;
  await setKv(platform, "expense.counter", String(next));
  return `EXP-${String(next).padStart(5, "0")}`;
}

export async function recordExpense(platform: Platform, input: ExpenseInput) {
  const settings = await context(platform);
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new ExpenseError("Enter the amount spent");
  if (!input.category.trim()) throw new ExpenseError("Choose a category");
  if (input.description.trim().length < 3) throw new ExpenseError("Say what the money was spent on");
  if (input.description.trim().length > 180) throw new ExpenseError("Keep the description under 180 characters");
  if (!(input.paymentMethod in expensePaymentLabels)) throw new ExpenseError("Choose how it was paid");
  const fromDrawer = input.paymentMethod === "cash" && input.fromDrawer !== false;

  let expense: Expense | null = null;
  await platform.db.transaction(async () => {
    let shiftId: string | null = null;
    if (fromDrawer) {
      const shift = await platform.db.first<{ id: string; openingBalance: number; cashSales: number; cashIn: number; cashOut: number }>(
        "SELECT id, openingBalance, cashSales, cashIn, cashOut FROM shifts WHERE status = 'open' ORDER BY openedAt DESC LIMIT 1"
      );
      if (!shift) throw new ExpenseError("Open the register to pay from the till drawer, or turn off \"Paid from the till drawer\" if the cash came from elsewhere.");
      const inDrawer = shift.openingBalance + shift.cashSales + Number(shift.cashIn ?? 0) - Number(shift.cashOut ?? 0);
      if (input.amount > inDrawer) throw new ExpenseError(`Only about ${inDrawer.toLocaleString()} should be in the drawer. Check the amount, or turn off "Paid from the till drawer".`);
      await platform.db.run("UPDATE shifts SET cashOut = cashOut + ? WHERE id = ?", [input.amount, shift.id]);
      shiftId = shift.id;
    }
    const at = now();
    expense = {
      id: `expense-${platform.uuid()}`,
      number: await nextExpenseNumber(platform),
      tenantId: settings.tenantId,
      branchId: settings.branchId,
      category: input.category.trim(),
      description: input.description.trim(),
      vendor: input.vendor?.trim() || null,
      amount: input.amount,
      paymentMethod: input.paymentMethod,
      reference: input.reference?.trim() || null,
      fromDrawer,
      shiftId,
      note: input.note?.trim() || null,
      status: "paid",
      spentAt: at,
      paidAt: at,
      createdBy: input.staffId,
      createdAt: at
    };
    await putRow(platform.db, "expenses", expense.id, expense as unknown as Record<string, unknown>, settings.branchId);
  });
  return expense as unknown as Expense;
}

/** Voids an expense entered by mistake. Drawer cash goes back into the shift it came from if that shift is still open. */
export async function voidExpense(platform: Platform, expenseId: string, staffId: string, reason: string) {
  const settings = await context(platform);
  if (reason.trim().length < 3) throw new ExpenseError("Enter the reason for voiding");
  await platform.db.transaction(async () => {
    const expense = await getRow<Expense>(platform.db, "expenses", expenseId);
    if (!expense) throw new ExpenseError("Expense not found");
    if (expense.status === "voided") throw new ExpenseError("This expense is already voided");
    if (expense.fromDrawer && expense.shiftId) {
      await platform.db.run("UPDATE shifts SET cashOut = MAX(0, cashOut - ?) WHERE id = ? AND status = 'open'", [expense.amount, expense.shiftId]);
    }
    await putRow(
      platform.db,
      "expenses",
      expense.id,
      { ...expense, status: "voided", voided: { at: now(), by: staffId, reason: reason.trim() } } as unknown as Record<string, unknown>,
      settings.branchId
    );
  });
}

/** Expenses in a period, newest first (voided ones included, marked). */
export async function listExpenses(platform: Platform, range: { from: Date; to: Date }) {
  const rows = await platform.db.all<{ data: string }>(
    `SELECT data FROM rows WHERE tbl = 'expenses' AND json_extract(data, '$.spentAt') >= ? AND json_extract(data, '$.spentAt') < ?
     ORDER BY json_extract(data, '$.spentAt') DESC, rowid DESC`,
    [range.from.toISOString(), range.to.toISOString()]
  );
  return rows.map((row) => JSON.parse(row.data) as Expense);
}

/** Totals for a list of expenses (voided ones excluded). */
export function expenseTotals(expenses: Expense[]) {
  const paid = expenses.filter((expense) => expense.status !== "voided");
  const byMethod: Partial<Record<ExpensePaymentMethod, number>> = {};
  const byCategory: Record<string, number> = {};
  for (const expense of paid) {
    byMethod[expense.paymentMethod] = (byMethod[expense.paymentMethod] ?? 0) + expense.amount;
    byCategory[expense.category] = (byCategory[expense.category] ?? 0) + expense.amount;
  }
  return {
    total: paid.reduce((sum, expense) => sum + expense.amount, 0),
    count: paid.length,
    fromDrawer: paid.filter((expense) => expense.fromDrawer).reduce((sum, expense) => sum + expense.amount, 0),
    byMethod,
    byCategory
  };
}

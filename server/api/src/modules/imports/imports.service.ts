import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { customerLedger as demoLedger, customers as demoCustomers } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { appendCatalogAudit, createCatalogProductRecord, getTenantSettings, listCatalogProducts, nextCatalogSku, updateCatalogProductRecord } from "../catalog/catalog.repository";
import { createCustomer, listCustomers, updateCustomer } from "../customers/customers.repository";
import { createSupplierInvoice, listInventorySuppliers, listSupplierInvoices } from "../inventory/inventory.repository";
import { updateTenantSettingsRecord } from "../tenants/tenants.repository";
import type { CustomerRow, ProductRow, RowResult, SupplierBalanceRow } from "./importRows";

const useDemoStore = process.env.NODE_ENV === "test";

/** What happened (or, in a preview, would happen) to one spreadsheet row. */
export interface ImportOutcome {
  row: number;
  action: "create" | "update" | "skip";
  label: string;
  errors: string[];
  warnings: string[];
}

export interface ImportContext {
  tenantId: string;
  userId: string;
  branchId: string;
  /** false = preview only: check every row, save nothing. */
  commit: boolean;
}

const failed = (result: RowResult<unknown>, label = ""): ImportOutcome => ({ row: result.row, action: "skip", label, errors: result.errors, warnings: [] });

/** The picture shown for imported products until someone uploads a real one. */
const placeholderImage = "/uploads/products/no-image.svg";
async function ensurePlaceholderImage() {
  const file = path.resolve(process.cwd(), "uploads", "products", "no-image.svg");
  if (existsSync(file)) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#eef1f6"/><path d="M38 78l16-20 12 14 8-10 14 16z" fill="#b7c0cf"/><circle cx="76" cy="44" r="8" fill="#b7c0cf"/></svg>'
  );
}

/**
 * Products: new ones are created with their opening stock; a SKU already in this branch (or,
 * when the row has no SKU, a product of the same name there) updates that product's name,
 * category, prices and reorder point. Stock on existing
 * products is left alone: change it with a stock count, so the movement is recorded.
 */
export async function importProducts(context: ImportContext, rows: RowResult<ProductRow>[]) {
  const settings = await getTenantSettings(context.tenantId);
  if (!settings) throw new Error("Business not found");
  const existing = await listCatalogProducts(context.tenantId);
  const bySku = new Map(existing.map((product) => [product.sku.toLowerCase(), product]));
  // Without a SKU, a product is recognised by its name in this branch, so importing the same
  // sheet twice updates rather than duplicates.
  const byName = new Map(existing.filter((product) => product.branchId === context.branchId).map((product) => [product.name.trim().toLowerCase(), product]));
  const byBarcode = new Map(existing.filter((product) => product.barcode).map((product) => [product.barcode.toLowerCase(), product]));
  const categories = new Map(settings.productCategories.map((category) => [category.toLowerCase(), category]));
  const newCategories: string[] = [];

  const outcomes: ImportOutcome[] = [];
  const plans: { outcome: ImportOutcome; data: ProductRow; productId?: string }[] = [];
  for (const result of rows) {
    if (!result.data) {
      outcomes.push(failed(result));
      continue;
    }
    const data = { ...result.data, category: categories.get(result.data.category.toLowerCase()) ?? result.data.category };
    const outcome: ImportOutcome = { row: result.row, action: "create", label: data.name, errors: [], warnings: [] };
    const match = data.sku ? bySku.get(data.sku.toLowerCase()) : byName.get(data.name.trim().toLowerCase());
    if (match && match.branchId !== context.branchId) outcome.errors.push(`SKU ${data.sku} is used by "${match.name}" in another branch`);
    else if (match) {
      outcome.action = "update";
      if (data.stock && data.stock !== match.stock) outcome.warnings.push("Stock not changed for existing products: use a stock count");
    }
    const barcodeOwner = data.barcode ? byBarcode.get(data.barcode.toLowerCase()) : undefined;
    if (barcodeOwner && barcodeOwner.id !== match?.id) outcome.errors.push(`Barcode ${data.barcode} already belongs to "${barcodeOwner.name}"`);
    if (!categories.has(data.category.toLowerCase())) {
      categories.set(data.category.toLowerCase(), data.category);
      newCategories.push(data.category);
    }
    if (newCategories.includes(data.category)) outcome.warnings.push(`New category "${data.category}" will be added`);
    if (outcome.errors.length) outcome.action = "skip";
    outcomes.push(outcome);
    if (!outcome.errors.length) plans.push({ outcome, data, productId: match?.id });
  }

  if (!context.commit) return outcomes;

  if (newCategories.length) await updateTenantSettingsRecord(context.tenantId, { ...settings, productCategories: [...settings.productCategories, ...newCategories] } as never);
  if (plans.some((plan) => !plan.productId)) await ensurePlaceholderImage();
  for (const { outcome, data, productId } of plans) {
    try {
      if (productId) {
        await updateCatalogProductRecord(context.tenantId, productId, {
          name: data.name,
          category: data.category,
          price: data.price,
          cost: data.cost,
          reorderPoint: data.reorderPoint,
          ...(data.barcode ? { barcode: data.barcode } : {}),
          ...(data.taxRate !== undefined ? { taxRate: data.taxRate } : {})
        });
        await appendCatalogAudit({ tenantId: context.tenantId, branchId: context.branchId, userId: context.userId, action: "product.updated", entityType: "product", entityId: productId, metadata: { source: "import", price: data.price } });
      } else {
        const sku = data.sku || (await nextCatalogSku(context.tenantId, data.category));
        const product = await createCatalogProductRecord(context.tenantId, {
          branchId: context.branchId,
          name: data.name,
          sku,
          barcode: data.barcode || sku,
          category: data.category,
          price: data.price,
          cost: data.cost,
          taxRate: data.taxRate ?? settings.defaultTaxRate,
          image: placeholderImage,
          stock: data.stock,
          reorderPoint: data.reorderPoint,
          station: data.station,
          modifiers: []
        });
        await appendCatalogAudit({ tenantId: context.tenantId, branchId: context.branchId, userId: context.userId, action: "product.created", entityType: "product", entityId: product.id, metadata: { source: "import", sku: product.sku, price: product.price } });
      }
    } catch (error) {
      outcome.action = "skip";
      outcome.errors.push(error instanceof Error ? error.message : "Could not save");
    }
  }
  return outcomes;
}

/** Writes a customer's opening balance as an entry dated when it was first owed, so ageing is right. */
async function postOpeningBalance(context: ImportContext, customerId: string, amount: number, date: string | null) {
  const createdAt = date ? new Date(`${date}T12:00:00`) : new Date();
  const entry = { tenantId: context.tenantId, branchId: context.branchId, customerId, type: "credit_sale" as const, amount, pointsDelta: 0, balanceAfter: amount, note: "Opening balance (imported)", createdBy: context.userId };
  if (useDemoStore) {
    const customer = demoCustomers.find((item) => item.id === customerId)!;
    customer.outstandingBalance = amount;
    demoLedger.unshift({ ...entry, id: `cust-ledger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, pointsAfter: customer.loyaltyPoints, createdAt: createdAt.toISOString() });
    return;
  }
  await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.update({ where: { id: customerId }, data: { outstandingBalance: amount } });
    await tx.customerLedgerEntry.create({ data: { ...entry, id: `cust-ledger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, pointsAfter: customer.loyaltyPoints, createdAt } });
  });
}

/**
 * Customers: matched by phone number. New customers are created with any opening balance they
 * owe; existing ones get their name, email, group, credit limit and notes updated (balances on
 * existing customers are not touched: record a payment or credit sale instead).
 */
export async function importCustomers(context: ImportContext, rows: RowResult<CustomerRow>[]) {
  const existing = await listCustomers(context.tenantId);
  const byPhone = new Map(existing.map((customer) => [customer.phone.replace(/[^\d+]/g, ""), customer]));
  const outcomes: ImportOutcome[] = [];
  const plans: { outcome: ImportOutcome; data: CustomerRow; customerId?: string }[] = [];
  for (const result of rows) {
    if (!result.data) {
      outcomes.push(failed(result));
      continue;
    }
    const match = byPhone.get(result.data.phone);
    const outcome: ImportOutcome = { row: result.row, action: match ? "update" : "create", label: result.data.name, errors: [], warnings: [] };
    if (match && result.data.openingBalance) outcome.warnings.push("Already a customer: opening balance not added (record a credit sale instead)");
    if (!match && result.data.openingBalance > result.data.creditLimit && result.data.creditLimit > 0) outcome.warnings.push("Opening balance is above the credit limit");
    outcomes.push(outcome);
    plans.push({ outcome, data: result.data, customerId: match?.id });
  }
  if (!context.commit) return outcomes;

  for (const { outcome, data, customerId } of plans) {
    const fields = { name: data.name, phone: data.phone, email: data.email, group: data.group, creditLimit: data.creditLimit, notes: data.notes || undefined };
    try {
      if (customerId) {
        await updateCustomer(context.tenantId, context.branchId, context.userId, customerId, fields);
        continue;
      }
      const created = await createCustomer(context.tenantId, context.branchId, context.userId, { ...fields, loyaltyPoints: 0 });
      if (created.status !== "created") {
        outcome.action = "skip";
        outcome.errors.push("A customer with this phone number already exists");
        continue;
      }
      if (data.openingBalance > 0) await postOpeningBalance(context, created.customer.id, data.openingBalance, data.balanceDate);
    } catch (error) {
      outcome.action = "skip";
      outcome.errors.push(error instanceof Error ? error.message : "Could not save");
    }
  }
  return outcomes;
}

/** What the business owed suppliers when it started: one unpaid supplier invoice per row. */
export async function importSupplierBalances(context: ImportContext, rows: RowResult<SupplierBalanceRow>[]) {
  const suppliers = await listInventorySuppliers(context.tenantId, { branchId: context.branchId });
  const byName = new Map(suppliers.filter((supplier) => supplier.active).map((supplier) => [supplier.name.trim().toLowerCase(), supplier]));
  const invoices = await listSupplierInvoices(context.tenantId, { branchId: context.branchId });
  const taken = new Set(invoices.map((invoice) => `${invoice.supplierId}|${invoice.invoiceNumber.toLowerCase()}`));
  const outcomes: ImportOutcome[] = [];
  const plans: { outcome: ImportOutcome; data: SupplierBalanceRow; supplierId: string }[] = [];
  for (const result of rows) {
    if (!result.data) {
      outcomes.push(failed(result));
      continue;
    }
    const data = result.data;
    const outcome: ImportOutcome = { row: result.row, action: "create", label: `${data.supplier} ${data.invoiceNumber}`, errors: [], warnings: [] };
    const supplier = byName.get(data.supplier.toLowerCase());
    if (!supplier) outcome.errors.push(`No supplier called "${data.supplier}" in this branch: add the supplier first`);
    else {
      const key = `${supplier.id}|${data.invoiceNumber.toLowerCase()}`;
      if (taken.has(key)) outcome.errors.push(`Invoice ${data.invoiceNumber} from ${supplier.name} is already recorded`);
      taken.add(key);
    }
    if (outcome.errors.length) outcome.action = "skip";
    outcomes.push(outcome);
    if (supplier && !outcome.errors.length) plans.push({ outcome, data, supplierId: supplier.id });
  }
  if (!context.commit) return outcomes;

  for (const { outcome, data, supplierId } of plans) {
    try {
      const result = await createSupplierInvoice(context.tenantId, context.userId, {
        branchId: context.branchId,
        supplierId,
        invoiceNumber: data.invoiceNumber,
        invoiceDate: new Date(`${data.invoiceDate}T12:00:00`).toISOString(),
        dueDate: data.dueDate ? new Date(`${data.dueDate}T12:00:00`).toISOString() : undefined,
        amount: data.amount,
        vatAmount: data.vatAmount,
        note: data.note || "Opening balance (imported)"
      });
      if (result.status !== "created") {
        outcome.action = "skip";
        outcome.errors.push(result.status === "duplicate_invoice" ? "Invoice already recorded" : "Could not save");
      }
    } catch (error) {
      outcome.action = "skip";
      outcome.errors.push(error instanceof Error ? error.message : "Could not save");
    }
  }
  return outcomes;
}

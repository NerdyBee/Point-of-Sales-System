import { z } from "zod";
import { paymentMethodSchema, saleLineSchema } from "@pos/validation";

const referenceRequiredMethods = new Set(["card", "bank_transfer", "mobile_money"]);

export type SaleCatalogProduct = {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  category: string;
  price: number;
  taxRate: number;
};

export const createSaleSchema = z.object({
  branchId: z.string().min(1),
  terminalId: z.string().min(1),
  customerId: z.string().optional(),
  tableId: z.string().optional(),
  tableOrderId: z.string().optional(),
  idempotencyKey: z.string().min(12),
  discountApprovalId: z.string().min(1).max(80).optional().or(z.literal("")),
  lines: z.array(saleLineSchema).min(1),
  payments: z.array(z.object({
    method: paymentMethodSchema,
    amount: z.number().int().nonnegative(),
    reference: z.string().optional()
  })).min(1)
}).superRefine((sale, ctx) => {
  sale.payments.forEach((payment, index) => {
    if (referenceRequiredMethods.has(payment.method) && !payment.reference?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Payment reference is required for this method",
        path: ["payments", index, "reference"]
      });
    }
  });
});

export function previewSaleTotal(
  tenantId: string,
  payload: z.infer<typeof createSaleSchema>,
  chargeDefaults: { vatRate?: number; serviceChargeEnabled?: boolean; serviceChargeRate?: number } = {},
  productCatalog: SaleCatalogProduct[]
) {
  const serviceChargeEnabled = chargeDefaults.serviceChargeEnabled ?? true;
  const serviceChargeRate = chargeDefaults.serviceChargeRate ?? 0.05;
  const vatRate = chargeDefaults.vatRate;
  const lines = payload.lines.map((line) => {
    const product = productCatalog.find((item) => item.tenantId === tenantId && item.branchId === payload.branchId && item.id === line.productId);

    if (!product) {
      throw new Error(`Product ${line.productId} is not available for this tenant`);
    }

    const lineSubtotal = product.price * line.quantity;
    const discount = line.discount * line.quantity;
    const taxableBase = Math.max(lineSubtotal - discount, 0);
    const vat = Math.round(taxableBase * (vatRate ?? product.taxRate));

    return {
      productId: product.id,
      name: product.name,
      quantity: line.quantity,
      subtotal: lineSubtotal,
      discount,
      vat,
      total: taxableBase + vat
    };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const discount = lines.reduce((sum, line) => sum + line.discount, 0);
  const serviceCharge = serviceChargeEnabled ? Math.round(Math.max(subtotal - discount, 0) * serviceChargeRate) : 0;
  const vat = lines.reduce((sum, line) => sum + line.vat, 0);
  const total = lines.reduce((sum, line) => sum + line.total, 0) + serviceCharge;
  const paid = payload.payments.reduce((sum, payment) => sum + payment.amount, 0);

  return { lines, subtotal, discount, serviceCharge, vat, total, paid, balance: total - paid };
}

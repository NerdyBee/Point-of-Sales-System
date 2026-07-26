import type { CartItem, SaleSummary } from "./types";

interface SaleChargeControls {
  vatRate?: number;
  serviceChargeEnabled?: boolean;
  serviceChargeRate?: number;
}

export function calculateSale(items: CartItem[], controls: SaleChargeControls = {}): SaleSummary {
  const subtotal = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const discount = items.reduce((sum, item) => sum + item.discount * item.quantity, 0);
  const taxableBase = Math.max(subtotal - discount, 0);
  const serviceChargeRate = controls.serviceChargeRate ?? 0.05;
  const serviceCharge = controls.serviceChargeEnabled === false ? 0 : Math.round(taxableBase * serviceChargeRate);
  const vat = items.reduce((sum, item) => {
    const lineBase = Math.max((item.product.price - item.discount) * item.quantity, 0);
    return sum + Math.round(lineBase * (controls.vatRate ?? item.product.taxRate));
  }, 0);

  return {
    subtotal,
    discount,
    serviceCharge,
    vat,
    total: taxableBase + serviceCharge + vat
  };
}

export function applyManagerApproval(action: string, amount: number) {
  const sensitive = ["refund", "void", "stock-adjustment", "register-close"];
  return sensitive.includes(action) || amount >= 50000;
}

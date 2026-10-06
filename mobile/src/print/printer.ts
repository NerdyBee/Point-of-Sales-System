import { Share } from "react-native";
import type { Platform } from "../data/db";
import type { TenantSettings } from "../data/readModel";
import type { SaleRecord } from "../pos/actions";
import { getKv, setKv } from "../sync/settings";
import { bluetoothSupport, PrinterError, sendToPrinter, type PrinterDevice } from "./bluetooth";
import { EscPosBuilder, type PaperWidth } from "./escpos";
import { buildReceiptBytes, buildReceiptText, type ReceiptData } from "./receipt";

export interface PrinterSettings {
  device: PrinterDevice | null;
  paperWidth: PaperWidth;
  /** Print automatically when a sale is completed. */
  autoPrint: boolean;
  /** Pulse the cash drawer port on cash sales. */
  openDrawer: boolean;
}

const settingsKey = "printer.settings";
export const defaultPrinterSettings: PrinterSettings = { device: null, paperWidth: 58, autoPrint: false, openDrawer: false };

export async function loadPrinterSettings(platform: Platform): Promise<PrinterSettings> {
  const raw = await getKv(platform, settingsKey);
  return raw ? { ...defaultPrinterSettings, ...(JSON.parse(raw) as Partial<PrinterSettings>) } : defaultPrinterSettings;
}

export async function savePrinterSettings(platform: Platform, settings: PrinterSettings) {
  await setKv(platform, settingsKey, JSON.stringify(settings));
}

export function printingAvailable() {
  const support = bluetoothSupport();
  return support.classic || support.ble;
}

/** Builds receipt data from a sale recorded on this device. */
export function receiptFromSale(
  sale: { number: string; serverId?: string | null; createdAt: string; status?: string },
  record: SaleRecord & { tendered?: number },
  tenant: TenantSettings,
  extra: { tendered?: number; reprint?: boolean } = {}
): ReceiptData {
  return {
    businessName: tenant.businessName,
    taxId: tenant.taxId || undefined,
    footer: tenant.receiptFooter,
    currency: tenant.currency ?? "NGN",
    number: sale.serverId ?? sale.number,
    createdAt: sale.createdAt,
    staffName: record.staffName,
    customer: record.customer ? { name: record.customer.name, phone: record.customer.phone } : undefined,
    summary: record.summary,
    payments: record.payments,
    tendered: extra.tendered ?? record.tendered,
    voided: sale.status === "voided",
    reprint: extra.reprint
  };
}

export async function printReceipt(platform: Platform, receipt: ReceiptData) {
  const settings = await loadPrinterSettings(platform);
  if (!settings.device) throw new PrinterError("No receipt printer set up yet.");
  const cashSale = receipt.payments.some((payment) => payment.method === "cash");
  const bytes = buildReceiptBytes(receipt, { width: settings.paperWidth, openDrawer: settings.openDrawer && cashSale && !receipt.reprint });
  await sendToPrinter(settings.device, bytes);
}

export async function printTestPage(device: PrinterDevice, width: PaperWidth, businessName: string) {
  const page = new EscPosBuilder(width);
  page.align("center").bold(true).large(true).line("TEST PRINT").large(false).bold(false);
  page.line(businessName).feed(1).align("left");
  page.pair("Printer", device.name).pair("Paper", `${width} mm (${page.columns} chars)`);
  page.line("1234567890".repeat(Math.ceil(page.columns / 10)).slice(0, page.columns));
  page.divider().align("center").line("If this looks right, you are").line("ready to print receipts.").cut();
  await sendToPrinter(device, page.build());
}

/** Fallback when there is no printer: share the receipt as text (WhatsApp, SMS...). */
export async function shareReceipt(receipt: ReceiptData) {
  await Share.share({ title: `Receipt ${receipt.number}`, message: buildReceiptText(receipt) });
}

export { PrinterError };

import type { Platform } from "../data/db";
import { readModel } from "../data/readModel";
import { getKv, setKv, type DeviceSettings } from "../sync/settings";
import type { ReceiptBranding } from "./receipt";

const logoKey = "business.logo";

/** The shop logo (base64 PNG), kept on the device and included in backups. */
export async function getBusinessLogo(platform: Platform) {
  return (await getKv(platform, logoKey)) || null;
}

export async function setBusinessLogo(platform: Platform, pngBase64: string | null) {
  if (pngBase64) await setKv(platform, logoKey, pngBase64);
  else await platform.db.run("DELETE FROM kv WHERE key = ?", [logoKey]);
}

/**
 * What goes at the top of receipts: phone/address from the business settings (falling back to
 * the branch's, as synced from a server) and the logo unless printing it was turned off.
 */
export async function loadReceiptBranding(platform: Platform, settings: DeviceSettings | null): Promise<ReceiptBranding> {
  if (!settings) return {};
  const [tenant, branch] = await Promise.all([
    readModel.tenant(platform.db, settings.tenantId),
    platform.db.first<{ data: string }>("SELECT data FROM rows WHERE tbl = 'branches' AND id = ?", [settings.branchId])
  ]);
  const branchRow = branch ? (JSON.parse(branch.data) as { phone?: string; address?: string; city?: string }) : null;
  const branchAddress = [branchRow?.address, branchRow?.city].filter((part) => part && part.trim()).join(", ");
  const logo = tenant?.settings.printLogo === false ? null : await getBusinessLogo(platform);
  return {
    phone: tenant?.settings.phone?.trim() || branchRow?.phone?.trim() || undefined,
    address: tenant?.settings.address?.trim() || branchAddress || undefined,
    logoPng: logo ?? undefined
  };
}

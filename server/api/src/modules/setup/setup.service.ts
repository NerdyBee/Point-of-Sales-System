import { currencyCodes, currencyDecimals } from "@pos/types";
import { prisma } from "../../shared/db/prisma";
import { demoSecretHash, type SubscriptionPlan } from "../../shared/data/demoStore";
import { hashPassword } from "../../shared/security/passwords";
import { ensureTenantAccessControl } from "../roles/roles.repository";
import { staffIdBase } from "../staff/staff.repository";
import { planCatalog } from "../subscriptions/subscriptions.repository";

/**
 * Creates a real client business (no demo data): the business, its first branch and till,
 * a subscription record and the owner. Used by the first-run setup page and `business create`.
 */
export interface CreateBusinessInput {
  name: string;
  ownerName: string;
  email: string;
  password: string;
  pin?: string;
  phone?: string;
  branchName?: string;
  city?: string;
  currency: string;
  /** Fraction, e.g. 0.075 for 7.5%. */
  taxRate?: number;
  plan?: SubscriptionPlan;
  tenantId?: string;
}

export class BusinessSetupError extends Error {}

function slug(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "business";
}

export async function businessCount() {
  return prisma.tenant.count();
}

export async function createBusiness(input: CreateBusinessInput) {
  const name = input.name.trim();
  const ownerName = input.ownerName.trim();
  const email = input.email.trim().toLowerCase();
  const branchName = input.branchName?.trim() || "Main";
  const currency = input.currency.trim().toUpperCase();
  const taxRate = input.taxRate ?? 0;
  const plan = input.plan ?? "Business";
  const pin = input.pin?.trim() || undefined;
  const tenantId = input.tenantId?.trim() || `tenant-${slug(name)}`;

  if (name.length < 2) throw new BusinessSetupError("Enter the business name");
  if (ownerName.length < 2) throw new BusinessSetupError("Enter the owner's name");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new BusinessSetupError("Enter a valid email address");
  if (input.password.length < 8) throw new BusinessSetupError("The password must be at least 8 characters");
  if (pin && !/^\d{6}$/.test(pin)) throw new BusinessSetupError("The PIN must be 6 digits");
  if (!currencyCodes.includes(currency)) throw new BusinessSetupError(`Currency must be one of: ${currencyCodes.join(", ")}`);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate >= 1) throw new BusinessSetupError("VAT must be between 0% and 99%");
  if (!planCatalog[plan]) throw new BusinessSetupError(`Plan must be one of: ${Object.keys(planCatalog).join(", ")}`);
  if (await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })) {
    throw new BusinessSetupError(`A business with ID ${tenantId} already exists`);
  }

  const limits = planCatalog[plan];
  const branchId = `branch-${slug(name)}-${slug(branchName)}`.slice(0, 64);
  const passwordHash = await hashPassword(input.password);

  // All or nothing: a half-created business would have no owner to sign in with.
  const staffId = await prisma.$transaction(async (tx) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        name,
        plan,
        branchLimit: limits.branchLimit,
        activeBranches: 1,
        settings: {
          businessName: name,
          taxId: "",
          defaultBranchId: branchId,
          defaultTaxRate: taxRate,
          serviceChargeEnabled: false,
          serviceChargeRate: 0,
          currency,
          moneyDecimals: currencyDecimals(currency),
          productCategories: ["General"],
          receiptFooter: "Thank you for your patronage.",
          whatsappReceipts: true,
          paymentMethods: { cash: true, card: true, bankTransfer: true, mobileMoney: false },
          hardware: { printer: "Generic 80mm Thermal", cashDrawer: false, barcodeScanner: false }
        }
      }
    });
    await tx.branch.create({ data: { id: branchId, tenantId, name: branchName, city: input.city?.trim() ?? "" } });
    // A first till so the register can be opened and sales made straight away.
    await tx.terminal.create({
      data: { id: `${branchId}-till-1`.slice(0, 80), tenantId, branchId, name: "Till 1", deviceCode: "TILL-1", status: "online", appVersion: "web", lastSeenAt: new Date() }
    });
    await tx.tenantSubscription.create({
      data: {
        id: `sub-${tenantId}`.slice(0, 64),
        tenantId,
        plan,
        status: "active",
        billingEmail: email,
        amount: limits.amount,
        interval: "yearly",
        branchLimit: limits.branchLimit,
        userLimit: limits.userLimit,
        terminalLimit: limits.terminalLimit,
        storageGb: limits.storageGb,
        renewalDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      }
    });

    // Staff IDs are unique across all businesses in this database.
    const base = staffIdBase(name, branchName, ownerName);
    let id = base;
    for (let index = 2; await tx.staffMember.findUnique({ where: { id }, select: { id: true } }); index += 1) {
      id = `${base}${String(index).padStart(2, "0")}`;
    }
    await tx.staffMember.create({
      data: {
        id,
        tenantId,
        branchId,
        name: ownerName,
        email,
        phone: input.phone?.trim() ?? "",
        role: "owner",
        passwordHash,
        pinHash: pin ? demoSecretHash(pin) : null,
        pinEnabled: Boolean(pin),
        active: true,
        salesTotal: 0,
        inviteStatus: "accepted"
      }
    });
    return id;
  });

  // Roles and permissions; also re-applied at every startup, so a failure here is repaired.
  await ensureTenantAccessControl(tenantId);

  return { tenantId, branchId, branchName, staffId, email, currency, moneyDecimals: currencyDecimals(currency) };
}

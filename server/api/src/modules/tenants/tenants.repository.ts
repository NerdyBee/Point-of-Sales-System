import type { Prisma } from "@prisma/client";
import { appendAudit, branches, demoProducts, demoTenants, type DemoTenant, type TenantSettings } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";

const useDemoStore = process.env.NODE_ENV === "test";

function toApiTenant(tenant: {
  id: string;
  name: string;
  plan: string;
  branchLimit: number;
  activeBranches: number;
  settings: Prisma.JsonValue;
}): DemoTenant {
  const settings = tenant.settings as unknown as TenantSettings;

  return {
    id: tenant.id,
    name: tenant.name,
    plan: tenant.plan as DemoTenant["plan"],
    branchLimit: tenant.branchLimit,
    activeBranches: tenant.activeBranches,
    settings: {
      ...settings,
      serviceChargeEnabled: settings.serviceChargeEnabled ?? true,
      serviceChargeRate: settings.serviceChargeRate ?? 0.05
    }
  };
}

export async function getCurrentTenant(tenantId: string) {
  if (useDemoStore) {
    return demoTenants.find((tenant) => tenant.id === tenantId) ?? null;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId }
  });

  return tenant ? toApiTenant(tenant) : null;
}

export async function findRemovedProductCategoriesInUse(tenantId: string, nextCategories: string[]) {
  if (useDemoStore) {
    return Array.from(
      new Set(
        demoProducts
          .filter((product) => product.tenantId === tenantId)
          .filter((product) => !nextCategories.includes(product.category))
          .map((product) => product.category)
      )
    );
  }

  const products = await prisma.product.findMany({
    where: {
      tenantId,
      category: { notIn: nextCategories }
    },
    select: { category: true },
    distinct: ["category"]
  });

  return products.map((product) => product.category);
}

export async function tenantBranchExists(tenantId: string, branchId: string) {
  if (useDemoStore) {
    return branches.some((branch) => branch.tenantId === tenantId && branch.id === branchId);
  }

  const branch = await prisma.branch.findFirst({
    where: { tenantId, id: branchId },
    select: { id: true }
  });

  return Boolean(branch);
}

export async function updateTenantSettingsRecord(tenantId: string, settings: TenantSettings) {
  if (useDemoStore) {
    const tenant = demoTenants.find((item) => item.id === tenantId);

    if (!tenant) {
      return null;
    }

    tenant.name = settings.businessName;
    tenant.settings = settings;
    return tenant;
  }

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: settings.businessName,
      settings: settings as unknown as Prisma.InputJsonValue
    }
  });

  return toApiTenant(tenant);
}

export async function renameTenantProductCategory(tenantId: string, from: string, to: string) {
  if (useDemoStore) {
    const tenant = demoTenants.find((item) => item.id === tenantId);

    if (!tenant) {
      return null;
    }

    const fromIndex = tenant.settings.productCategories.findIndex((category) => category.toLowerCase() === from.toLowerCase());

    if (fromIndex === -1) {
      return { tenant, status: "not_found" as const, updatedProductCount: 0 };
    }

    const duplicateCategory = tenant.settings.productCategories.some((category) => category.toLowerCase() === to.toLowerCase());

    if (duplicateCategory) {
      return { tenant, status: "duplicate" as const, updatedProductCount: 0 };
    }

    const previousCategory = tenant.settings.productCategories[fromIndex];
    tenant.settings.productCategories[fromIndex] = to;

    const updatedProductCount = demoProducts
      .filter((product) => product.tenantId === tenant.id && product.category === previousCategory)
      .reduce((count, product) => {
        product.category = to;
        return count + 1;
      }, 0);

    return { tenant, status: "renamed" as const, previousCategory, updatedProductCount };
  }

  const tenant = await getCurrentTenant(tenantId);

  if (!tenant) {
    return null;
  }

  const fromIndex = tenant.settings.productCategories.findIndex((category) => category.toLowerCase() === from.toLowerCase());

  if (fromIndex === -1) {
    return { tenant, status: "not_found" as const, updatedProductCount: 0 };
  }

  const duplicateCategory = tenant.settings.productCategories.some((category) => category.toLowerCase() === to.toLowerCase());

  if (duplicateCategory) {
    return { tenant, status: "duplicate" as const, updatedProductCount: 0 };
  }

  const previousCategory = tenant.settings.productCategories[fromIndex];
  const nextSettings = {
    ...tenant.settings,
    productCategories: tenant.settings.productCategories.map((category, index) => (index === fromIndex ? to : category))
  };

  const result = await prisma.$transaction(async (tx) => {
    const updatedProducts = await tx.product.updateMany({
      where: { tenantId, category: previousCategory },
      data: { category: to }
    });
    const updatedTenant = await tx.tenant.update({
      where: { id: tenantId },
      data: {
        name: nextSettings.businessName,
        settings: nextSettings as unknown as Prisma.InputJsonValue
      }
    });

    return { tenant: toApiTenant(updatedTenant), updatedProductCount: updatedProducts.count };
  });

  return { ...result, status: "renamed" as const, previousCategory };
}

export async function appendTenantAudit(event: Parameters<typeof appendAudit>[0]) {
  if (useDemoStore) {
    appendAudit(event);
    return;
  }

  await prisma.auditEvent.create({
    data: {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: event.tenantId,
      branchId: event.branchId,
      userId: event.userId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata as Prisma.InputJsonValue
    }
  });
}

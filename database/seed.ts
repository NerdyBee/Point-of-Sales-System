import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { databaseConfigForMariaDbAdapter } from "../server/api/src/shared/db/databaseUrl";
import { permissionCatalog, permissionsByRole } from "../server/api/src/shared/security/accessControl";
import {
  approvalRequests,
  auditEvents,
  authSessions,
  branches,
  cashMovements,
  customerLedger,
  customers,
  demoProducts,
  demoTenants,
  expenses,
  paymentRecords,
  prepTickets,
  registerShifts,
  restaurantTables,
  saleLedger,
  staffMembers,
  stockMovements,
  subscriptionInvoices,
  syncQueueRecords,
  tenantSubscriptions,
  suppliers,
  tableOrders,
  tableReservations,
  terminals
} from "../server/api/src/shared/data/demoStore";

const adapter = new PrismaMariaDb(databaseConfigForMariaDbAdapter());
const prisma = new PrismaClient({ adapter });

function dateOrNull(value?: string) {
  return value ? new Date(value) : null;
}

function dateOrNow(value?: string) {
  return value ? new Date(value) : new Date();
}

async function clearDatabase() {
  await prisma.auditEvent.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.accessRolePermission.deleteMany();
  await prisma.accessRole.deleteMany();
  await prisma.accessPermission.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.syncQueueRecord.deleteMany();
  await prisma.subscriptionInvoice.deleteMany();
  await prisma.tenantSubscription.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.prepTicket.deleteMany();
  await prisma.tableReservation.deleteMany();
  await prisma.tableOrder.deleteMany();
  await prisma.restaurantTable.deleteMany();
  await prisma.cashMovement.deleteMany();
  await prisma.paymentRecord.deleteMany();
  await prisma.completedSale.deleteMany();
  await prisma.registerShift.deleteMany();
  await prisma.staffMember.deleteMany();
  await prisma.customerLedgerEntry.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.supplierProduct.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.product.deleteMany();
  await prisma.terminal.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.tenant.deleteMany();
}

async function seedDatabase() {
  await prisma.tenant.createMany({
    data: demoTenants.map((tenant) => ({
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      branchLimit: tenant.branchLimit,
      activeBranches: tenant.activeBranches,
      settings: tenant.settings
    }))
  });

  await prisma.branch.createMany({
    data: branches.map((branch) => ({
      ...branch,
      createdAt: dateOrNow(branch.createdAt)
    }))
  });

  await prisma.terminal.createMany({
    data: terminals.map((terminal) => ({
      ...terminal,
      lastSeenAt: dateOrNull(terminal.lastSeenAt),
      createdAt: dateOrNow(terminal.createdAt)
    }))
  });

  await prisma.syncQueueRecord.createMany({
    data: syncQueueRecords.map((record) => ({
      ...record,
      payload: record.payload,
      lastAttemptAt: dateOrNull(record.lastAttemptAt),
      syncedAt: dateOrNull(record.syncedAt),
      createdAt: dateOrNow(record.createdAt),
      updatedAt: dateOrNow(record.updatedAt)
    }))
  });

  await prisma.product.createMany({
    data: demoProducts.map((product) => ({
      id: product.id,
      tenantId: product.tenantId,
      branchId: product.branchId,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      category: product.category,
      price: product.price,
      cost: product.cost,
      taxRate: product.taxRate,
      image: product.image,
      stock: product.stock,
      reorderPoint: product.reorderPoint,
      station: product.station,
      modifiers: product.modifiers
    }))
  });

  await prisma.supplier.createMany({
    data: suppliers.map(({ productIds: _productIds, ...supplier }) => supplier)
  });

  await prisma.supplierProduct.createMany({
    data: suppliers.flatMap((supplier) => supplier.productIds.map((productId) => ({ supplierId: supplier.id, productId })))
  });

  await prisma.stockMovement.createMany({
    data: stockMovements.map((movement) => ({
      ...movement,
      createdAt: dateOrNow(movement.createdAt)
    }))
  });

  await prisma.restaurantTable.createMany({
    data: restaurantTables.map((table) => ({
      ...table,
      openedAt: dateOrNull(table.openedAt)
    }))
  });

  await prisma.tableOrder.createMany({
    data: tableOrders.map((order) => ({
      ...order,
      items: order.items,
      openedAt: dateOrNow(order.openedAt),
      billRequestedAt: dateOrNull(order.billRequestedAt)
    }))
  });

  await prisma.tableReservation.createMany({
    data: tableReservations.map((reservation) => ({
      ...reservation,
      reservedAt: dateOrNow(reservation.reservedAt),
      createdAt: dateOrNow(reservation.createdAt)
    }))
  });

  await prisma.prepTicket.createMany({
    data: prepTickets.map((ticket) => ({
      ...ticket,
      items: ticket.items,
      createdAt: dateOrNow(ticket.createdAt),
      acceptedAt: dateOrNull(ticket.acceptedAt),
      readyAt: dateOrNull(ticket.readyAt),
      servedAt: dateOrNull(ticket.servedAt),
      cancelledAt: dateOrNull(ticket.cancelledAt)
    }))
  });

  await prisma.customer.createMany({
    data: customers.map((customer) => ({
      ...customer,
      lastVisitAt: dateOrNull(customer.lastVisitAt),
      createdAt: dateOrNow(customer.createdAt)
    }))
  });

  await prisma.customerLedgerEntry.createMany({
    data: customerLedger.map((entry) => ({
      ...entry,
      createdAt: dateOrNow(entry.createdAt)
    }))
  });

  await prisma.staffMember.createMany({
    data: staffMembers.map((member) => ({
      ...member,
      invitedAt: dateOrNull(member.invitedAt),
      inviteExpiresAt: dateOrNull(member.inviteExpiresAt),
      lastSeenAt: dateOrNull(member.lastSeenAt),
      createdAt: dateOrNow(member.createdAt)
    }))
  });

  await prisma.accessPermission.createMany({
    data: demoTenants.flatMap((tenant) => permissionCatalog.map((permission) => ({
      id: `perm-${tenant.id}-${permission.action}`,
      tenantId: tenant.id,
      action: permission.action,
      label: permission.label,
      group: permission.group,
      description: permission.description
    })))
  });

  await prisma.accessRole.createMany({
    data: demoTenants.flatMap((tenant) => Object.keys(permissionsByRole).map((roleName) => ({
      id: `role-${tenant.id}-${roleName}`,
      tenantId: tenant.id,
      name: roleName,
      label: roleName.split("_").map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" "),
      description: `${roleName} system role`,
      system: true
    })))
  });

  const accessPermissions = await prisma.accessPermission.findMany();
  const permissionIdByTenantAction = new Map(accessPermissions.map((permission) => [`${permission.tenantId}:${permission.action}`, permission.id]));
  await prisma.accessRolePermission.createMany({
    data: demoTenants.flatMap((tenant) => Object.entries(permissionsByRole).flatMap(([roleName, actions]) => actions.map((action) => ({
      roleId: `role-${tenant.id}-${roleName}`,
      permissionId: permissionIdByTenantAction.get(`${tenant.id}:${action}`)!
    }))))
  });

  if (authSessions.length > 0) {
    await prisma.authSession.createMany({
      data: authSessions.map((session) => ({
        ...session,
        expiresAt: dateOrNow(session.expiresAt),
        revokedAt: dateOrNull(session.revokedAt),
        lastSeenAt: dateOrNull(session.lastSeenAt),
        createdAt: dateOrNow(session.createdAt)
      }))
    });
  }

  await prisma.registerShift.createMany({
    data: registerShifts.map((shift) => ({
      ...shift,
      openedAt: dateOrNow(shift.openedAt),
      closedAt: dateOrNull(shift.closedAt)
    }))
  });

  await prisma.completedSale.createMany({
    data: saleLedger.map((sale) => ({
      ...sale,
      summary: sale.summary,
      receipt: sale.receipt,
      createdAt: dateOrNow(sale.createdAt),
      updatedAt: dateOrNow(sale.updatedAt)
    }))
  });

  await prisma.paymentRecord.createMany({
    data: paymentRecords.map((payment) => ({
      ...payment,
      createdAt: dateOrNow(payment.createdAt)
    }))
  });

  await prisma.cashMovement.createMany({
    data: cashMovements.map((movement) => ({
      ...movement,
      createdAt: dateOrNow(movement.createdAt)
    }))
  });

  await prisma.expense.createMany({
    data: expenses.map((expense) => ({
      ...expense,
      spentAt: dateOrNow(expense.spentAt),
      approvedAt: dateOrNull(expense.approvedAt),
      paidAt: dateOrNull(expense.paidAt),
      createdAt: dateOrNow(expense.createdAt),
      updatedAt: dateOrNow(expense.updatedAt)
    }))
  });

  await prisma.tenantSubscription.createMany({
    data: tenantSubscriptions.map((subscription) => ({
      ...subscription,
      renewalDate: dateOrNow(subscription.renewalDate),
      trialEndsAt: dateOrNull(subscription.trialEndsAt),
      graceEndsAt: dateOrNull(subscription.graceEndsAt),
      createdAt: dateOrNow(subscription.createdAt),
      updatedAt: dateOrNow(subscription.updatedAt)
    }))
  });

  await prisma.subscriptionInvoice.createMany({
    data: subscriptionInvoices.map((invoice) => ({
      ...invoice,
      issuedAt: dateOrNow(invoice.issuedAt),
      dueAt: dateOrNow(invoice.dueAt),
      paidAt: dateOrNull(invoice.paidAt),
      createdAt: dateOrNow(invoice.createdAt)
    }))
  });

  await prisma.approvalRequest.createMany({
    data: approvalRequests.map((approval) => ({
      ...approval,
      decidedAt: dateOrNull(approval.decidedAt),
      createdAt: dateOrNow(approval.createdAt)
    }))
  });

  await prisma.auditEvent.createMany({
    data: auditEvents.map((event) => ({
      ...event,
      createdAt: dateOrNow(event.createdAt)
    }))
  });
}

async function main() {
  await clearDatabase();
  await seedDatabase();

  const [tenantCount, branchCount, terminalCount, productCount, supplierCount, expenseCount, subscriptionCount, subscriptionInvoiceCount, syncQueueCount] = await Promise.all([
    prisma.tenant.count(),
    prisma.branch.count(),
    prisma.terminal.count(),
    prisma.product.count(),
    prisma.supplier.count(),
    prisma.expense.count(),
    prisma.tenantSubscription.count(),
    prisma.subscriptionInvoice.count(),
    prisma.syncQueueRecord.count()
  ]);

  console.log(`Seeded MySQL: ${tenantCount} tenants, ${branchCount} branches, ${terminalCount} terminals, ${productCount} products, ${supplierCount} suppliers, ${expenseCount} expenses, ${subscriptionCount} subscriptions, ${subscriptionInvoiceCount} subscription invoices, ${syncQueueCount} sync records`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

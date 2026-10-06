import type { PermissionAction } from "@pos/types";
import { paymentMethodSchema } from "@pos/validation";
import type { Prisma, SyncNode } from "@prisma/client";
import { z } from "zod";
import { registerShifts, staffMembers } from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";
import { requestApproval } from "../approvals/approvals.repository";
import { createCustomer } from "../customers/customers.repository";
import { openRegisterShift } from "../registers/registers.repository";
import { getRolePermissions } from "../roles/roles.repository";
import { createSale } from "../sales/sales.repository";
import type { DeviceCommand, DeviceCommandResult } from "./sync.wire";

/**
 * Tablets never write rows directly. They queue *commands* while offline and the
 * server replays them through the same repositories the web app uses, so every
 * business rule (pricing, tax, credit limits, audit, stock movements) applies.
 * Results flow back to the tablet through the normal change feed.
 */

const useDemoStore = process.env.NODE_ENV === "test";

export interface CommandContext {
  tenantId: string;
  branchId: string;
  terminalId: string;
  nodeId: string;
  idMap: IdMapStore;
}

export interface IdMapStore {
  get(localId: string): Promise<string | undefined>;
  set(localId: string, entityType: string, serverId: string): Promise<void>;
}

export function prismaIdMap(nodeId: string): IdMapStore {
  return {
    async get(localId) {
      const mapping = await prisma.syncIdMap.findUnique({ where: { nodeId_localId: { nodeId, localId } } });
      return mapping?.serverId;
    },
    async set(localId, entityType, serverId) {
      await prisma.syncIdMap.upsert({
        where: { nodeId_localId: { nodeId, localId } },
        create: { nodeId, localId, entityType, serverId },
        update: { serverId, entityType }
      });
    }
  };
}

export function memoryIdMap(): IdMapStore {
  const map = new Map<string, string>();
  return {
    async get(localId) {
      return map.get(localId);
    },
    async set(localId, _entityType, serverId) {
      map.set(localId, serverId);
    }
  };
}

const localIdPrefix = "local-";

async function resolveId(context: CommandContext, id: string | undefined) {
  if (!id || !id.startsWith(localIdPrefix)) return id;
  return context.idMap.get(id);
}

const registerOpenSchema = z.object({
  localShiftId: z.string().min(1).max(120),
  openingBalance: z.number().int().nonnegative()
});

const registerCloseSchema = z.object({
  shiftId: z.string().min(1).max(120),
  countedCash: z.number().int().nonnegative(),
  note: z.string().max(160).optional()
});

const saleCreateSchema = z.object({
  localSaleId: z.string().min(1).max(120),
  idempotencyKey: z.string().min(12).max(160),
  customerId: z.string().max(120).optional(),
  tableId: z.string().max(64).optional(),
  tableOrderId: z.string().max(64).optional(),
  lines: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().positive(),
    discount: z.number().min(0).default(0),
    note: z.string().max(280).optional(),
    unitPrice: z.number().int().nonnegative().optional()
  })).min(1),
  payments: z.array(z.object({
    method: paymentMethodSchema,
    amount: z.number().int().nonnegative(),
    reference: z.string().max(120).optional()
  })).min(1)
});

const customerCreateSchema = z.object({
  localCustomerId: z.string().min(1).max(120),
  name: z.string().min(2).max(160),
  phone: z.string().min(7).max(32),
  email: z.string().email().max(160).optional().or(z.literal("")),
  group: z.enum(["Walk-in", "VIP", "Credit account", "Wholesale", "Staff"]).default("Walk-in"),
  notes: z.string().max(500).optional()
});

const commandPermission: Record<DeviceCommand["type"], PermissionAction> = {
  "register.open": "register.manage",
  "register.close": "register.manage",
  "cash_movement.create": "register.manage",
  "sale.create": "sale.create",
  "customer.create": "customer.manage"
};

const statusMessages: Record<string, string> = {
  no_open_shift: "No open register shift on the server for this tablet",
  payment_total_mismatch: "Payments do not match the server total (tax or service charge settings changed)",
  payment_disabled: "A payment method used is disabled for this business",
  credit_limit_exceeded: "Customer credit limit exceeded",
  credit_requires_customer: "Credit payments need a customer",
  customer_not_found: "Customer not found on the server",
  stock_not_found: "A product in this sale no longer exists at this branch",
  approval_required: "Discount needs a manager approval",
  branch_not_active: "Branch is paused",
  terminal_not_found: "Terminal no longer exists",
  terminal_branch_mismatch: "Terminal was moved to another branch",
  duplicate_phone: "A customer with this phone already exists"
};

function rejection(id: string, status: string): DeviceCommandResult {
  return { id, status: "conflict", error: statusMessages[status] ?? status.replaceAll("_", " ") };
}

async function staffForCommand(tenantId: string, staffId: string) {
  if (useDemoStore) {
    const staff = staffMembers.find((member) => member.tenantId === tenantId && member.id === staffId && member.active);
    return staff ? { id: staff.id, role: staff.role } : null;
  }
  return prisma.staffMember.findFirst({ where: { tenantId, id: staffId, active: true }, select: { id: true, role: true } });
}

async function findOpenShiftId(context: CommandContext) {
  if (useDemoStore) {
    return registerShifts.find((shift) => shift.tenantId === context.tenantId && shift.terminalId === context.terminalId && shift.status === "open")?.id;
  }
  const shift = await prisma.registerShift.findFirst({
    where: { tenantId: context.tenantId, terminalId: context.terminalId, status: "open" },
    select: { id: true }
  });
  return shift?.id;
}

export async function executeDeviceCommand(context: CommandContext, command: DeviceCommand): Promise<DeviceCommandResult> {
  const permission = commandPermission[command.type];
  if (!permission) return { id: command.id, status: "conflict", error: `Unknown command ${command.type}` };

  const staff = await staffForCommand(context.tenantId, command.staffId);
  if (!staff) return { id: command.id, status: "conflict", error: "Staff member is inactive or unknown" };
  const permissions = await getRolePermissions(context.tenantId, staff.role);
  if (!permissions.includes(permission)) return { id: command.id, status: "conflict", error: `Staff lacks ${permission} permission` };

  const createdAt = new Date(command.createdAt);
  const at = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;

  switch (command.type) {
    case "register.open": {
      const payload = registerOpenSchema.safeParse(command.payload);
      if (!payload.success) return { id: command.id, status: "conflict", error: "Invalid register.open payload" };

      const result = await openRegisterShift(
        context.tenantId,
        staff.id,
        { branchId: context.branchId, terminalId: context.terminalId, openingBalance: payload.data.openingBalance },
        { replay: true, openedAt: at }
      );
      const shiftId = result.status === "opened" ? result.shift.id : result.status === "already_open" ? await findOpenShiftId(context) : undefined;
      if (!shiftId) return rejection(command.id, result.status);

      await context.idMap.set(payload.data.localShiftId, "register_shift", shiftId);
      return {
        id: command.id,
        status: "synced",
        serverEntityId: shiftId,
        idMap: { [payload.data.localShiftId]: shiftId },
        error: result.status === "already_open" ? "Joined the shift that was already open on the server" : undefined
      };
    }

    case "register.close": {
      const payload = registerCloseSchema.safeParse(command.payload);
      if (!payload.success) return { id: command.id, status: "conflict", error: "Invalid register.close payload" };
      const shiftId = await resolveId(context, payload.data.shiftId);
      if (!shiftId) return { id: command.id, status: "conflict", error: "Shift has not been synced to the server" };

      // Closing a register always needs a manager approval on this platform, so the
      // tablet's count becomes an approval request that a manager finalises.
      const result = await requestApproval(context.tenantId, staff.id, {
        branchId: context.branchId,
        type: "register_close",
        entityType: "registerShift",
        entityId: shiftId,
        amount: 0,
        reason: `Tablet count ${payload.data.countedCash}${payload.data.note ? `: ${payload.data.note}` : ""}`.slice(0, 180),
        requestedBy: staff.id
      });
      if (!("approval" in result) || !result.approval) return rejection(command.id, result.status);
      return { id: command.id, status: "synced", serverEntityId: result.approval.id };
    }

    case "sale.create": {
      const payload = saleCreateSchema.safeParse(command.payload);
      if (!payload.success) return { id: command.id, status: "conflict", error: "Invalid sale.create payload" };
      const sale = payload.data;

      const customerId = await resolveId(context, sale.customerId);
      if (sale.customerId && !customerId) return { id: command.id, status: "conflict", error: "Customer has not been synced to the server" };

      const unitPriceOverrides = Object.fromEntries(
        sale.lines.filter((line) => line.unitPrice !== undefined).map((line) => [line.productId, line.unitPrice!])
      );
      const result = await createSale(
        context.tenantId,
        staff.id,
        {
          branchId: context.branchId,
          terminalId: context.terminalId,
          customerId,
          tableId: sale.tableId,
          tableOrderId: sale.tableOrderId,
          idempotencyKey: sale.idempotencyKey,
          lines: sale.lines.map((line) => ({ productId: line.productId, quantity: line.quantity, discount: line.discount, note: line.note })),
          payments: sale.payments
        },
        { replay: true, unitPriceOverrides }
      );

      if (result.status !== "created" && result.status !== "replayed") return rejection(command.id, result.status);
      const saleId = result.response.saleId;
      await context.idMap.set(sale.localSaleId, "sale", saleId);
      return { id: command.id, status: "synced", serverEntityId: saleId, idMap: { [sale.localSaleId]: saleId } };
    }

    case "customer.create": {
      const payload = customerCreateSchema.safeParse(command.payload);
      if (!payload.success) return { id: command.id, status: "conflict", error: "Invalid customer.create payload" };
      const input = payload.data;

      const result = await createCustomer(context.tenantId, context.branchId, staff.id, {
        name: input.name,
        phone: input.phone,
        email: input.email || undefined,
        group: input.group,
        creditLimit: 0,
        loyaltyPoints: 0,
        notes: input.notes
      });

      let customerId = result.status === "created" ? result.customer.id : undefined;
      if (result.status === "duplicate_phone" && !useDemoStore) {
        // Same phone captured on another device/branch: reuse that customer.
        customerId = (await prisma.customer.findFirst({ where: { tenantId: context.tenantId, phone: input.phone }, select: { id: true } }))?.id;
      }
      if (!customerId) return rejection(command.id, result.status);

      await context.idMap.set(input.localCustomerId, "customer", customerId);
      return { id: command.id, status: "synced", serverEntityId: customerId, idMap: { [input.localCustomerId]: customerId } };
    }

    default:
      return { id: command.id, status: "conflict", error: `${command.type} is not supported from devices yet` };
  }
}

const recordTypes: Record<DeviceCommand["type"], string> = {
  "register.open": "register_shift",
  "register.close": "register_shift",
  "cash_movement.create": "cash_movement",
  "sale.create": "sale",
  "customer.create": "customer"
};

function nextSyncId() {
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Runs a device's commands in order and records each one in sync_queue_records
 * (visible in the admin Sync monitor). Already-processed commands are answered
 * from the record, so a tablet can safely resend after a lost response.
 * Processing stops at the first command that is not synced, because later
 * commands may depend on it (e.g. a sale on a shift that failed to open).
 */
export async function processDeviceCommands(node: SyncNode, commands: DeviceCommand[]) {
  if (!node.terminalId) throw new Error("Device node has no terminal");
  const terminal = await prisma.terminal.findFirst({ where: { tenantId: node.tenantId, id: node.terminalId } });
  if (!terminal) return commands.map((command) => ({ id: command.id, status: "conflict" as const, error: "Terminal no longer exists" }));

  const context: CommandContext = {
    tenantId: node.tenantId,
    branchId: terminal.branchId,
    terminalId: terminal.id,
    nodeId: node.id,
    idMap: prismaIdMap(node.id)
  };

  const results: DeviceCommandResult[] = [];
  for (const command of commands) {
    const result = await processOne(context, node, command);
    results.push(result);
    if (result.status !== "synced") break;
  }

  await prisma.syncNode.update({ where: { id: node.id }, data: { lastPushAt: new Date() } }).catch(() => undefined);
  return results;
}

function storedResult(record: { payload: Prisma.JsonValue; status: string; serverEntityId: string | null; error: string | null }, id: string): DeviceCommandResult {
  const payload = record.payload as { result?: DeviceCommandResult };
  return payload.result ?? { id, status: record.status as DeviceCommandResult["status"], serverEntityId: record.serverEntityId ?? undefined, error: record.error ?? undefined };
}

async function processOne(context: CommandContext, node: SyncNode, command: DeviceCommand): Promise<DeviceCommandResult> {
  const idempotencyKey = `${node.id}:${command.id}`.slice(0, 180);
  const existing = await prisma.syncQueueRecord.findUnique({ where: { tenantId_idempotencyKey: { tenantId: node.tenantId, idempotencyKey } } });

  // synced / conflict are final until a manager re-queues the record; failed (an
  // unexpected error) is retried when the device resends.
  const stuckProcessing = existing?.status === "processing" && Date.now() - existing.updatedAt.getTime() > 2 * 60 * 1000;
  if (existing && (existing.status === "synced" || existing.status === "conflict" || (existing.status === "processing" && !stuckProcessing))) {
    return storedResult(existing, command.id);
  }

  const record = existing
    ? await prisma.syncQueueRecord.update({ where: { id: existing.id }, data: { status: "processing", attempts: { increment: 1 }, lastAttemptAt: new Date() } })
    : await prisma.syncQueueRecord.create({
        data: {
          id: nextSyncId(),
          tenantId: node.tenantId,
          branchId: context.branchId,
          terminalId: context.terminalId,
          recordType: recordTypes[command.type] ?? "device_command",
          operation: "create",
          idempotencyKey,
          payload: { source: "device", nodeId: node.id, command } as unknown as Prisma.InputJsonValue,
          status: "processing",
          attempts: 1,
          lastAttemptAt: new Date(),
          createdBy: command.staffId.slice(0, 80)
        }
      });

  let result: DeviceCommandResult;
  try {
    result = await executeDeviceCommand(context, command);
  } catch (error) {
    result = { id: command.id, status: "failed", error: error instanceof Error ? error.message.slice(0, 230) : "Unexpected error" };
  }

  await prisma.syncQueueRecord.update({
    where: { id: record.id },
    data: {
      status: result.status,
      serverEntityId: result.serverEntityId?.slice(0, 80) ?? null,
      error: result.error?.slice(0, 240) ?? null,
      syncedAt: result.status === "synced" ? new Date() : null,
      payload: { source: "device", nodeId: node.id, command, result } as unknown as Prisma.InputJsonValue
    }
  });

  return result;
}

/** Re-runs device commands a manager re-queued from the Sync monitor. */
export async function processRequeuedDeviceCommands(tenantId?: string) {
  const records = await prisma.syncQueueRecord.findMany({
    where: { status: "queued", ...(tenantId ? { tenantId } : {}) },
    orderBy: { createdAt: "asc" },
    take: 50
  });

  for (const record of records) {
    const payload = record.payload as { source?: string; nodeId?: string; command?: DeviceCommand };
    if (payload.source !== "device" || !payload.nodeId || !payload.command) continue;
    const node = await prisma.syncNode.findUnique({ where: { id: payload.nodeId } });
    if (!node) continue;
    await prisma.syncQueueRecord.update({ where: { id: record.id }, data: { status: "failed" } });
    await processDeviceCommands(node, [payload.command]);
  }
}

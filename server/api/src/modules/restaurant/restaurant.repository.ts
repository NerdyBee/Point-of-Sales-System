import type {
  PrepTicket as DbPrepTicket,
  RestaurantTable as DbRestaurantTable,
  TableOrder as DbTableOrder,
  TableReservation as DbTableReservation
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import {
  appendAudit,
  branches,
  demoProducts,
  prepTickets,
  restaurantTables,
  tableOrders,
  tableReservations,
  type PrepTicket,
  type PrepTicketItem,
  type PrepTicketStatus,
  type RestaurantTable,
  type TableOrder,
  type TableOrderItem,
  type TableReservation
} from "../../shared/data/demoStore";
import { prisma } from "../../shared/db/prisma";

const useDemoStore = process.env.NODE_ENV === "test";
type BranchScopeFilter = { branchId?: string; branchIds?: string[] };

type AuditInput = Parameters<typeof appendAudit>[0];

function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ticketPrefix(station: TableOrderItem["station"]) {
  if (station === "Bar") return "BOT";
  if (station === "Counter") return "COT";
  return "KOT";
}

function toApiTable(table: DbRestaurantTable): RestaurantTable {
  return {
    id: table.id,
    tenantId: table.tenantId,
    branchId: table.branchId,
    area: table.area,
    label: table.label,
    seats: table.seats,
    state: table.state as RestaurantTable["state"],
    guests: table.guests,
    waiterId: table.waiterId ?? undefined,
    orderId: table.orderId ?? undefined,
    customerName: table.customerName ?? undefined,
    specialInstructions: table.specialInstructions ?? undefined,
    x: table.x,
    y: table.y,
    openedAt: table.openedAt?.toISOString()
  };
}

function toApiOrder(order: DbTableOrder): TableOrder {
  return {
    id: order.id,
    tenantId: order.tenantId,
    branchId: order.branchId,
    tableId: order.tableId,
    guests: order.guests,
    waiterId: order.waiterId,
    customerName: order.customerName ?? undefined,
    specialInstructions: order.specialInstructions ?? undefined,
    items: order.items as unknown as TableOrderItem[],
    prepStatus: (order.prepStatus ?? undefined) as TableOrder["prepStatus"],
    status: order.status as TableOrder["status"],
    openedAt: order.openedAt.toISOString(),
    billRequestedAt: order.billRequestedAt?.toISOString()
  };
}

function toApiReservation(reservation: DbTableReservation): TableReservation {
  return {
    id: reservation.id,
    tenantId: reservation.tenantId,
    branchId: reservation.branchId,
    tableId: reservation.tableId,
    tableLabel: reservation.tableLabel,
    customerName: reservation.customerName,
    phone: reservation.phone,
    guests: reservation.guests,
    reservedAt: reservation.reservedAt.toISOString(),
    durationMinutes: reservation.durationMinutes,
    status: reservation.status as TableReservation["status"],
    note: reservation.note ?? undefined,
    createdAt: reservation.createdAt.toISOString(),
    createdBy: reservation.createdBy
  };
}

function toApiTicket(ticket: DbPrepTicket): PrepTicket {
  return {
    id: ticket.id,
    tenantId: ticket.tenantId,
    branchId: ticket.branchId,
    tableOrderId: ticket.tableOrderId ?? undefined,
    station: ticket.station as PrepTicket["station"],
    tableLabel: ticket.tableLabel,
    waiterId: ticket.waiterId,
    serviceType: ticket.serviceType as PrepTicket["serviceType"],
    priority: ticket.priority as PrepTicket["priority"],
    status: ticket.status as PrepTicket["status"],
    items: ticket.items as unknown as PrepTicketItem[],
    createdAt: ticket.createdAt.toISOString(),
    acceptedAt: ticket.acceptedAt?.toISOString(),
    readyAt: ticket.readyAt?.toISOString(),
    servedAt: ticket.servedAt?.toISOString(),
    cancelledAt: ticket.cancelledAt?.toISOString()
  };
}

async function createAudit(tx: Prisma.TransactionClient, event: AuditInput) {
  await tx.auditEvent.create({
    data: {
      id: nextId("audit"),
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

function prepStatusForTickets(tickets: Array<Pick<PrepTicket, "status">>) {
  if (tickets.length === 0) return "new";
  if (tickets.every((ticket) => ticket.status === "served")) return "served";
  if (tickets.some((ticket) => ticket.status === "ready" || ticket.status === "served")) return "ready";
  if (tickets.some((ticket) => ticket.status === "preparing" || ticket.status === "accepted")) return "preparing";
  return "new";
}

function syncDemoTableOrderPrepStatus(tableOrderId?: string) {
  if (!tableOrderId) return;
  const order = tableOrders.find((item) => item.id === tableOrderId);
  if (!order) return;
  order.prepStatus = prepStatusForTickets(prepTickets.filter((ticket) => ticket.tableOrderId === tableOrderId && ticket.status !== "cancelled"));
}

async function syncDbTableOrderPrepStatus(tx: Prisma.TransactionClient, tableOrderId?: string | null) {
  if (!tableOrderId) return;
  const tickets = await tx.prepTicket.findMany({
    where: { tableOrderId, status: { not: "cancelled" } },
    select: { status: true }
  });
  await tx.tableOrder.update({ where: { id: tableOrderId }, data: { prepStatus: prepStatusForTickets(tickets as Array<Pick<PrepTicket, "status">>) } });
}

function routeDemoItemToPrepTicket(order: TableOrder, tableLabel: string, item: TableOrderItem) {
  const activeTicket = prepTickets.find(
    (ticket) =>
      ticket.tenantId === order.tenantId &&
      ticket.branchId === order.branchId &&
      ticket.tableOrderId === order.id &&
      ticket.station === item.station &&
      !["ready", "served", "cancelled"].includes(ticket.status)
  );
  const prepItem: PrepTicketItem = {
    id: `prep-item-${prepTickets.reduce((sum, ticket) => sum + ticket.items.length, 0) + 1}`,
    productId: item.productId,
    sourceTableItemId: item.id,
    productName: item.productName,
    quantity: item.quantity,
    modifiers: item.modifiers,
    note: item.note,
    status: "new"
  };

  if (activeTicket) {
    activeTicket.items.push(prepItem);
    activeTicket.status = activeTicket.items.some((ticketItem) => ticketItem.status === "preparing") ? "preparing" : activeTicket.status;
    return activeTicket;
  }

  const ticket: PrepTicket = {
    id: `${ticketPrefix(item.station)}-${1091 + prepTickets.length}`,
    tenantId: order.tenantId,
    branchId: order.branchId,
    tableOrderId: order.id,
    station: item.station,
    tableLabel,
    waiterId: order.waiterId,
    serviceType: "dine_in",
    priority: order.status === "bill_requested" ? "rush" : "normal",
    status: "new",
    items: [prepItem],
    createdAt: new Date().toISOString()
  };
  prepTickets.unshift(ticket);
  return ticket;
}

async function routeDbItemToPrepTicket(tx: Prisma.TransactionClient, order: TableOrder, tableLabel: string, item: TableOrderItem) {
  const activeTicket = await tx.prepTicket.findFirst({
    where: {
      tenantId: order.tenantId,
      branchId: order.branchId,
      tableOrderId: order.id,
      station: item.station,
      status: { notIn: ["ready", "served", "cancelled"] }
    },
    orderBy: { createdAt: "desc" }
  });
  const prepItem: PrepTicketItem = {
    id: nextId("prep-item"),
    productId: item.productId,
    sourceTableItemId: item.id,
    productName: item.productName,
    quantity: item.quantity,
    modifiers: item.modifiers,
    note: item.note,
    status: "new"
  };

  if (activeTicket) {
    const items = [...(activeTicket.items as unknown as PrepTicketItem[]), prepItem];
    const ticket = await tx.prepTicket.update({
      where: { id: activeTicket.id },
      data: { items: items as unknown as Prisma.InputJsonValue }
    });
    return toApiTicket(ticket);
  }

  const ticket = await tx.prepTicket.create({
    data: {
      id: `${ticketPrefix(item.station)}-${Date.now()}`,
      tenantId: order.tenantId,
      branchId: order.branchId,
      tableOrderId: order.id,
      station: item.station,
      tableLabel,
      waiterId: order.waiterId,
      serviceType: "dine_in",
      priority: order.status === "bill_requested" ? "rush" : "normal",
      status: "new",
      items: [prepItem] as unknown as Prisma.InputJsonValue
    }
  });
  return toApiTicket(ticket);
}

function matchesBranchScope(scope: BranchScopeFilter, branchId: string) {
  if (scope.branchId) return branchId === scope.branchId;
  if (scope.branchIds?.length) return scope.branchIds.includes(branchId);
  return true;
}

function branchWhere(scope: BranchScopeFilter) {
  if (scope.branchId) return scope.branchId;
  if (scope.branchIds?.length) return { in: scope.branchIds };
  return undefined;
}

export async function getFloorState(tenantId: string, scope: BranchScopeFilter = {}) {
  if (useDemoStore) {
    return {
      tables: restaurantTables.filter((table) => table.tenantId === tenantId && matchesBranchScope(scope, table.branchId)),
      openOrders: tableOrders.filter(
        (order) => order.tenantId === tenantId && matchesBranchScope(scope, order.branchId) && order.status !== "closed" && order.status !== "cancelled"
      ),
      reservations: tableReservations.filter(
        (reservation) =>
          reservation.tenantId === tenantId && matchesBranchScope(scope, reservation.branchId) && reservation.status === "booked"
      )
    };
  }

  const [tables, openOrders, reservations] = await Promise.all([
    prisma.restaurantTable.findMany({ where: { tenantId, branchId: branchWhere(scope) }, orderBy: { label: "asc" } }),
    prisma.tableOrder.findMany({
      where: { tenantId, branchId: branchWhere(scope), status: { notIn: ["closed", "cancelled"] } },
      orderBy: { openedAt: "desc" }
    }),
    prisma.tableReservation.findMany({
      where: { tenantId, branchId: branchWhere(scope), status: "booked" },
      orderBy: { reservedAt: "asc" }
    })
  ]);

  return { tables: tables.map(toApiTable), openOrders: openOrders.map(toApiOrder), reservations: reservations.map(toApiReservation) };
}

export async function createRestaurantTable(tenantId: string, userId: string, input: { branchId: string; area: string; label: string; seats: number; x: number; y: number }) {
  const normalizedLabel = input.label.trim();
  const normalizedArea = input.area.trim();

  if (useDemoStore) {
    const branch = branches.find((item) => item.tenantId === tenantId && item.id === input.branchId);
    if (!branch) return { status: "branch_not_found" as const };
    const duplicate = restaurantTables.find(
      (table) => table.tenantId === tenantId && table.branchId === input.branchId && table.label.toLowerCase() === normalizedLabel.toLowerCase()
    );
    if (duplicate) return { status: "duplicate_label" as const };

    const table: RestaurantTable = {
      id: `table-${restaurantTables.length + 1}`,
      tenantId,
      branchId: input.branchId,
      area: normalizedArea,
      label: normalizedLabel,
      seats: input.seats,
      state: "available",
      guests: 0,
      x: input.x,
      y: input.y
    };
    restaurantTables.push(table);
    appendAudit({
      tenantId,
      branchId: input.branchId,
      userId,
      action: "table.created",
      entityType: "restaurantTable",
      entityId: table.id,
      metadata: { area: table.area, label: table.label, seats: table.seats, x: table.x, y: table.y }
    });
    return { status: "created" as const, table };
  }

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({ where: { tenantId, id: input.branchId } });
    if (!branch) return { status: "branch_not_found" as const };

    const duplicate = await tx.restaurantTable.findFirst({
      where: { tenantId, branchId: input.branchId, label: normalizedLabel }
    });
    if (duplicate) return { status: "duplicate_label" as const };

    const table = await tx.restaurantTable.create({
      data: {
        id: nextId("table"),
        tenantId,
        branchId: input.branchId,
        area: normalizedArea,
        label: normalizedLabel,
        seats: input.seats,
        state: "available",
        guests: 0,
        x: input.x,
        y: input.y
      }
    });
    await createAudit(tx, {
      tenantId,
      branchId: input.branchId,
      userId,
      action: "table.created",
      entityType: "restaurantTable",
      entityId: table.id,
      metadata: { area: table.area, label: table.label, seats: table.seats, x: table.x, y: table.y }
    });
    return { status: "created" as const, table: toApiTable(table) };
  });
}

export async function createReservation(tenantId: string, userId: string, input: Omit<TableReservation, "id" | "tenantId" | "tableLabel" | "status" | "createdAt" | "createdBy">) {
  if (useDemoStore) {
    const table = restaurantTables.find((item) => item.tenantId === tenantId && item.branchId === input.branchId && item.id === input.tableId);
    if (!table) return { status: "table_not_found" as const };
    if (input.guests > table.seats) return { status: "too_many_guests" as const };
    const requestedStart = new Date(input.reservedAt).getTime();
    const requestedEnd = requestedStart + input.durationMinutes * 60 * 1000;
    const conflict = tableReservations.find((reservation) => {
      if (reservation.tenantId !== tenantId || reservation.tableId !== table.id || reservation.status !== "booked") return false;
      const existingStart = new Date(reservation.reservedAt).getTime();
      const existingEnd = existingStart + reservation.durationMinutes * 60 * 1000;
      return requestedStart < existingEnd && requestedEnd > existingStart;
    });
    if (conflict) return { status: "reservation_conflict" as const };

    const reservation = {
      id: `reservation-${tableReservations.length + 1}`,
      tenantId,
      branchId: input.branchId,
      tableId: table.id,
      tableLabel: table.label,
      customerName: input.customerName,
      phone: input.phone,
      guests: input.guests,
      reservedAt: input.reservedAt,
      durationMinutes: input.durationMinutes,
      status: "booked" as const,
      note: input.note,
      createdAt: new Date().toISOString(),
      createdBy: userId
    };
    tableReservations.unshift(reservation);
    if (table.state === "available") {
      table.state = "reserved";
      table.customerName = reservation.customerName;
    }
    appendAudit({
      tenantId,
      branchId: table.branchId,
      userId,
      action: "table.reservation_created",
      entityType: "tableReservation",
      entityId: reservation.id,
      metadata: { tableId: table.id, customerName: reservation.customerName, reservedAt: reservation.reservedAt }
    });
    return { status: "created" as const, table, reservation };
  }

  return prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findFirst({ where: { tenantId, branchId: input.branchId, id: input.tableId } });
    if (!table) return { status: "table_not_found" as const };
    if (input.guests > table.seats) return { status: "too_many_guests" as const };
    const requestedStart = new Date(input.reservedAt);
    const requestedEnd = new Date(requestedStart.getTime() + input.durationMinutes * 60 * 1000);
    const reservations = await tx.tableReservation.findMany({ where: { tenantId, tableId: table.id, status: "booked" } });
    const conflict = reservations.some((reservation) => {
      const existingStart = reservation.reservedAt.getTime();
      const existingEnd = existingStart + reservation.durationMinutes * 60 * 1000;
      return requestedStart.getTime() < existingEnd && requestedEnd.getTime() > existingStart;
    });
    if (conflict) return { status: "reservation_conflict" as const };

    const reservation = await tx.tableReservation.create({
      data: {
        id: nextId("reservation"),
        tenantId,
        branchId: input.branchId,
        tableId: table.id,
        tableLabel: table.label,
        customerName: input.customerName,
        phone: input.phone,
        guests: input.guests,
        reservedAt: requestedStart,
        durationMinutes: input.durationMinutes,
        status: "booked",
        note: input.note,
        createdBy: userId
      }
    });
    const updatedTable =
      table.state === "available"
        ? await tx.restaurantTable.update({ where: { id: table.id }, data: { state: "reserved", customerName: reservation.customerName } })
        : table;
    await createAudit(tx, {
      tenantId,
      branchId: table.branchId,
      userId,
      action: "table.reservation_created",
      entityType: "tableReservation",
      entityId: reservation.id,
      metadata: { tableId: table.id, customerName: reservation.customerName, reservedAt: reservation.reservedAt.toISOString() }
    });
    return { status: "created" as const, table: toApiTable(updatedTable), reservation: toApiReservation(reservation) };
  });
}

export async function updateReservationStatus(
  tenantId: string,
  branchId: string | undefined,
  userId: string,
  reservationId: string,
  input: { status: Extract<TableReservation["status"], "seated" | "cancelled" | "no_show">; note?: string }
) {
  if (useDemoStore) {
    const reservation = tableReservations.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === reservationId);
    if (!reservation) return { status: "reservation_not_found" as const };
    if (reservation.status !== "booked") return { status: "reservation_closed" as const };

    reservation.status = input.status;
    reservation.note = input.note ? [reservation.note, input.note].filter(Boolean).join(" | ") : reservation.note;
    const table = restaurantTables.find((item) => item.tenantId === tenantId && item.id === reservation.tableId);
    if (table && (input.status === "cancelled" || input.status === "no_show") && table.state === "reserved") {
      const hasFutureBooking = tableReservations.some(
        (item) => item.tenantId === tenantId && item.tableId === table.id && item.id !== reservation.id && item.status === "booked"
      );
      if (!hasFutureBooking) {
        table.state = "available";
        table.customerName = undefined;
      }
    }
    appendAudit({
      tenantId,
      branchId: reservation.branchId,
      userId,
      action: "table.reservation_status_changed",
      entityType: "tableReservation",
      entityId: reservation.id,
      metadata: { tableId: reservation.tableId, status: reservation.status, note: input.note }
    });
    return { status: "updated" as const, reservation, table };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.tableReservation.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: reservationId } });
    if (!existing) return { status: "reservation_not_found" as const };
    if (existing.status !== "booked") return { status: "reservation_closed" as const };

    const reservation = await tx.tableReservation.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        note: input.note ? [existing.note, input.note].filter(Boolean).join(" | ") : existing.note
      }
    });
    const table = await tx.restaurantTable.findFirst({ where: { tenantId, id: existing.tableId } });
    let updatedTable = table;

    if (table && (input.status === "cancelled" || input.status === "no_show") && table.state === "reserved") {
      const futureBooking = await tx.tableReservation.findFirst({
        where: { tenantId, tableId: table.id, id: { not: reservation.id }, status: "booked" }
      });
      if (!futureBooking) {
        updatedTable = await tx.restaurantTable.update({ where: { id: table.id }, data: { state: "available", customerName: null } });
      }
    }

    await createAudit(tx, {
      tenantId,
      branchId: reservation.branchId,
      userId,
      action: "table.reservation_status_changed",
      entityType: "tableReservation",
      entityId: reservation.id,
      metadata: { tableId: reservation.tableId, status: reservation.status, note: input.note }
    });
    return { status: "updated" as const, reservation: toApiReservation(reservation), table: updatedTable ? toApiTable(updatedTable) : undefined };
  });
}

export async function openTableOrder(tenantId: string, branchId: string | undefined, userId: string, input: { tableId: string; guests: number; waiterId: string; customerName?: string; specialInstructions?: string }) {
  if (useDemoStore) {
    const table = restaurantTables.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === input.tableId);
    if (!table) return { status: "table_not_found" as const };
    if (table.state === "occupied" || table.state === "awaiting_payment") return { status: "active_order" as const };
    const order = {
      id: `table-order-${tableOrders.length + 1}`,
      tenantId,
      branchId: table.branchId,
      tableId: table.id,
      guests: input.guests,
      waiterId: input.waiterId,
      customerName: input.customerName,
      specialInstructions: input.specialInstructions,
      items: [],
      prepStatus: "new" as const,
      status: "open" as const,
      openedAt: new Date().toISOString()
    };
    tableOrders.unshift(order);
    Object.assign(table, { state: "occupied", guests: input.guests, waiterId: input.waiterId, orderId: order.id, customerName: input.customerName, specialInstructions: input.specialInstructions, openedAt: order.openedAt });
    appendAudit({ tenantId, branchId: table.branchId, userId, action: "table.order_opened", entityType: "tableOrder", entityId: order.id, metadata: { tableId: table.id, guests: order.guests, waiterId: order.waiterId } });
    return { status: "created" as const, table, order };
  }

  return prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: input.tableId } });
    if (!table) return { status: "table_not_found" as const };
    if (table.state === "occupied" || table.state === "awaiting_payment") return { status: "active_order" as const };
    const openedAt = new Date();
    const order = await tx.tableOrder.create({
      data: {
        id: nextId("table-order"),
        tenantId,
        branchId: table.branchId,
        tableId: table.id,
        guests: input.guests,
        waiterId: input.waiterId,
        customerName: input.customerName,
        specialInstructions: input.specialInstructions,
        items: [],
        prepStatus: "new",
        status: "open",
        openedAt
      }
    });
    const updatedTable = await tx.restaurantTable.update({
      where: { id: table.id },
      data: { state: "occupied", guests: input.guests, waiterId: input.waiterId, orderId: order.id, customerName: input.customerName, specialInstructions: input.specialInstructions, openedAt }
    });
    await createAudit(tx, { tenantId, branchId: table.branchId, userId, action: "table.order_opened", entityType: "tableOrder", entityId: order.id, metadata: { tableId: table.id, guests: order.guests, waiterId: order.waiterId } });
    return { status: "created" as const, table: toApiTable(updatedTable), order: toApiOrder(order) };
  });
}

export async function addTableOrderItem(tenantId: string, branchId: string | undefined, userId: string, orderId: string, input: { productId: string; quantity: number; modifiers: string[]; note?: string }) {
  if (useDemoStore) {
    const order = tableOrders.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === orderId && item.status !== "closed" && item.status !== "cancelled");
    if (!order) return { status: "order_not_found" as const };
    const product = demoProducts.find((item) => item.tenantId === tenantId && item.branchId === order.branchId && item.id === input.productId);
    if (!product) return { status: "product_not_found" as const };
    const orderItem = { id: `table-item-${tableOrders.reduce((sum, tableOrder) => sum + tableOrder.items.length, 0) + 1}`, productId: product.id, productName: product.name, station: product.station, quantity: input.quantity, unitPrice: product.price, modifiers: input.modifiers, note: input.note };
    order.items.push(orderItem);
    order.prepStatus = order.prepStatus === "served" ? "new" : order.prepStatus ?? "new";
    const table = restaurantTables.find((item) => item.tenantId === tenantId && item.id === order.tableId);
    const prepTicket = routeDemoItemToPrepTicket(order, table?.label ?? order.tableId, orderItem);
    appendAudit({ tenantId, branchId: order.branchId, userId, action: "table.item_added", entityType: "tableOrder", entityId: order.id, metadata: { productId: product.id, quantity: orderItem.quantity, station: orderItem.station } });
    appendAudit({ tenantId, branchId: order.branchId, userId, action: "prep_ticket.created", entityType: "prepTicket", entityId: prepTicket.id, metadata: { tableOrderId: order.id, itemId: orderItem.id, station: prepTicket.station } });
    return { status: "created" as const, order, item: orderItem, prepTicket };
  }

  return prisma.$transaction(async (tx) => {
    const orderRecord = await tx.tableOrder.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: orderId, status: { notIn: ["closed", "cancelled"] } } });
    if (!orderRecord) return { status: "order_not_found" as const };
    const product = await tx.product.findFirst({ where: { tenantId, branchId: orderRecord.branchId, id: input.productId } });
    if (!product) return { status: "product_not_found" as const };
    const order = toApiOrder(orderRecord);
    const orderItem: TableOrderItem = { id: nextId("table-item"), productId: product.id, productName: product.name, station: product.station as TableOrderItem["station"], quantity: input.quantity, unitPrice: product.price, modifiers: input.modifiers, note: input.note };
    const items = [...order.items, orderItem];
    const updatedOrder = await tx.tableOrder.update({ where: { id: order.id }, data: { items: items as unknown as Prisma.InputJsonValue, prepStatus: order.prepStatus === "served" ? "new" : order.prepStatus ?? "new" } });
    const table = await tx.restaurantTable.findFirst({ where: { tenantId, id: order.tableId } });
    const prepTicket = await routeDbItemToPrepTicket(tx, toApiOrder(updatedOrder), table?.label ?? order.tableId, orderItem);
    await createAudit(tx, { tenantId, branchId: order.branchId, userId, action: "table.item_added", entityType: "tableOrder", entityId: order.id, metadata: { productId: product.id, quantity: orderItem.quantity, station: orderItem.station } });
    await createAudit(tx, { tenantId, branchId: order.branchId, userId, action: "prep_ticket.created", entityType: "prepTicket", entityId: prepTicket.id, metadata: { tableOrderId: order.id, itemId: orderItem.id, station: prepTicket.station } });
    return { status: "created" as const, order: toApiOrder(updatedOrder), item: orderItem, prepTicket };
  });
}

export async function removeTableOrderItem(tenantId: string, branchId: string | undefined, userId: string, orderId: string, itemId: string) {
  if (useDemoStore) {
    const order = tableOrders.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === orderId && item.status !== "closed" && item.status !== "cancelled");
    if (!order) return { status: "order_not_found" as const };
    const item = order.items.find((orderItem) => orderItem.id === itemId);
    if (!item) return { status: "item_not_found" as const };
    order.items = order.items.filter((orderItem) => orderItem.id !== itemId);
    const prepTicket = prepTickets.find((ticket) => ticket.tenantId === tenantId && ticket.tableOrderId === order.id && ticket.items.some((ticketItem) => ticketItem.sourceTableItemId === item.id));
    if (prepTicket) {
      prepTicket.items = prepTicket.items.filter((ticketItem) => ticketItem.sourceTableItemId !== item.id || ticketItem.status !== "new");
      if (prepTicket.items.length === 0) {
        prepTicket.status = "cancelled";
        prepTicket.cancelledAt = new Date().toISOString();
      }
    }
    if (order.items.length === 0) order.prepStatus = "new";
    appendAudit({ tenantId, branchId: order.branchId, userId, action: "table.item_removed", entityType: "tableOrder", entityId: order.id, metadata: { itemId: item.id, productId: item.productId, quantity: item.quantity } });
    return { status: "removed" as const, order, prepTicket };
  }

  return prisma.$transaction(async (tx) => {
    const orderRecord = await tx.tableOrder.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: orderId, status: { notIn: ["closed", "cancelled"] } } });
    if (!orderRecord) return { status: "order_not_found" as const };
    const order = toApiOrder(orderRecord);
    const item = order.items.find((orderItem) => orderItem.id === itemId);
    if (!item) return { status: "item_not_found" as const };
    const updatedItems = order.items.filter((orderItem) => orderItem.id !== itemId);
    const updatedOrder = await tx.tableOrder.update({ where: { id: order.id }, data: { items: updatedItems as unknown as Prisma.InputJsonValue, prepStatus: updatedItems.length === 0 ? "new" : order.prepStatus } });
    const ticketRecord = await tx.prepTicket.findFirst({ where: { tenantId, tableOrderId: order.id } });
    let prepTicket: PrepTicket | undefined;
    if (ticketRecord) {
      const ticketItems = (ticketRecord.items as unknown as PrepTicketItem[]).filter((ticketItem) => ticketItem.sourceTableItemId !== item.id || ticketItem.status !== "new");
      const ticket = await tx.prepTicket.update({ where: { id: ticketRecord.id }, data: { items: ticketItems as unknown as Prisma.InputJsonValue, status: ticketItems.length === 0 ? "cancelled" : ticketRecord.status, cancelledAt: ticketItems.length === 0 ? new Date() : ticketRecord.cancelledAt } });
      prepTicket = toApiTicket(ticket);
    }
    await createAudit(tx, { tenantId, branchId: order.branchId, userId, action: "table.item_removed", entityType: "tableOrder", entityId: order.id, metadata: { itemId: item.id, productId: item.productId, quantity: item.quantity } });
    return { status: "removed" as const, order: toApiOrder(updatedOrder), prepTicket };
  });
}

export async function requestTableBill(tenantId: string, branchId: string | undefined, userId: string, orderId: string, note?: string) {
  if (useDemoStore) {
    const order = tableOrders.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === orderId && item.status !== "closed" && item.status !== "cancelled");
    if (!order) return { status: "order_not_found" as const };
    const table = restaurantTables.find((item) => item.tenantId === tenantId && item.id === order.tableId);
    if (!table) return { status: "table_not_found" as const };
    order.status = "bill_requested";
    order.billRequestedAt = new Date().toISOString();
    table.state = "awaiting_payment";
    appendAudit({ tenantId, branchId: order.branchId, userId, action: "table.bill_requested", entityType: "tableOrder", entityId: order.id, metadata: { tableId: table.id, note, prepStatus: order.prepStatus, totalItems: order.items.length } });
    return { status: "requested" as const, table, order };
  }

  return prisma.$transaction(async (tx) => {
    const orderRecord = await tx.tableOrder.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: orderId, status: { notIn: ["closed", "cancelled"] } } });
    if (!orderRecord) return { status: "order_not_found" as const };
    const tableRecord = await tx.restaurantTable.findFirst({ where: { tenantId, id: orderRecord.tableId } });
    if (!tableRecord) return { status: "table_not_found" as const };
    const order = await tx.tableOrder.update({ where: { id: orderRecord.id }, data: { status: "bill_requested", billRequestedAt: new Date() } });
    const table = await tx.restaurantTable.update({ where: { id: tableRecord.id }, data: { state: "awaiting_payment" } });
    await createAudit(tx, { tenantId, branchId: order.branchId, userId, action: "table.bill_requested", entityType: "tableOrder", entityId: order.id, metadata: { tableId: table.id, note, prepStatus: order.prepStatus, totalItems: (order.items as unknown as TableOrderItem[]).length } });
    return { status: "requested" as const, table: toApiTable(table), order: toApiOrder(order) };
  });
}

export async function transferTableOrder(tenantId: string, branchId: string | undefined, userId: string, orderId: string, input: { targetTableId: string; reason?: string }) {
  if (useDemoStore) {
    const order = tableOrders.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === orderId && item.status !== "closed" && item.status !== "cancelled");
    if (!order) return { status: "order_not_found" as const };
    if (order.tableId === input.targetTableId) return { status: "same_table" as const };

    const sourceTable = restaurantTables.find((item) => item.tenantId === tenantId && item.id === order.tableId);
    const targetTable = restaurantTables.find((item) => item.tenantId === tenantId && item.branchId === order.branchId && item.id === input.targetTableId);
    if (!targetTable) return { status: "target_table_not_found" as const };
    if (targetTable.orderId || ["occupied", "awaiting_payment", "delayed", "unavailable"].includes(targetTable.state)) return { status: "target_unavailable" as const };

    if (sourceTable?.orderId === order.id) {
      Object.assign(sourceTable, { state: "available", guests: 0, waiterId: undefined, orderId: undefined, customerName: undefined, specialInstructions: undefined, openedAt: undefined });
    }

    order.tableId = targetTable.id;
    Object.assign(targetTable, {
      state: order.status === "bill_requested" ? "awaiting_payment" : "occupied",
      guests: order.guests,
      waiterId: order.waiterId,
      orderId: order.id,
      customerName: order.customerName,
      specialInstructions: order.specialInstructions,
      openedAt: order.openedAt
    });
    prepTickets.filter((ticket) => ticket.tenantId === tenantId && ticket.tableOrderId === order.id).forEach((ticket) => {
      ticket.tableLabel = targetTable.label;
    });
    appendAudit({ tenantId, branchId: order.branchId, userId, action: "table.order_transferred", entityType: "tableOrder", entityId: order.id, metadata: { sourceTableId: sourceTable?.id, targetTableId: targetTable.id, reason: input.reason } });
    return { status: "transferred" as const, order, sourceTable, targetTable };
  }

  return prisma.$transaction(async (tx) => {
    const orderRecord = await tx.tableOrder.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: orderId, status: { notIn: ["closed", "cancelled"] } } });
    if (!orderRecord) return { status: "order_not_found" as const };
    if (orderRecord.tableId === input.targetTableId) return { status: "same_table" as const };

    const [sourceTable, targetTable] = await Promise.all([
      tx.restaurantTable.findFirst({ where: { tenantId, id: orderRecord.tableId } }),
      tx.restaurantTable.findFirst({ where: { tenantId, branchId: orderRecord.branchId, id: input.targetTableId } })
    ]);
    if (!targetTable) return { status: "target_table_not_found" as const };
    if (targetTable.orderId || ["occupied", "awaiting_payment", "delayed", "unavailable"].includes(targetTable.state)) return { status: "target_unavailable" as const };

    const [updatedOrder, updatedSourceTable, updatedTargetTable] = await Promise.all([
      tx.tableOrder.update({ where: { id: orderRecord.id }, data: { tableId: targetTable.id } }),
      sourceTable
        ? tx.restaurantTable.update({
            where: { id: sourceTable.id },
            data: { state: "available", guests: 0, waiterId: null, orderId: null, customerName: null, specialInstructions: null, openedAt: null }
          })
        : Promise.resolve(null),
      tx.restaurantTable.update({
        where: { id: targetTable.id },
        data: {
          state: orderRecord.status === "bill_requested" ? "awaiting_payment" : "occupied",
          guests: orderRecord.guests,
          waiterId: orderRecord.waiterId,
          orderId: orderRecord.id,
          customerName: orderRecord.customerName,
          specialInstructions: orderRecord.specialInstructions,
          openedAt: orderRecord.openedAt
        }
      })
    ]);
    await tx.prepTicket.updateMany({ where: { tenantId, tableOrderId: orderRecord.id }, data: { tableLabel: updatedTargetTable.label } });
    await createAudit(tx, { tenantId, branchId: orderRecord.branchId, userId, action: "table.order_transferred", entityType: "tableOrder", entityId: orderRecord.id, metadata: { sourceTableId: sourceTable?.id, targetTableId: targetTable.id, reason: input.reason } });
    return { status: "transferred" as const, order: toApiOrder(updatedOrder), sourceTable: updatedSourceTable ? toApiTable(updatedSourceTable) : undefined, targetTable: toApiTable(updatedTargetTable) };
  });
}

export async function updateTableState(tenantId: string, branchId: string | undefined, userId: string, tableId: string, input: { state: RestaurantTable["state"]; reason?: string }) {
  if (useDemoStore) {
    const table = restaurantTables.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === tableId);
    if (!table) return { status: "table_not_found" as const };
    const previousState = table.state;
    table.state = input.state;
    if (input.state === "available") Object.assign(table, { guests: 0, waiterId: undefined, orderId: undefined, customerName: undefined, specialInstructions: undefined, openedAt: undefined });
    appendAudit({ tenantId, branchId: table.branchId, userId, action: "table.state_changed", entityType: "restaurantTable", entityId: table.id, metadata: { previousState, state: table.state, reason: input.reason } });
    return { status: "updated" as const, table };
  }

  return prisma.$transaction(async (tx) => {
    const table = await tx.restaurantTable.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: tableId } });
    if (!table) return { status: "table_not_found" as const };
    const updatedTable = await tx.restaurantTable.update({
      where: { id: table.id },
      data: input.state === "available" ? { state: input.state, guests: 0, waiterId: null, orderId: null, customerName: null, specialInstructions: null, openedAt: null } : { state: input.state }
    });
    await createAudit(tx, { tenantId, branchId: table.branchId, userId, action: "table.state_changed", entityType: "restaurantTable", entityId: table.id, metadata: { previousState: table.state, state: updatedTable.state, reason: input.reason } });
    return { status: "updated" as const, table: toApiTable(updatedTable) };
  });
}

export async function updateTableLayout(tenantId: string, branchId: string | undefined, userId: string, tableId: string, input: { area: string; label: string; seats: number; x: number; y: number }) {
  if (useDemoStore) {
    const table = restaurantTables.find((item) => item.tenantId === tenantId && (!branchId || item.branchId === branchId) && item.id === tableId);
    if (!table) return { status: "table_not_found" as const };
    Object.assign(table, input);
    appendAudit({ tenantId, branchId: table.branchId, userId, action: "table.layout_updated", entityType: "restaurantTable", entityId: table.id, metadata: input });
    return { status: "updated" as const, table };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.restaurantTable.findFirst({ where: { tenantId, branchId: branchId ? branchId : undefined, id: tableId } });
    if (!existing) return { status: "table_not_found" as const };
    const table = await tx.restaurantTable.update({ where: { id: existing.id }, data: input });
    await createAudit(tx, { tenantId, branchId: table.branchId, userId, action: "table.layout_updated", entityType: "restaurantTable", entityId: table.id, metadata: input });
    return { status: "updated" as const, table: toApiTable(table) };
  });
}

export async function listPrepTickets(tenantId: string, filters: BranchScopeFilter & { station?: string; status?: string }) {
  if (useDemoStore) {
    return prepTickets.filter((ticket) => {
      const branchMatch = matchesBranchScope(filters, ticket.branchId);
      const stationMatch = filters.station && filters.station !== "All" ? ticket.station === filters.station : true;
      const statusMatch = filters.status && filters.status !== "all" ? ticket.status === filters.status : true;
      return ticket.tenantId === tenantId && branchMatch && stationMatch && statusMatch;
    });
  }

  const tickets = await prisma.prepTicket.findMany({
    where: {
      tenantId,
      branchId: branchWhere(filters),
      station: filters.station && filters.station !== "All" ? filters.station : undefined,
      status: filters.status && filters.status !== "all" ? filters.status : undefined
    },
    orderBy: { createdAt: "desc" }
  });
  return tickets.map(toApiTicket);
}

export async function updatePrepTicketStatus(tenantId: string, scope: BranchScopeFilter, userId: string, ticketId: string, input: { status: PrepTicketStatus; note?: string }) {
  if (useDemoStore) {
    const ticket = prepTickets.find((item) => item.tenantId === tenantId && matchesBranchScope(scope, item.branchId) && item.id === ticketId);
    if (!ticket) return { status: "ticket_not_found" as const };
    const previousStatus = ticket.status;
    ticket.status = input.status;
    ticket.items = ticket.items.map((item) => ({ ...item, status: input.status }));
    const now = new Date().toISOString();
    if (input.status === "accepted") ticket.acceptedAt = now;
    if (input.status === "ready") ticket.readyAt = now;
    if (input.status === "served") ticket.servedAt = now;
    if (input.status === "cancelled") ticket.cancelledAt = now;
    syncDemoTableOrderPrepStatus(ticket.tableOrderId);
    appendAudit({ tenantId, branchId: ticket.branchId, userId, action: "prep_ticket.status_changed", entityType: "prepTicket", entityId: ticket.id, metadata: { previousStatus, status: ticket.status, station: ticket.station, note: input.note } });
    return { status: "updated" as const, ticket };
  }

  return prisma.$transaction(async (tx) => {
    const ticketRecord = await tx.prepTicket.findFirst({ where: { tenantId, branchId: branchWhere(scope), id: ticketId } });
    if (!ticketRecord) return { status: "ticket_not_found" as const };
    const previousStatus = ticketRecord.status;
    const items = (ticketRecord.items as unknown as PrepTicketItem[]).map((item) => ({ ...item, status: input.status }));
    const now = new Date();
    const ticket = await tx.prepTicket.update({
      where: { id: ticketRecord.id },
      data: {
        status: input.status,
        items: items as unknown as Prisma.InputJsonValue,
        acceptedAt: input.status === "accepted" ? now : ticketRecord.acceptedAt,
        readyAt: input.status === "ready" ? now : ticketRecord.readyAt,
        servedAt: input.status === "served" ? now : ticketRecord.servedAt,
        cancelledAt: input.status === "cancelled" ? now : ticketRecord.cancelledAt
      }
    });
    await syncDbTableOrderPrepStatus(tx, ticket.tableOrderId);
    await createAudit(tx, { tenantId, branchId: ticket.branchId, userId, action: "prep_ticket.status_changed", entityType: "prepTicket", entityId: ticket.id, metadata: { previousStatus, status: ticket.status, station: ticket.station, note: input.note } });
    return { status: "updated" as const, ticket: toApiTicket(ticket) };
  });
}

export async function updatePrepTicketPriority(tenantId: string, scope: BranchScopeFilter, userId: string, ticketId: string, input: { priority: PrepTicket["priority"]; note?: string }) {
  if (useDemoStore) {
    const ticket = prepTickets.find((item) => item.tenantId === tenantId && matchesBranchScope(scope, item.branchId) && item.id === ticketId);
    if (!ticket) return { status: "ticket_not_found" as const };
    const previousPriority = ticket.priority;
    ticket.priority = input.priority;
    appendAudit({ tenantId, branchId: ticket.branchId, userId, action: "prep_ticket.priority_changed", entityType: "prepTicket", entityId: ticket.id, metadata: { previousPriority, priority: ticket.priority, station: ticket.station, note: input.note } });
    return { status: "updated" as const, ticket };
  }

  return prisma.$transaction(async (tx) => {
    const ticketRecord = await tx.prepTicket.findFirst({ where: { tenantId, branchId: branchWhere(scope), id: ticketId } });
    if (!ticketRecord) return { status: "ticket_not_found" as const };
    const ticket = await tx.prepTicket.update({ where: { id: ticketRecord.id }, data: { priority: input.priority } });
    await createAudit(tx, { tenantId, branchId: ticket.branchId, userId, action: "prep_ticket.priority_changed", entityType: "prepTicket", entityId: ticket.id, metadata: { previousPriority: ticketRecord.priority, priority: ticket.priority, station: ticket.station, note: input.note } });
    return { status: "updated" as const, ticket: toApiTicket(ticket) };
  });
}

export async function updatePrepTicketItemStatus(tenantId: string, scope: BranchScopeFilter, userId: string, ticketId: string, itemId: string, input: { status: Exclude<PrepTicketStatus, "served" | "cancelled">; note?: string }) {
  if (useDemoStore) {
    const ticket = prepTickets.find((item) => item.tenantId === tenantId && matchesBranchScope(scope, item.branchId) && item.id === ticketId);
    if (!ticket) return { status: "ticket_not_found" as const };
    const item = ticket.items.find((ticketItem) => ticketItem.id === itemId);
    if (!item) return { status: "item_not_found" as const };
    const previousStatus = item.status;
    item.status = input.status;
    ticket.status = prepStatusForTickets(ticket.items) as PrepTicketStatus;
    if (ticket.status === "ready") ticket.readyAt = new Date().toISOString();
    syncDemoTableOrderPrepStatus(ticket.tableOrderId);
    appendAudit({ tenantId, branchId: ticket.branchId, userId, action: "prep_ticket.item_status_changed", entityType: "prepTicketItem", entityId: item.id, metadata: { ticketId: ticket.id, previousStatus, status: item.status, station: ticket.station, note: input.note } });
    return { status: "updated" as const, ticket };
  }

  return prisma.$transaction(async (tx) => {
    const ticketRecord = await tx.prepTicket.findFirst({ where: { tenantId, branchId: branchWhere(scope), id: ticketId } });
    if (!ticketRecord) return { status: "ticket_not_found" as const };
    const items = ticketRecord.items as unknown as PrepTicketItem[];
    const item = items.find((ticketItem) => ticketItem.id === itemId);
    if (!item) return { status: "item_not_found" as const };
    const previousStatus = item.status;
    const updatedItems = items.map((ticketItem) => (ticketItem.id === itemId ? { ...ticketItem, status: input.status } : ticketItem));
    const ticketStatus = prepStatusForTickets(updatedItems) as PrepTicketStatus;
    const ticket = await tx.prepTicket.update({
      where: { id: ticketRecord.id },
      data: { items: updatedItems as unknown as Prisma.InputJsonValue, status: ticketStatus, readyAt: ticketStatus === "ready" ? new Date() : ticketRecord.readyAt }
    });
    await syncDbTableOrderPrepStatus(tx, ticket.tableOrderId);
    await createAudit(tx, { tenantId, branchId: ticket.branchId, userId, action: "prep_ticket.item_status_changed", entityType: "prepTicketItem", entityId: item.id, metadata: { ticketId: ticket.id, previousStatus, status: input.status, station: ticket.station, note: input.note } });
    return { status: "updated" as const, ticket: toApiTicket(ticket) };
  });
}

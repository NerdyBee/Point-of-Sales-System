# Sync architecture

NaijaPOS is deployed **one business per installation**. A business can run any of these setups:

| Setup | What runs | Internet needed |
|---|---|---|
| Offline only | One office server (API + MySQL). Optional tablets on the shop Wi-Fi. | No |
| Office + cloud | Office server(s) that also sync with the business's cloud server. | Only for the office↔cloud link |
| Cloud only | The cloud server, plus web browsers and tablets with internet. | Yes |

```
                    ┌──────────────────────┐
                    │  Cloud server        │  NODE_ROLE=cloud
                    │  API + MySQL         │
                    └──────────▲───────────┘
          optional, when online│ rows (push + pull)
         ┌─────────────────────┴──────┐
         │  Office server             │  NODE_ROLE=office  (works fully offline)
         │  API + MySQL               │
         └──────▲──────────────▲──────┘
 commands up,   │ shop Wi-Fi   │
 rows down      │              │
         ┌──────┴─────┐  ┌─────┴──────┐
         │ Tablet     │  │ Web admin  │
         │ (mobile/)  │  │ (browser)  │
         └────────────┘  └────────────┘
```

A tablet can sync with the **office server**, the **cloud**, or **both** (office first, cloud when away from the shop Wi-Fi). This is set on the tablet.

## Servers: change capture and merge

### Change log
`npm run sync -- setup` (also run automatically at API startup) installs `AFTER INSERT/UPDATE/DELETE` triggers on every replicated table. Every write appends a row to `sync_changes`, inside the same transaction:

| column | meaning |
|---|---|
| `seq` | position in this server's log (cursor for readers) |
| `tableName`, `rowId` | the row (composite keys are joined with `|`) |
| `tenantId`, `branchId`, `branchId2` | scope; used to send each office/tablet only what it needs |
| `op` | `I` insert, `U` update, `D` delete |
| `fields` | the columns that actually changed (updates only) |
| `deltas` | `NEW - OLD` for counter columns (see below) |
| `origin` | `local`, or the peer whose change this server just applied |
| `changedAt` | when the change was originally made, carried across hops |

Triggers capture every write path (repositories, `updateMany`, seeds, raw SQL) without touching business code. Existing rows are backfilled as `I` changes the first time.

### What is replicated, and in which direction
The registry is `server/api/src/modules/sync/sync.entities.ts`.

- **Both ways:** branches, terminals, roles/permissions, staff, customers and ledger, products, suppliers, purchasing, stock movements and transfers, register shifts, sales, payments, cash movements, expenses, approvals, restaurant tables/orders/reservations, prep tickets, tenant settings.
- **Cloud → office only:** subscription and subscription invoices.
- **Office → cloud only:** audit events (central audit trail without bloating offices).
- **Never:** auth sessions, sync bookkeeping tables. Each server keeps its own logins.

`rank` encodes the foreign-key order (tenant → branch → product → stock movement …). Every batch is applied parents first and deleted children first, so relationships are never violated.

### Merge rules
1. **Field-level last-writer-wins.** Only the columns a change touched are written. If both sides changed the *same* column, the later `changedAt` wins. If they changed *different* columns, both survive. Example: the office renames a product while the cloud changes its price.
2. **Counters are additive.** `products.stock`, `customers.outstandingBalance`, `customers.loyaltyPoints`, `register_shifts.expectedCash` and `staff_members.salesTotal` replicate as deltas. If the office sells 2 and the cloud sells 3 of an item while disconnected, both end at −5.
3. **Exactly once.** `sync_row_state` stores the last applied source sequence per row, so a re-sent batch never adds a delta twice.
4. **No echo.** Rows written by the sync engine are tagged with the sender in `origin`. Feeds exclude the reader's own origin, so a change is never sent back to where it came from.
5. **Tenant safety.** Incoming rows must belong to the node's tenant, and an existing row of another tenant is never overwritten.
6. **Conflicts don't block.** A row that cannot be applied (for example a missing parent, or a duplicate phone number) is parked in `sync_conflicts`. It is retried on every sync and shown in Admin → Sync monitor.

The feed serves only changes older than 5 seconds. Sequence numbers are allocated before commit, so this window stops a reader skipping a change that commits late.

### Document numbers
Sale ids are primary keys shared by every server, so two disconnected servers must never mint the same number. Every office gets a node code (`sync_identity.nodeCode`, or `NODE_CODE`) and numbers its sales `INV-<CODE>-00001`. The cloud keeps `INV-00001` unless `NODE_CODE` is set.

## Office ↔ cloud link (optional)
1. On the **cloud** admin, open Sync monitor → *Pair a tablet or office* → type *Office server* → create a code.
2. On the **office** admin, open Sync monitor → *Cloud connection* → enter the cloud URL and the code. Alternatively, on the office machine: `npm run sync -- connect --url https://… --code ABCD-EFGH`.
3. The office agent pushes, then pulls, every `SYNC_INTERVAL_MS` (30 s by default).

*Pause* turns the link off: the office keeps working offline and catches up when resumed. *Disconnect* removes the link and the office keeps all its data. Endpoints (`x-sync-token` auth): `GET/POST /api/v1/sync/peer/changes`.

**First connection.** Both sides send their whole history. Rows with the same id are merged, and everything else is added. Use the same business id (tenant id) on both installations.

## Tablets
Tablets never write server rows directly. They:

1. **Pull a read model** from `GET /api/v1/sync/device/changes`: tenant settings, branch, terminals, staff (PIN hashes only, never passwords), roles, customers, the branch's products, shifts, sales and restaurant tables.
2. **Queue commands** while offline (`register.open`, `sale.create`, `customer.create`, `register.close`). They send them in order to `POST /api/v1/sync/device/commands`.

The server replays each command through the same repositories the web app uses, so pricing, VAT, service charge, credit limits, stock movements and audit all apply. Replay differs from a live request in three ways:
- the terminal does not need to be marked *online*;
- stock may go negative, because the goods already left the shop;
- the unit price the tablet charged is honoured, even if the catalogue price changed meanwhile.

Each command is recorded in `sync_queue_records`, so it is visible in the Sync monitor. A resent command is answered from that record and never executed twice. If a command is rejected (`conflict`), a manager can fix the cause and set the record back to *queued* to replay it.

Device ids created offline (`local-…`) are mapped to server ids in `sync_id_map`.

**Routing with office + cloud.** Reads come from the first reachable server (office preferred). Commands for a shift go to the server where the shift was opened, because only that server knows the shift until the office syncs. A command is pinned to the first server it is sent to, so a lost response can't make it run on both.

**Closing the register** always requires a manager approval on this platform. The tablet therefore submits its cash count as a `register_close` approval request, and the manager approves and closes the shift in the web app. Cash in/out movements also need approvals, so they stay in the web app for now.

## Operations
- `npm run sync -- status` shows this server's identity, cloud link and paired nodes.
- `npm run sync -- pair-device --terminal <id> --name "Tablet 1"` creates a tablet code from the command line.
- After `npm run db:push`, restart the API. Startup re-installs any triggers that a table recreation dropped.
- The database user needs the `TRIGGER` privilege. Without it the POS still works, but replication is disabled and startup logs why.

## Known limits
- PIN hashes are unsalted SHA-256 (the existing scheme). A 6-digit PIN can be brute-forced from a stolen tablet's database. Prefer device encryption, and move to a salted slow hash (server and tablet together) before wide rollout.
- Two offline servers creating a **staff member with the same name** produce the same id (`ABC-BRA-NAME`) and would merge. Create staff in one place.
- Two offline servers creating a **customer with the same phone** number produce a conflict for review. The tablet reuses the existing customer when it can.
- Clock skew between servers affects last-writer-wins on the same field. Keep server clocks on NTP.
- `sync_changes` grows over time. Pruning old entries, once every node's cursor is past them, is not automated yet.

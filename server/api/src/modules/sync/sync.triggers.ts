import { createHash } from "node:crypto";
import mariadb, { type Connection } from "mariadb";
import { databaseConfigForMariaDbAdapter } from "../../shared/db/databaseUrl";
import { entityColumns, syncEntities, trackedColumns, type SyncEntity } from "./sync.entities";
import { getNodeIdentity, setTriggerHash } from "./sync.identity";

/**
 * Change capture is done with AFTER INSERT/UPDATE/DELETE triggers rather than in
 * application code, so every write path (repositories, updateMany, cascades into
 * counters, raw SQL, seed scripts) is recorded inside the same transaction.
 *
 * Each logged change carries:
 * - fields:  comma separated columns that actually changed (field-level merge)
 * - deltas:  NEW - OLD for counter columns (additive merge, e.g. stock)
 * - origin:  @sync_origin when the sync engine applies a remote change, else 'local'
 * - changedAt: @sync_changed_at (original authoring time) or UTC_TIMESTAMP(3)
 */

const quote = (identifier: string) => `\`${identifier}\``;

function bind(expression: string, alias: string) {
  return expression.replaceAll("ROW.", `${alias}.`);
}

function rowIdSql(entity: SyncEntity, alias: string) {
  if (entity.pk.length === 1) return `${alias}.${quote(entity.pk[0])}`;
  return `CONCAT_WS('|', ${entity.pk.map((column) => `${alias}.${quote(column)}`).join(", ")})`;
}

function scopeSql(entity: SyncEntity, alias: string) {
  return {
    tenant: `COALESCE(${bind(entity.scope.tenant, alias)}, '')`,
    branch: entity.scope.branch ? bind(entity.scope.branch, alias) : "NULL",
    branch2: entity.scope.branch2 ? bind(entity.scope.branch2, alias) : "NULL"
  };
}

function insertDeltasSql(entity: SyncEntity, alias: string) {
  if (!entity.counters?.length) return "NULL";
  return `JSON_OBJECT(${entity.counters.map((column) => `'${column}', ${alias}.${quote(column)}`).join(", ")})`;
}

const origin = "COALESCE(@sync_origin, 'local')";
const changedAt = "COALESCE(@sync_changed_at, UTC_TIMESTAMP(3))";
const insertColumns = "(tableName, rowId, tenantId, branchId, branchId2, op, fields, deltas, origin, changedAt, loggedAt)";

function triggerName(entity: SyncEntity, suffix: "ai" | "au" | "ad") {
  return `sync_${entity.table}_${suffix}`;
}

export function triggerStatements(entity: SyncEntity) {
  const statements: { name: string; sql: string }[] = [];
  const table = quote(entity.table);

  const newScope = scopeSql(entity, "NEW");
  statements.push({
    name: triggerName(entity, "ai"),
    sql: `CREATE TRIGGER ${triggerName(entity, "ai")} AFTER INSERT ON ${table} FOR EACH ROW
INSERT INTO sync_changes ${insertColumns}
VALUES ('${entity.table}', ${rowIdSql(entity, "NEW")}, ${newScope.tenant}, ${newScope.branch}, ${newScope.branch2}, 'I', NULL, ${insertDeltasSql(entity, "NEW")}, ${origin}, ${changedAt}, UTC_TIMESTAMP(3))`
  });

  const tracked = trackedColumns(entity);
  const counters = entity.counters ?? [];
  if (tracked.length || counters.length) {
    const fieldList = tracked.length
      ? `CONCAT_WS(',', ${tracked.map((column) => `IF(NOT (OLD.${quote(column)} <=> NEW.${quote(column)}), '${column}', NULL)`).join(", ")})`
      : "''";
    const counterChanged = counters.length ? counters.map((column) => `OLD.${quote(column)} <> NEW.${quote(column)}`).join(" OR ") : "FALSE";
    const deltas = counters.length
      ? `JSON_OBJECT(${counters.map((column) => `'${column}', NEW.${quote(column)} - OLD.${quote(column)}`).join(", ")})`
      : "NULL";

    statements.push({
      name: triggerName(entity, "au"),
      sql: `CREATE TRIGGER ${triggerName(entity, "au")} AFTER UPDATE ON ${table} FOR EACH ROW
BEGIN
  DECLARE changed_fields TEXT;
  SET changed_fields = ${fieldList};
  IF changed_fields <> '' OR ${counterChanged} THEN
    INSERT INTO sync_changes ${insertColumns}
    VALUES ('${entity.table}', ${rowIdSql(entity, "NEW")}, ${newScope.tenant}, ${newScope.branch}, ${newScope.branch2}, 'U', changed_fields, ${deltas}, ${origin}, ${changedAt}, UTC_TIMESTAMP(3));
  END IF;
END`
    });
  }

  const oldScope = scopeSql(entity, "OLD");
  statements.push({
    name: triggerName(entity, "ad"),
    sql: `CREATE TRIGGER ${triggerName(entity, "ad")} AFTER DELETE ON ${table} FOR EACH ROW
INSERT INTO sync_changes ${insertColumns}
VALUES ('${entity.table}', ${rowIdSql(entity, "OLD")}, ${oldScope.tenant}, ${oldScope.branch}, ${oldScope.branch2}, 'D', NULL, NULL, ${origin}, ${changedAt}, UTC_TIMESTAMP(3))`
  });

  return statements;
}

/** Logs an 'I' change for every existing row that has never been logged (first install / new table). */
export function backfillStatement(entity: SyncEntity) {
  const scope = scopeSql(entity, "src");
  return `INSERT INTO sync_changes ${insertColumns}
SELECT '${entity.table}', ${rowIdSql(entity, "src")}, ${scope.tenant}, ${scope.branch}, ${scope.branch2}, 'I', NULL, ${insertDeltasSql(entity, "src")}, 'local', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM ${quote(entity.table)} src
WHERE NOT EXISTS (SELECT 1 FROM sync_changes c WHERE c.tableName = '${entity.table}' AND c.rowId = ${rowIdSql(entity, "src")})`;
}

export function syncTriggerHash() {
  const hash = createHash("sha256");
  for (const entity of syncEntities) {
    hash.update(entity.table);
    hash.update(entityColumns(entity).map((column) => column.name).join(","));
    for (const statement of triggerStatements(entity)) hash.update(statement.sql);
  }
  return hash.digest("hex");
}

async function withConnection<T>(work: (connection: Connection) => Promise<T>) {
  const connection = await mariadb.createConnection({
    ...databaseConfigForMariaDbAdapter(),
    allowPublicKeyRetrieval: true,
    multipleStatements: false
  });
  try {
    return await work(connection);
  } finally {
    await connection.end();
  }
}

/**
 * Installs (or refreshes) all sync triggers and backfills the change log.
 * Safe to run repeatedly; does nothing when the trigger definitions are unchanged
 * unless `force` is set.
 */
export async function ensureSyncTriggers(options: { force?: boolean; log?: (message: string) => void } = {}) {
  const log = options.log ?? (() => undefined);
  const identity = await getNodeIdentity();
  const hash = syncTriggerHash();
  const expected = syncEntities.reduce((count, entity) => count + triggerStatements(entity).length, 0);
  let installed = false;

  await withConnection(async (connection) => {
    if (!options.force && identity.triggerHash === hash) {
      // `prisma db push` can recreate tables (dropping their triggers), so verify they exist.
      const [{ total }] = await connection.query(
        "SELECT COUNT(*) AS total FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME LIKE 'sync\\_%'"
      );
      if (Number(total) === expected) return;
    }

    installed = true;
    for (const entity of [...syncEntities].sort((left, right) => left.rank - right.rank)) {
      for (const suffix of ["ai", "au", "ad"] as const) {
        await connection.query(`DROP TRIGGER IF EXISTS ${triggerName(entity, suffix)}`);
      }
      for (const statement of triggerStatements(entity)) {
        await connection.query(statement.sql);
      }
      const result = await connection.query(backfillStatement(entity));
      const backfilled = Number(result.affectedRows ?? 0);
      log(`sync: triggers on ${entity.table}${backfilled ? `, backfilled ${backfilled} rows` : ""}`);
    }
  });

  if (installed) await setTriggerHash(hash);
  return { installed, hash };
}

export async function dropSyncTriggers() {
  await withConnection(async (connection) => {
    for (const entity of syncEntities) {
      for (const suffix of ["ai", "au", "ad"] as const) {
        await connection.query(`DROP TRIGGER IF EXISTS ${triggerName(entity, suffix)}`);
      }
    }
  });
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const migrations = [
    {
        version: 1,
        name: 'create_balance_projections',
        sql: `
      CREATE TABLE IF NOT EXISTS balance_projections (
        id                  TEXT PRIMARY KEY,
        employee_id         TEXT NOT NULL,
        leave_type          TEXT NOT NULL,
        total_balance       REAL NOT NULL DEFAULT 0,
        used_balance        REAL NOT NULL DEFAULT 0,
        projected_available REAL NOT NULL DEFAULT 0,
        hcm_version         TEXT NOT NULL DEFAULT '',
        version             INTEGER NOT NULL DEFAULT 1,
        created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CONSTRAINT uq_employee_leave UNIQUE (employee_id, leave_type),
        CONSTRAINT chk_total_balance CHECK (total_balance >= 0),
        CONSTRAINT chk_used_balance CHECK (used_balance >= 0),
        CONSTRAINT chk_projected CHECK (projected_available >= 0)
      );
      CREATE INDEX IF NOT EXISTS idx_bp_employee ON balance_projections(employee_id);
      CREATE INDEX IF NOT EXISTS idx_bp_employee_type ON balance_projections(employee_id, leave_type);
    `,
    },
    {
        version: 2,
        name: 'create_time_off_requests',
        sql: `
      CREATE TABLE IF NOT EXISTS time_off_requests (
        id                TEXT PRIMARY KEY,
        employee_id       TEXT NOT NULL,
        manager_id        TEXT,
        leave_type        TEXT NOT NULL,
        start_date        TEXT NOT NULL,
        end_date          TEXT NOT NULL,
        hours_requested   REAL NOT NULL,
        reason            TEXT DEFAULT '',
        status            TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
        rejection_reason  TEXT,
        hcm_reference_id  TEXT,
        version           INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CONSTRAINT chk_dates CHECK (end_date >= start_date),
        CONSTRAINT chk_hours CHECK (hours_requested > 0),
        CONSTRAINT chk_status CHECK (status IN (
          'PENDING_APPROVAL','APPROVED_PENDING_HCM','APPROVED',
          'REJECTED','CANCELLED','FAILED_HCM','RECONCILIATION_REQUIRED'
        ))
      );
      CREATE INDEX IF NOT EXISTS idx_tor_employee ON time_off_requests(employee_id);
      CREATE INDEX IF NOT EXISTS idx_tor_employee_status ON time_off_requests(employee_id, status);
      CREATE INDEX IF NOT EXISTS idx_tor_manager ON time_off_requests(manager_id);
      CREATE INDEX IF NOT EXISTS idx_tor_status ON time_off_requests(status);
      CREATE INDEX IF NOT EXISTS idx_tor_dates ON time_off_requests(start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_tor_employee_dates ON time_off_requests(employee_id, start_date, end_date);
    `,
    },
    {
        version: 3,
        name: 'create_balance_holds',
        sql: `
      CREATE TABLE IF NOT EXISTS balance_holds (
        id            TEXT PRIMARY KEY,
        request_id    TEXT NOT NULL UNIQUE,
        employee_id   TEXT NOT NULL,
        leave_type    TEXT NOT NULL,
        hold_amount   REAL NOT NULL,
        status        TEXT NOT NULL DEFAULT 'ACTIVE',
        released_at   TEXT,
        version       INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CONSTRAINT fk_hold_request FOREIGN KEY (request_id) REFERENCES time_off_requests(id),
        CONSTRAINT chk_hold_amount CHECK (hold_amount > 0),
        CONSTRAINT chk_hold_status CHECK (status IN ('ACTIVE', 'RELEASED', 'CONVERTED'))
      );
      CREATE INDEX IF NOT EXISTS idx_bh_employee_type_status ON balance_holds(employee_id, leave_type, status);
      CREATE INDEX IF NOT EXISTS idx_bh_request ON balance_holds(request_id);
      CREATE INDEX IF NOT EXISTS idx_bh_status ON balance_holds(status);
    `,
    },
    {
        version: 4,
        name: 'create_integration_outbox',
        sql: `
      CREATE TABLE IF NOT EXISTS integration_outbox (
        id              TEXT PRIMARY KEY,
        request_id      TEXT NOT NULL,
        action          TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload         TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'PENDING',
        retry_count     INTEGER NOT NULL DEFAULT 0,
        max_retries     INTEGER NOT NULL DEFAULT 5,
        next_retry_at   TEXT,
        last_error      TEXT,
        error_category  TEXT,
        completed_at    TEXT,
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CONSTRAINT fk_outbox_request FOREIGN KEY (request_id) REFERENCES time_off_requests(id),
        CONSTRAINT chk_outbox_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
        CONSTRAINT chk_outbox_action CHECK (action IN ('POST_TIME_OFF', 'CANCEL_TIME_OFF')),
        CONSTRAINT chk_retry_count CHECK (retry_count >= 0),
        CONSTRAINT chk_error_cat CHECK (error_category IS NULL OR error_category IN ('TRANSIENT', 'PERMANENT'))
      );
      CREATE INDEX IF NOT EXISTS idx_io_status_retry ON integration_outbox(status, next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_io_request ON integration_outbox(request_id);
    `,
    },
    {
        version: 5,
        name: 'create_integration_batches',
        sql: `
      CREATE TABLE IF NOT EXISTS integration_batches (
        id              TEXT PRIMARY KEY,
        batch_id        TEXT NOT NULL UNIQUE,
        source          TEXT NOT NULL DEFAULT 'HCM',
        status          TEXT NOT NULL DEFAULT 'PROCESSING',
        total_items     INTEGER NOT NULL DEFAULT 0,
        processed_items INTEGER NOT NULL DEFAULT 0,
        skipped_items   INTEGER NOT NULL DEFAULT 0,
        failed_items    INTEGER NOT NULL DEFAULT 0,
        error_summary   TEXT,
        started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        completed_at    TEXT,
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CONSTRAINT chk_batch_status CHECK (status IN ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED'))
      );
      CREATE INDEX IF NOT EXISTS idx_ib_batch_id ON integration_batches(batch_id);
      CREATE INDEX IF NOT EXISTS idx_ib_status ON integration_batches(status);
    `,
    },
    {
        version: 6,
        name: 'create_audit_logs',
        sql: `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id              TEXT PRIMARY KEY,
        entity_type     TEXT NOT NULL,
        entity_id       TEXT NOT NULL,
        action          TEXT NOT NULL,
        actor_type      TEXT NOT NULL,
        actor_id        TEXT NOT NULL,
        before_state    TEXT,
        after_state     TEXT,
        metadata        TEXT,
        correlation_id  TEXT,
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CONSTRAINT chk_entity_type CHECK (entity_type IN ('REQUEST', 'BALANCE', 'HOLD', 'OUTBOX', 'BATCH')),
        CONSTRAINT chk_actor_type CHECK (actor_type IN ('EMPLOYEE', 'MANAGER', 'SYSTEM', 'HCM'))
      );
      CREATE INDEX IF NOT EXISTS idx_al_entity ON audit_logs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_al_actor ON audit_logs(actor_type, actor_id);
      CREATE INDEX IF NOT EXISTS idx_al_correlation ON audit_logs(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_al_created ON audit_logs(created_at);
    `,
    },
    {
        version: 7,
        name: 'create_idempotency_keys',
        sql: `
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key             TEXT PRIMARY KEY,
        payload_hash    TEXT NOT NULL,
        response        TEXT NOT NULL,
        status_code     INTEGER NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        expires_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ik_expires ON idempotency_keys(expires_at);
    `,
    },
    {
        version: 8,
        name: 'create_sync_checkpoints',
        sql: `
      CREATE TABLE IF NOT EXISTS sync_checkpoints (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `,
    },
    {
        version: 9,
        name: 'add_location_columns',
        sql: `
      ALTER TABLE balance_projections ADD COLUMN location TEXT;
      ALTER TABLE time_off_requests ADD COLUMN location TEXT;
      ALTER TABLE balance_holds ADD COLUMN location TEXT;
      UPDATE balance_projections SET location = 'HQ' WHERE location IS NULL;
      UPDATE time_off_requests SET location = 'HQ' WHERE location IS NULL;
      UPDATE balance_holds SET location = 'HQ' WHERE location IS NULL;
    `,
    },
];
function runMigrations(db, logger) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
    const applied = db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all()
        .map((row) => row.version);
    const applyMigration = db.transaction((migration) => {
        logger.log(`Applying migration ${migration.version}: ${migration.name}`);
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    });
    for (const migration of migrations) {
        if (!applied.includes(migration.version)) {
            try {
                applyMigration(migration);
                logger.log(`Migration ${migration.version} applied successfully`);
            }
            catch (error) {
                logger.error(`Failed to apply migration ${migration.version}: ${error.message}`);
                throw error;
            }
        }
    }
}
//# sourceMappingURL=index.js.map
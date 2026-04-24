# Technical Requirements Document

## phase1_trd.md

# ReadyOn Time-Off Microservice — Technical Requirement Document (TRD)

**Version:** 1.0  
**Date:** 2026-04-24  
**Author:** Engineering Team  
**Status:** DRAFT — Pending Approval

---

## 1. System Overview

ReadyOn is a **Time-Off Microservice** that provides a fast, responsive employee experience for requesting and managing time off, while maintaining the external HCM system (Workday/SAP) as the **absolute Source of Truth** for balance data.

The system uses a **local projection + hold pattern**: we maintain a local copy of balances for sub-second reads and enforce holds (reservations) during the request lifecycle to prevent overbooking. All approved requests are forwarded to HCM for final deduction. Periodic batch syncs and reconciliation ensure eventual consistency.

### Key Actors

| Actor | Role |
|-------|------|
| **Employee** | Requests time off, views balance, cancels requests |
| **Manager** | Approves or rejects submitted requests |
| **HCM System** | Source of truth for balances; receives approved deductions; sends batch updates |
| **Scheduler** | Triggers batch sync, reconciliation, and outbox processing |

---

## 2. Goals

| # | Goal | Rationale |
|---|------|-----------|
| G1 | **Prevent overbooking** | Holds must reserve balance at submission; revalidated at approval |
| G2 | **No double deductions** | Idempotency keys on all HCM calls prevent duplicate postings |
| G3 | **No stale overwrites** | Optimistic locking (version columns) on all mutable entities |
| G4 | **Transactional safety** | Every DB mutation wrapped in a serialized SQLite transaction |
| G5 | **Eventual consistency with HCM** | Batch sync + reconciliation detect and repair drift |
| G6 | **Retry-safe external calls** | Outbox pattern with classified retries (transient vs permanent) |
| G7 | **Full testability** | HCM adapter behind an interface; mock covers all failure modes |
| G8 | **Auditability** | Every state transition and balance mutation logged immutably |

## 3. Non-Goals

| # | Non-Goal | Reason |
|---|----------|--------|
| NG1 | Replace HCM as source of truth | Out of scope; HCM owns canonical balances |
| NG2 | Multi-tenant support | Single-tenant deployment for this phase |
| NG3 | Real-time push notifications | Polling/pull model sufficient for MVP |
| NG4 | Complex accrual calculations | HCM handles accruals; we only project balances |
| NG5 | UI/Frontend | API-only microservice |

---

## 4. Assumptions

1. **HCM provides real-time APIs** for `getBalance`, `postTimeOff` (deduction), and `getBatchBalances`.
2. **HCM supports idempotency keys** — duplicate `postTimeOff` calls with the same key return the original result, not a new deduction.
3. **SQLite is sufficient** for the expected load (single-writer, moderate read concurrency). WAL mode enabled.
4. **Employee/Manager identity** is provided via a pre-authenticated header (JWT or API gateway). AuthN/AuthZ is upstream.
5. **Time-off types** (PTO, Sick, etc.) and **policies** are defined in HCM; we reference them by ID.
6. **One approval level** — a single manager approves. Multi-level chains are a future enhancement.
7. **Calendar/business-day calculations** for hours are handled by a utility; not delegated to HCM per-request.

---

## 5. Key Challenges

### 5.1 Balance Integrity Under Concurrency
Multiple requests for the same employee can race. We solve this with:
- **Holds**: Immediately reserving balance upon submission.
- **Serialized transactions**: SQLite's single-writer model + explicit transaction isolation.
- **Revalidation at approval**: The approve step re-checks `available = projected - sum(active_holds)`.

### 5.2 HCM as Async Dependency
HCM calls can fail, timeout, or return stale data. We mitigate with:
- **Outbox pattern**: Approved requests queue an outbox entry; a processor retries with backoff.
- **Idempotency keys**: Every outbox entry carries a unique key so retries are safe.
- **Error classification**: Transient (timeout, 5xx) → retry. Permanent (insufficient balance, invalid type) → fail + flag.

### 5.3 Stale Data from Batch Syncs
HCM may send batch balance updates that are older than our local state. We handle this with:
- **Version vectors**: Each balance projection carries an `hcm_version` timestamp. Batch entries older than our version are discarded.
- **Reconciliation jobs**: Periodically compare local projections against HCM real-time API and flag/repair drift.

### 5.4 State Machine Correctness
A request transitions through 8 states. Invalid transitions must be rejected. The state machine is the single authority for what operations are allowed.

---

## 6. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ReadyOn Microservice                        │
│                                                                     │
│  ┌──────────┐   ┌──────────────┐   ┌────────────────┐              │
│  │ REST API │──▶│ Business     │──▶│ Repository     │──▶ SQLite DB │
│  │ Layer    │   │ Logic Layer  │   │ Layer          │   (WAL mode) │
│  └──────────┘   └──────┬───────┘   └────────────────┘              │
│                        │                                            │
│                        ▼                                            │
│                 ┌──────────────┐                                    │
│                 │ HCM Adapter  │ (Interface)                       │
│                 │ (Port)       │                                    │
│                 └──────┬───────┘                                    │
│                        │                                            │
│  ┌─────────────┐       │        ┌──────────────────┐               │
│  │ Outbox      │◀──────┘        │ Scheduler        │               │
│  │ Processor   │                │ (Cron Jobs)      │               │
│  └──────┬──────┘                └────────┬─────────┘               │
│         │                                │                          │
└─────────┼────────────────────────────────┼──────────────────────────┘
          │                                │
          ▼                                ▼
   ┌─────────────┐                 ┌──────────────┐
   │ External    │                 │ Batch Sync & │
   │ HCM System  │◀────────────── │ Reconciliation│
   │ (Workday/   │                 └──────────────┘
   │  SAP)       │
   └─────────────┘
```

### Layer Responsibilities

| Layer | Responsibility |
|-------|---------------|
| **REST API** | Validation, DTO mapping, HTTP semantics |
| **Business Logic** | State machine, hold management, balance checks, orchestration |
| **Repository** | Transactional DB operations, optimistic lock enforcement |
| **HCM Adapter** | Interface to external HCM; production impl + mock impl |
| **Outbox Processor** | Polls outbox table, dispatches to HCM with retries |
| **Scheduler** | Triggers batch sync, reconciliation, outbox sweep |

---

## 7. Data Flow — Request Lifecycle

### 7.1 Create Request (Employee)

```
Employee ──POST /requests──▶ API Controller
  │
  ▼
Validate input (dates, type, no overlap)
  │
  ▼
BEGIN TRANSACTION
  ├─ Read balance_projection (with version lock)
  ├─ Calculate: available = projected_balance - SUM(active holds)
  ├─ IF available < requested_hours → ROLLBACK, return 409
  ├─ INSERT time_off_request (status: PENDING_APPROVAL)
  ├─ INSERT balance_hold (linked to request, amount = requested_hours)
  ├─ INSERT audit_log
COMMIT
  │
  ▼
Return 201 { request_id, status: PENDING_APPROVAL }
```

### 7.2 Approve Request (Manager)

```
Manager ──POST /requests/:id/approve──▶ API Controller
  │
  ▼
BEGIN TRANSACTION
  ├─ Read request (assert status = PENDING_APPROVAL, version check)
  ├─ Read balance_projection
  ├─ Revalidate: available = projected - SUM(active holds excl. this one) ≥ this hold
  ├─ IF insufficient → ROLLBACK, return 409
  ├─ UPDATE request status → APPROVED_PENDING_HCM, bump version
  ├─ INSERT integration_outbox (action: POST_TIME_OFF, idempotency_key)
  ├─ INSERT audit_log
COMMIT
  │
  ▼
Return 200 { status: APPROVED_PENDING_HCM }
```

### 7.3 Outbox Processor (Async)

```
Scheduler triggers outbox sweep
  │
  ▼
SELECT pending outbox entries (ORDER BY created_at, LIMIT N)
  │
  ▼
FOR EACH entry:
  ├─ Call HCM adapter.postTimeOff(idempotency_key, payload)
  ├─ ON SUCCESS:
  │   ├─ BEGIN TRANSACTION
  │   ├─ UPDATE request status → APPROVED
  │   ├─ UPDATE balance_projection (deduct hours, bump hcm_version)
  │   ├─ DELETE or RELEASE balance_hold
  │   ├─ UPDATE outbox entry → COMPLETED
  │   ├─ INSERT audit_log
  │   COMMIT
  ├─ ON TRANSIENT FAILURE (timeout, 5xx):
  │   ├─ INCREMENT retry_count, SET next_retry_at (exponential backoff)
  │   ├─ IF retries exhausted → mark FAILED, flag for manual review
  ├─ ON PERMANENT FAILURE (400, insufficient balance):
  │   ├─ BEGIN TRANSACTION
  │   ├─ UPDATE request status → FAILED_HCM
  │   ├─ RELEASE balance_hold
  │   ├─ UPDATE outbox → FAILED
  │   ├─ INSERT audit_log
  │   COMMIT
```

### 7.4 Batch Sync (HCM → ReadyOn)

```
Scheduler triggers batch sync
  │
  ▼
Call HCM adapter.getBatchBalances()
  │
  ▼
FOR EACH balance update:
  ├─ Read local balance_projection for employee+type
  ├─ IF hcm_batch_version ≤ local.hcm_version → SKIP (stale)
  ├─ BEGIN TRANSACTION
  │   ├─ UPDATE balance_projection (new balance, new hcm_version)
  │   ├─ Revalidate active holds against new balance
  │   ├─ IF any hold now exceeds available → flag RECONCILIATION_REQUIRED
  │   ├─ INSERT audit_log
  │   COMMIT
```

### 7.5 Reconciliation

```
Scheduler triggers reconciliation
  │
  ▼
FOR EACH employee with active projections:
  ├─ Call HCM adapter.getBalance(employee_id, type)
  ├─ Compare HCM balance vs local projected balance
  ├─ IF drift detected:
  │   ├─ IF drift ≤ threshold → auto-repair (update local, log)
  │   ├─ IF drift > threshold → flag RECONCILIATION_REQUIRED, alert
  ├─ INSERT audit_log with drift details
```

---

## 8. Alternatives Considered

### 8.1 Direct HCM Calls on Every Request (Rejected)

| Aspect | Assessment |
|--------|-----------|
| **Approach** | Call HCM `getBalance` on every submission and approval |
| **Pros** | Always consistent with HCM |
| **Cons** | 200-500ms latency per call; HCM outage = total system outage; no offline resilience |
| **Decision** | **Rejected.** Unacceptable UX and availability coupling. Local projection + holds is superior. |

### 8.2 Event Sourcing for Balance (Deferred)

| Aspect | Assessment |
|--------|-----------|
| **Approach** | Store balance as a stream of events; derive current state via replay |
| **Pros** | Perfect audit trail; temporal queries; replay capability |
| **Cons** | Significant complexity for SQLite; snapshot management needed; overkill for current scale |
| **Decision** | **Deferred.** Audit log table provides sufficient history. Revisit if scale demands it. |

### 8.3 Optimistic Balance (No Holds) (Rejected)

| Aspect | Assessment |
|--------|-----------|
| **Approach** | Check balance at submission but don't reserve; check again at approval |
| **Pros** | Simpler model; fewer DB writes |
| **Cons** | Two employees can submit requests that pass validation individually but collectively overbooking. Race window between submission and approval. |
| **Decision** | **Rejected.** Violates G1 (prevent overbooking). Holds are essential. |

### 8.4 PostgreSQL Instead of SQLite (Not Selected)

| Aspect | Assessment |
|--------|-----------|
| **Approach** | Use PostgreSQL for better concurrency, row-level locking, advisory locks |
| **Pros** | Better concurrent write throughput; native `SELECT FOR UPDATE` |
| **Cons** | Heavier operational footprint; requires separate DB server; overkill for single-service deployment |
| **Decision** | **Not selected** per requirements. SQLite WAL mode + serialized transactions are adequate. Can migrate later if needed. |

### 8.5 Saga Pattern with Message Broker (Deferred)

| Aspect | Assessment |
|--------|-----------|
| **Approach** | Use RabbitMQ/Kafka for choreographed sagas between ReadyOn and HCM |
| **Pros** | Decoupled; horizontally scalable; built-in retry/DLQ |
| **Cons** | Operational complexity; requires broker infrastructure; eventual consistency harder to reason about |
| **Decision** | **Deferred.** Outbox pattern achieves similar reliability without external infrastructure. |

---

## 9. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| HCM extended outage | Requests stuck in APPROVED_PENDING_HCM | Outbox retries with backoff; manual override API; monitoring alerts |
| SQLite write contention | Degraded throughput under burst | WAL mode; short transactions; queue heavy writes |
| Balance drift undetected | Overbooking or phantom balance | Scheduled reconciliation; drift alerts; threshold-based auto-repair |
| Idempotency key collision | Duplicate deduction | UUIDv4 keys; HCM-side dedup; audit trail for forensics |
| Stale batch overwrites local state | Loss of in-flight hold context | Version-gated batch application; hold revalidation on sync |

---

## 10. Observability Requirements

| Signal | Implementation |
|--------|---------------|
| **Structured Logging** | Every state transition, HCM call, and error logged with correlation ID |
| **Audit Trail** | Immutable `audit_logs` table with actor, action, before/after state |
| **Metrics** (future) | Request counts by status, HCM call latency/error rate, outbox depth, drift count |
| **Health Check** | `/health` endpoint reporting DB connectivity and outbox backlog |

---

## 11. Summary

This TRD defines a **local projection + hold + outbox** architecture that delivers:
- **Fast UX** via local balance reads
- **Strong local consistency** via transactional holds and revalidation
- **Eventual HCM consistency** via outbox processing and batch sync
- **Safety** via idempotency, optimistic locking, and immutable audit logs
- **Testability** via adapter interfaces and a comprehensive mock HCM

The system is designed to be **correct first**, with clear extension points for scale (PostgreSQL migration, message brokers, event sourcing) when needed.

---

> **PHASE 1 COMPLETE — Awaiting approval to proceed to Phase 2: Domain & Data Modeling**


## phase2_data_model.md

# ReadyOn Time-Off Microservice — Domain & Data Model

**Phase:** 2 of 11  
**Depends on:** Phase 1 (TRD)  
**Status:** DRAFT — Pending Approval

---

## 1. Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Optimistic Locking** | Every mutable table has a `version` INTEGER column; updates use `WHERE version = :expected` |
| **Immutable Audit** | `audit_logs` is append-only; no UPDATEs or DELETEs allowed at application level |
| **Soft State Tracking** | Requests and holds track status via enum-like TEXT columns |
| **Version-Gated Sync** | `balance_projections` carries `hcm_version` to reject stale batch updates |
| **Referential Integrity** | Foreign keys enforced (`PRAGMA foreign_keys = ON`) |
| **Timestamps Everywhere** | All tables carry `created_at` and `updated_at` as ISO-8601 UTC strings |

---

## 2. Entity Relationship Diagram

```
┌─────────────────────────┐
│  balance_projections    │
│─────────────────────────│
│ PK: id                  │
│ UK: employee_id + type  │
│ version (opt. lock)     │
│ hcm_version (sync gate) │
└──────────┬──────────────┘
           │ 1
           │
           │ N
┌──────────▼──────────────┐         ┌─────────────────────────┐
│  time_off_requests      │         │  integration_outbox     │
│─────────────────────────│         │─────────────────────────│
│ PK: id                  │────1:N──│ PK: id                  │
│ FK: employee_id         │         │ FK: request_id          │
│ status (state machine)  │         │ idempotency_key (UK)    │
│ version (opt. lock)     │         │ status, retry_count     │
└──────────┬──────────────┘         └─────────────────────────┘
           │ 1
           │
           │ 1
┌──────────▼──────────────┐         ┌─────────────────────────┐
│  balance_holds          │         │  integration_batches    │
│─────────────────────────│         │─────────────────────────│
│ PK: id                  │         │ PK: id                  │
│ FK: request_id (UK)     │         │ batch_id (UK)           │
│ FK: employee_id         │         │ status, item counts     │
│ FK: leave_type          │         └─────────────────────────┘
│ status (ACTIVE/RELEASED)│
└─────────────────────────┘
                                    ┌─────────────────────────┐
                                    │  audit_logs             │
                                    │─────────────────────────│
                                    │ PK: id                  │
                                    │ entity_type + entity_id │
                                    │ action, actor           │
                                    │ before/after snapshots  │
                                    └─────────────────────────┘
```

---

## 3. Table Definitions

### 3.1 `balance_projections`

Local projection of employee leave balances. **Not the source of truth** — HCM is. This table enables fast reads and hold calculations.

```sql
CREATE TABLE balance_projections (
  id              TEXT PRIMARY KEY,                    -- UUIDv4
  employee_id     TEXT NOT NULL,                       -- External employee ID from HCM
  leave_type      TEXT NOT NULL,                       -- e.g., 'PTO', 'SICK', 'PERSONAL'
  total_balance   REAL NOT NULL DEFAULT 0,             -- Total hours granted by HCM
  used_balance    REAL NOT NULL DEFAULT 0,             -- Hours confirmed deducted in HCM
  projected_available REAL NOT NULL DEFAULT 0,         -- total - used (denormalized for fast reads)
  hcm_version     TEXT NOT NULL DEFAULT '',            -- HCM-provided version/timestamp for sync gating
  version         INTEGER NOT NULL DEFAULT 1,          -- Optimistic lock version
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- Business constraint: one projection per employee per leave type
  CONSTRAINT uq_employee_leave UNIQUE (employee_id, leave_type),
  -- Balances must not be negative
  CONSTRAINT chk_total_balance CHECK (total_balance >= 0),
  CONSTRAINT chk_used_balance CHECK (used_balance >= 0),
  CONSTRAINT chk_projected CHECK (projected_available >= 0)
);

CREATE INDEX idx_bp_employee ON balance_projections(employee_id);
CREATE INDEX idx_bp_employee_type ON balance_projections(employee_id, leave_type);
```

**Key design decisions:**
- `projected_available` is denormalized (`total - used`) and updated atomically with `total_balance` or `used_balance`. This avoids recomputing on every read.
- `hcm_version` is a string to accommodate different HCM versioning formats (timestamps, ETags, sequence numbers).
- `version` is separate from `hcm_version` — it tracks local mutations for optimistic locking.

---

### 3.2 `time_off_requests`

Core entity tracking each time-off request through its lifecycle.

```sql
CREATE TABLE time_off_requests (
  id              TEXT PRIMARY KEY,                    -- UUIDv4
  employee_id     TEXT NOT NULL,                       -- Who is requesting
  manager_id      TEXT,                                -- Assigned approver (nullable for auto-approve flows)
  leave_type      TEXT NOT NULL,                       -- Must match a balance_projections.leave_type
  start_date      TEXT NOT NULL,                       -- ISO-8601 date 'YYYY-MM-DD'
  end_date        TEXT NOT NULL,                       -- ISO-8601 date 'YYYY-MM-DD'
  hours_requested REAL NOT NULL,                       -- Total hours for the period
  reason          TEXT DEFAULT '',                      -- Optional employee note
  status          TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  rejection_reason TEXT,                               -- Populated on REJECTED
  hcm_reference_id TEXT,                               -- HCM's ID after successful posting
  version         INTEGER NOT NULL DEFAULT 1,          -- Optimistic lock
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- Date validation
  CONSTRAINT chk_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_hours CHECK (hours_requested > 0),
  -- Status must be a valid state
  CONSTRAINT chk_status CHECK (status IN (
    'PENDING_APPROVAL',
    'APPROVED_PENDING_HCM',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
    'FAILED_HCM',
    'RECONCILIATION_REQUIRED'
  ))
);

CREATE INDEX idx_tor_employee ON time_off_requests(employee_id);
CREATE INDEX idx_tor_employee_status ON time_off_requests(employee_id, status);
CREATE INDEX idx_tor_manager ON time_off_requests(manager_id);
CREATE INDEX idx_tor_status ON time_off_requests(status);
CREATE INDEX idx_tor_dates ON time_off_requests(start_date, end_date);
CREATE INDEX idx_tor_employee_dates ON time_off_requests(employee_id, start_date, end_date);
```

**Status values** (full state machine defined in Phase 4):

| Status | Meaning |
|--------|---------|
| `PENDING_APPROVAL` | Submitted, hold placed, awaiting manager |
| `APPROVED_PENDING_HCM` | Manager approved, queued for HCM deduction |
| `APPROVED` | HCM confirmed deduction |
| `REJECTED` | Manager rejected |
| `CANCELLED` | Employee cancelled (hold released) |
| `FAILED_HCM` | HCM permanently rejected the deduction |
| `RECONCILIATION_REQUIRED` | Drift detected, needs manual review |

> **Note:** `SUBMITTED` from Phase 1 TRD is merged into `PENDING_APPROVAL`. A request always requires approval in V1.

---

### 3.3 `balance_holds`

Reservations against an employee's balance. Prevents overbooking between submission and HCM confirmation.

```sql
CREATE TABLE balance_holds (
  id              TEXT PRIMARY KEY,                    -- UUIDv4
  request_id      TEXT NOT NULL UNIQUE,                -- 1:1 with time_off_requests
  employee_id     TEXT NOT NULL,                       -- Denormalized for query efficiency
  leave_type      TEXT NOT NULL,                       -- Denormalized for query efficiency
  hold_amount     REAL NOT NULL,                       -- Hours reserved
  status          TEXT NOT NULL DEFAULT 'ACTIVE',      -- ACTIVE | RELEASED | CONVERTED
  released_at     TEXT,                                -- When the hold was released/converted
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  CONSTRAINT fk_hold_request FOREIGN KEY (request_id) REFERENCES time_off_requests(id),
  CONSTRAINT chk_hold_amount CHECK (hold_amount > 0),
  CONSTRAINT chk_hold_status CHECK (status IN ('ACTIVE', 'RELEASED', 'CONVERTED'))
);

CREATE INDEX idx_bh_employee_type_status ON balance_holds(employee_id, leave_type, status);
CREATE INDEX idx_bh_request ON balance_holds(request_id);
CREATE INDEX idx_bh_status ON balance_holds(status);
```

**Hold lifecycle:**

| Status | Trigger | Meaning |
|--------|---------|---------|
| `ACTIVE` | Request created | Balance is reserved |
| `RELEASED` | Request cancelled, rejected, or HCM failed | Balance returned to available pool |
| `CONVERTED` | HCM confirms deduction | Hold becomes a real deduction in `used_balance` |

---

### 3.4 `integration_outbox`

Transactional outbox for reliable HCM communication. Entries are created within the same transaction as state changes.

```sql
CREATE TABLE integration_outbox (
  id              TEXT PRIMARY KEY,                    -- UUIDv4
  request_id      TEXT NOT NULL,                       -- FK to time_off_requests
  action          TEXT NOT NULL,                       -- 'POST_TIME_OFF' | 'CANCEL_TIME_OFF'
  idempotency_key TEXT NOT NULL UNIQUE,                -- Sent to HCM; prevents double deductions
  payload         TEXT NOT NULL,                       -- JSON-serialized request payload
  status          TEXT NOT NULL DEFAULT 'PENDING',     -- PENDING | PROCESSING | COMPLETED | FAILED
  retry_count     INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 5,
  next_retry_at   TEXT,                                -- ISO-8601; null = immediate
  last_error      TEXT,                                -- Last error message/code
  error_category  TEXT,                                -- 'TRANSIENT' | 'PERMANENT' | null
  completed_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  CONSTRAINT fk_outbox_request FOREIGN KEY (request_id) REFERENCES time_off_requests(id),
  CONSTRAINT chk_outbox_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  CONSTRAINT chk_outbox_action CHECK (action IN ('POST_TIME_OFF', 'CANCEL_TIME_OFF')),
  CONSTRAINT chk_retry_count CHECK (retry_count >= 0),
  CONSTRAINT chk_error_cat CHECK (error_category IS NULL OR error_category IN ('TRANSIENT', 'PERMANENT'))
);

CREATE INDEX idx_io_status_retry ON integration_outbox(status, next_retry_at);
CREATE INDEX idx_io_request ON integration_outbox(request_id);
CREATE INDEX idx_io_idempotency ON integration_outbox(idempotency_key);
```

**Outbox processing guarantees:**
- Entries created **inside** the same transaction as the business state change (approve → outbox insert).
- The processor marks entries `PROCESSING` before dispatching (prevents double pickup).
- `idempotency_key` is sent to HCM, ensuring retries are safe.

---

### 3.5 `integration_batches`

Tracks batch sync operations from HCM for observability and idempotent batch processing.

```sql
CREATE TABLE integration_batches (
  id              TEXT PRIMARY KEY,                    -- UUIDv4
  batch_id        TEXT NOT NULL UNIQUE,                -- External batch identifier from HCM
  source          TEXT NOT NULL DEFAULT 'HCM',         -- Origin system
  status          TEXT NOT NULL DEFAULT 'PROCESSING',  -- PROCESSING | COMPLETED | PARTIAL | FAILED
  total_items     INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  skipped_items   INTEGER NOT NULL DEFAULT 0,          -- Stale entries skipped
  failed_items    INTEGER NOT NULL DEFAULT 0,
  error_summary   TEXT,                                -- JSON array of error details
  started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  CONSTRAINT chk_batch_status CHECK (status IN ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  CONSTRAINT chk_counts CHECK (total_items >= 0 AND processed_items >= 0 AND skipped_items >= 0 AND failed_items >= 0)
);

CREATE INDEX idx_ib_batch_id ON integration_batches(batch_id);
CREATE INDEX idx_ib_status ON integration_batches(status);
```

---

### 3.6 `audit_logs`

Immutable audit trail. Every state change, balance mutation, and integration event is logged.

```sql
CREATE TABLE audit_logs (
  id              TEXT PRIMARY KEY,                    -- UUIDv4
  entity_type     TEXT NOT NULL,                       -- 'REQUEST' | 'BALANCE' | 'HOLD' | 'OUTBOX' | 'BATCH'
  entity_id       TEXT NOT NULL,                       -- PK of the affected entity
  action          TEXT NOT NULL,                       -- e.g., 'CREATED', 'STATUS_CHANGED', 'BALANCE_UPDATED'
  actor_type      TEXT NOT NULL,                       -- 'EMPLOYEE' | 'MANAGER' | 'SYSTEM' | 'HCM'
  actor_id        TEXT NOT NULL,                       -- Who performed the action
  before_state    TEXT,                                -- JSON snapshot before change (null on create)
  after_state     TEXT,                                -- JSON snapshot after change
  metadata        TEXT,                                -- Additional context (JSON), e.g., drift amount
  correlation_id  TEXT,                                -- Links related operations across tables
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  CONSTRAINT chk_entity_type CHECK (entity_type IN ('REQUEST', 'BALANCE', 'HOLD', 'OUTBOX', 'BATCH')),
  CONSTRAINT chk_actor_type CHECK (actor_type IN ('EMPLOYEE', 'MANAGER', 'SYSTEM', 'HCM'))
);

CREATE INDEX idx_al_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_al_actor ON audit_logs(actor_type, actor_id);
CREATE INDEX idx_al_correlation ON audit_logs(correlation_id);
CREATE INDEX idx_al_created ON audit_logs(created_at);
CREATE INDEX idx_al_action ON audit_logs(action);
```

**This table is append-only.** The application layer must never issue UPDATE or DELETE against it.

---

## 4. Optimistic Locking Protocol

Every mutable table (`balance_projections`, `time_off_requests`, `balance_holds`, `integration_outbox`) uses a `version` column.

**Update pattern:**

```sql
UPDATE time_off_requests
SET status = :new_status,
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = :id
  AND version = :expected_version;

-- If affected rows = 0 → concurrent modification detected → throw ConflictException
```

This is enforced at the **repository layer** — every update method checks `changes() > 0` after execution.

---

## 5. Available Balance Calculation

The **effective available balance** for an employee's leave type is:

```
effective_available = projected_available - SUM(active_holds.hold_amount)
```

Computed as:

```sql
SELECT
  bp.projected_available - COALESCE(SUM(bh.hold_amount), 0) AS effective_available
FROM balance_projections bp
LEFT JOIN balance_holds bh
  ON bh.employee_id = bp.employee_id
  AND bh.leave_type = bp.leave_type
  AND bh.status = 'ACTIVE'
WHERE bp.employee_id = :employee_id
  AND bp.leave_type = :leave_type
GROUP BY bp.id;
```

This query runs inside transactions during request creation and approval to ensure consistency.

---

## 6. SQLite Pragmas

Applied at connection initialization:

```sql
PRAGMA journal_mode = WAL;          -- Write-Ahead Logging for concurrent reads
PRAGMA foreign_keys = ON;           -- Enforce FK constraints
PRAGMA busy_timeout = 5000;         -- Wait up to 5s for write lock
PRAGMA synchronous = NORMAL;        -- Balanced durability/performance
```

---

## 7. Migration Strategy

Migrations will be managed via a sequential numbering scheme:

```
migrations/
  001_create_balance_projections.sql
  002_create_time_off_requests.sql
  003_create_balance_holds.sql
  004_create_integration_outbox.sql
  005_create_integration_batches.sql
  006_create_audit_logs.sql
```

Each migration is idempotent (uses `CREATE TABLE IF NOT EXISTS`) and tracked via a `schema_migrations` table:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

---

## 8. Data Integrity Summary

| Concern | Mechanism |
|---------|-----------|
| **No overbooking** | Holds deducted from available; checked inside transactions |
| **No double deduction** | Outbox `idempotency_key` UNIQUE constraint; HCM-side dedup |
| **No stale overwrite** | `version` column + `WHERE version = :expected` on every UPDATE |
| **No stale sync** | `hcm_version` compared before applying batch updates |
| **No orphaned holds** | FK to `time_off_requests`; hold status tracks request lifecycle |
| **No negative balances** | CHECK constraints on `balance_projections` |
| **Full traceability** | `audit_logs` captures every mutation with before/after snapshots |
| **Referential integrity** | Foreign keys enforced via pragma |

---

> **PHASE 2 COMPLETE — Awaiting approval to proceed to Phase 3: API Contract Design**


## phase3_api_contract.md

# ReadyOn Time-Off Microservice — API Contract Design

**Phase:** 3 of 11  
**Depends on:** Phase 1 (TRD), Phase 2 (Data Model)  
**Status:** DRAFT — Pending Approval

---

## 1. API Conventions

| Convention | Detail |
|-----------|--------|
| **Base Path** | `/api/v1` |
| **Content-Type** | `application/json` |
| **Auth** | Pre-authenticated via `X-Employee-Id` and `X-Employee-Role` headers (upstream gateway) |
| **Timestamps** | ISO-8601 UTC (`2026-04-24T12:00:00.000Z`) |
| **IDs** | UUIDv4 strings |
| **Pagination** | Cursor-based via `?cursor=<id>&limit=<n>` (default limit: 20, max: 100) |
| **Idempotency** | `Idempotency-Key` header required on all POST mutations |
| **Versioning** | Optimistic locking via `version` field in request body for state-changing operations |

### Standard Error Response

All errors follow a consistent envelope:

```json
{
  "statusCode": 409,
  "error": "INSUFFICIENT_BALANCE",
  "message": "Available balance (16.0h) is less than requested (24.0h)",
  "details": {
    "available": 16.0,
    "requested": 24.0,
    "leave_type": "PTO"
  },
  "timestamp": "2026-04-24T12:00:00.000Z",
  "correlation_id": "req-abc-123"
}
```

---

## 2. Error Taxonomy

| Error Code | HTTP Status | When |
|-----------|------------|------|
| `VALIDATION_ERROR` | 400 | Invalid input (bad dates, missing fields, negative hours) |
| `INVALID_STATE_TRANSITION` | 400 | Operation not allowed for current request status |
| `NOT_FOUND` | 404 | Resource does not exist |
| `FORBIDDEN` | 403 | Actor lacks permission (e.g., wrong manager) |
| `INSUFFICIENT_BALANCE` | 409 | Not enough available balance (after holds) |
| `OVERLAPPING_REQUEST` | 409 | Date range conflicts with existing active request |
| `VERSION_CONFLICT` | 409 | Optimistic lock failure — resource was modified concurrently |
| `DUPLICATE_REQUEST` | 409 | Idempotency key already processed (returns original response) |
| `STALE_BATCH` | 422 | Batch version is older than local; update skipped |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## 3. Employee Endpoints

### 3.1 Get Balance

Returns effective available balance for the authenticated employee.

```
GET /api/v1/employees/me/balances
GET /api/v1/employees/me/balances?leave_type=PTO
```

**Response: `200 OK`**

```json
{
  "data": [
    {
      "employee_id": "emp-001",
      "leave_type": "PTO",
      "total_balance": 120.0,
      "used_balance": 40.0,
      "held_balance": 16.0,
      "effective_available": 64.0,
      "hcm_version": "2026-04-01T00:00:00Z",
      "last_synced_at": "2026-04-24T06:00:00.000Z"
    },
    {
      "employee_id": "emp-001",
      "leave_type": "SICK",
      "total_balance": 40.0,
      "used_balance": 8.0,
      "held_balance": 0.0,
      "effective_available": 32.0,
      "hcm_version": "2026-04-01T00:00:00Z",
      "last_synced_at": "2026-04-24T06:00:00.000Z"
    }
  ]
}
```

**Errors:** `404` if no balance projections exist for employee.

---

### 3.2 Create Time-Off Request

```
POST /api/v1/employees/me/requests
Headers:
  Idempotency-Key: <uuid>
```

**Request Body:**

```json
{
  "leave_type": "PTO",
  "start_date": "2026-05-01",
  "end_date": "2026-05-03",
  "hours_requested": 24.0,
  "reason": "Family vacation"
}
```

**Validations:**
- `leave_type` must exist in employee's balance projections
- `start_date` ≤ `end_date`
- `start_date` must be in the future (> today)
- `hours_requested` > 0
- No overlapping active requests for same leave type and date range
- `effective_available` ≥ `hours_requested`

**Response: `201 Created`**

```json
{
  "data": {
    "id": "req-uuid-001",
    "employee_id": "emp-001",
    "leave_type": "PTO",
    "start_date": "2026-05-01",
    "end_date": "2026-05-03",
    "hours_requested": 24.0,
    "reason": "Family vacation",
    "status": "PENDING_APPROVAL",
    "hold_id": "hold-uuid-001",
    "version": 1,
    "created_at": "2026-04-24T12:00:00.000Z"
  }
}
```

**Errors:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Invalid input |
| 409 | `INSUFFICIENT_BALANCE` | Not enough available hours |
| 409 | `OVERLAPPING_REQUEST` | Date conflict with existing request |
| 409 | `DUPLICATE_REQUEST` | Idempotency key already used (returns original `201`) |

---

### 3.3 List My Requests

```
GET /api/v1/employees/me/requests
GET /api/v1/employees/me/requests?status=PENDING_APPROVAL&cursor=<id>&limit=20
```

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | No | Filter by status |
| `leave_type` | string | No | Filter by leave type |
| `start_date_from` | string | No | Filter requests starting on or after |
| `start_date_to` | string | No | Filter requests starting on or before |
| `cursor` | string | No | Pagination cursor (request ID) |
| `limit` | integer | No | Page size (default: 20, max: 100) |

**Response: `200 OK`**

```json
{
  "data": [
    {
      "id": "req-uuid-001",
      "employee_id": "emp-001",
      "leave_type": "PTO",
      "start_date": "2026-05-01",
      "end_date": "2026-05-03",
      "hours_requested": 24.0,
      "status": "PENDING_APPROVAL",
      "version": 1,
      "created_at": "2026-04-24T12:00:00.000Z"
    }
  ],
  "pagination": {
    "next_cursor": "req-uuid-002",
    "has_more": true,
    "limit": 20
  }
}
```

---

### 3.4 Get Single Request

```
GET /api/v1/employees/me/requests/:requestId
```

**Response: `200 OK`**

```json
{
  "data": {
    "id": "req-uuid-001",
    "employee_id": "emp-001",
    "manager_id": "mgr-001",
    "leave_type": "PTO",
    "start_date": "2026-05-01",
    "end_date": "2026-05-03",
    "hours_requested": 24.0,
    "reason": "Family vacation",
    "status": "PENDING_APPROVAL",
    "rejection_reason": null,
    "hcm_reference_id": null,
    "hold": {
      "id": "hold-uuid-001",
      "hold_amount": 24.0,
      "status": "ACTIVE"
    },
    "version": 1,
    "created_at": "2026-04-24T12:00:00.000Z",
    "updated_at": "2026-04-24T12:00:00.000Z"
  }
}
```

**Errors:** `404` if not found or doesn't belong to authenticated employee.

---

### 3.5 Cancel Request

```
POST /api/v1/employees/me/requests/:requestId/cancel
Headers:
  Idempotency-Key: <uuid>
```

**Request Body:**

```json
{
  "version": 1,
  "reason": "Plans changed"
}
```

**Allowed from statuses:** `PENDING_APPROVAL`, `APPROVED_PENDING_HCM`

**Response: `200 OK`**

```json
{
  "data": {
    "id": "req-uuid-001",
    "status": "CANCELLED",
    "hold_status": "RELEASED",
    "version": 2,
    "updated_at": "2026-04-24T13:00:00.000Z"
  }
}
```

**Errors:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `INVALID_STATE_TRANSITION` | Can't cancel from current status |
| 404 | `NOT_FOUND` | Request not found |
| 409 | `VERSION_CONFLICT` | Concurrent modification |

---

## 4. Manager Endpoints

### 4.1 List Pending Approvals

```
GET /api/v1/managers/me/pending-approvals
GET /api/v1/managers/me/pending-approvals?cursor=<id>&limit=20
```

**Response: `200 OK`**

```json
{
  "data": [
    {
      "id": "req-uuid-001",
      "employee_id": "emp-001",
      "leave_type": "PTO",
      "start_date": "2026-05-01",
      "end_date": "2026-05-03",
      "hours_requested": 24.0,
      "reason": "Family vacation",
      "status": "PENDING_APPROVAL",
      "created_at": "2026-04-24T12:00:00.000Z"
    }
  ],
  "pagination": {
    "next_cursor": null,
    "has_more": false,
    "limit": 20
  }
}
```

---

### 4.2 Approve Request

```
POST /api/v1/managers/me/requests/:requestId/approve
Headers:
  Idempotency-Key: <uuid>
```

**Request Body:**

```json
{
  "version": 1
}
```

**Logic:**
1. Verify request exists and `status = PENDING_APPROVAL`
2. Verify authenticated manager is assigned to this request
3. **Revalidate balance** — recalculate `effective_available` inside transaction
4. Transition to `APPROVED_PENDING_HCM`
5. Insert outbox entry with idempotency key for HCM dispatch

**Response: `200 OK`**

```json
{
  "data": {
    "id": "req-uuid-001",
    "status": "APPROVED_PENDING_HCM",
    "version": 2,
    "outbox_id": "outbox-uuid-001",
    "updated_at": "2026-04-24T14:00:00.000Z"
  }
}
```

**Errors:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `INVALID_STATE_TRANSITION` | Not in `PENDING_APPROVAL` |
| 403 | `FORBIDDEN` | Not the assigned manager |
| 409 | `INSUFFICIENT_BALANCE` | Balance no longer sufficient (revalidation failed) |
| 409 | `VERSION_CONFLICT` | Concurrent modification |

---

### 4.3 Reject Request

```
POST /api/v1/managers/me/requests/:requestId/reject
Headers:
  Idempotency-Key: <uuid>
```

**Request Body:**

```json
{
  "version": 1,
  "rejection_reason": "Team capacity is full for that week"
}
```

**Logic:**
1. Verify `status = PENDING_APPROVAL`
2. Transition to `REJECTED`
3. Release the associated balance hold

**Response: `200 OK`**

```json
{
  "data": {
    "id": "req-uuid-001",
    "status": "REJECTED",
    "rejection_reason": "Team capacity is full for that week",
    "hold_status": "RELEASED",
    "version": 2,
    "updated_at": "2026-04-24T14:00:00.000Z"
  }
}
```

**Errors:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `INVALID_STATE_TRANSITION` | Not in `PENDING_APPROVAL` |
| 400 | `VALIDATION_ERROR` | Missing `rejection_reason` |
| 403 | `FORBIDDEN` | Not the assigned manager |
| 409 | `VERSION_CONFLICT` | Concurrent modification |

---

## 5. Integration Endpoints

### 5.1 HCM Batch Sync (Receive Balance Updates)

Called by HCM (or an integration layer) to push balance updates in bulk.

```
POST /api/v1/integrations/hcm/batch-sync
Headers:
  X-Batch-Id: <unique-batch-id>
```

**Request Body:**

```json
{
  "batch_id": "batch-2026-04-24-001",
  "items": [
    {
      "employee_id": "emp-001",
      "leave_type": "PTO",
      "total_balance": 120.0,
      "used_balance": 40.0,
      "hcm_version": "2026-04-24T00:00:00Z"
    },
    {
      "employee_id": "emp-002",
      "leave_type": "PTO",
      "total_balance": 80.0,
      "used_balance": 0.0,
      "hcm_version": "2026-04-24T00:00:00Z"
    }
  ]
}
```

**Processing per item:**
- If `hcm_version` ≤ local `hcm_version` → skip (stale)
- Otherwise → update `balance_projections`, revalidate active holds

**Response: `200 OK`**

```json
{
  "data": {
    "batch_id": "batch-2026-04-24-001",
    "status": "COMPLETED",
    "total_items": 2,
    "processed_items": 1,
    "skipped_items": 1,
    "failed_items": 0,
    "results": [
      {
        "employee_id": "emp-001",
        "leave_type": "PTO",
        "result": "UPDATED"
      },
      {
        "employee_id": "emp-002",
        "leave_type": "PTO",
        "result": "SKIPPED_STALE"
      }
    ]
  }
}
```

**Errors:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | `VALIDATION_ERROR` | Malformed payload |
| 409 | `DUPLICATE_REQUEST` | `batch_id` already processed |

---

### 5.2 HCM Single Balance Update

For real-time balance updates from HCM (e.g., anniversary bonus).

```
POST /api/v1/integrations/hcm/balance-update
Headers:
  Idempotency-Key: <uuid>
```

**Request Body:**

```json
{
  "employee_id": "emp-001",
  "leave_type": "PTO",
  "total_balance": 130.0,
  "used_balance": 40.0,
  "hcm_version": "2026-04-24T12:00:00Z"
}
```

**Response: `200 OK`**

```json
{
  "data": {
    "employee_id": "emp-001",
    "leave_type": "PTO",
    "result": "UPDATED",
    "previous_balance": 120.0,
    "new_balance": 130.0,
    "effective_available": 74.0
  }
}
```

**Errors:**

| Status | Code | Condition |
|--------|------|-----------|
| 422 | `STALE_BATCH` | `hcm_version` ≤ local version |
| 409 | `DUPLICATE_REQUEST` | Idempotency key already processed |

---

### 5.3 Health Check

```
GET /api/v1/health
```

**Response: `200 OK`**

```json
{
  "status": "healthy",
  "checks": {
    "database": "connected",
    "outbox_depth": 3,
    "last_batch_sync": "2026-04-24T06:00:00.000Z",
    "last_reconciliation": "2026-04-24T06:15:00.000Z"
  },
  "uptime_seconds": 86400,
  "version": "1.0.0"
}
```

---

## 6. Idempotency Behavior

All mutating POST endpoints require an `Idempotency-Key` header.

| Scenario | Behavior |
|----------|----------|
| **First call** | Process normally, store key → response mapping |
| **Duplicate call (same key, same payload)** | Return the original response with original status code |
| **Duplicate call (same key, different payload)** | Return `409 DUPLICATE_REQUEST` with error |
| **Key format** | UUIDv4, provided by client |
| **Key expiry** | Keys are valid for 24 hours |

---

## 7. Authentication Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-Employee-Id` | Yes | Authenticated employee ID |
| `X-Employee-Role` | Yes | `EMPLOYEE` or `MANAGER` |
| `X-Manager-Id` | Conditional | Required for manager endpoints; the manager's employee ID |
| `X-Correlation-Id` | No | Client-provided; echoed in response and logged |
| `Idempotency-Key` | On POST | UUIDv4 for mutation idempotency |

---

## 8. Endpoint Summary

| Method | Path | Actor | Description |
|--------|------|-------|-------------|
| GET | `/employees/me/balances` | Employee | Get all balances with effective available |
| POST | `/employees/me/requests` | Employee | Create time-off request |
| GET | `/employees/me/requests` | Employee | List my requests (filtered, paginated) |
| GET | `/employees/me/requests/:id` | Employee | Get single request detail |
| POST | `/employees/me/requests/:id/cancel` | Employee | Cancel a request |
| GET | `/managers/me/pending-approvals` | Manager | List pending approvals |
| POST | `/managers/me/requests/:id/approve` | Manager | Approve a request |
| POST | `/managers/me/requests/:id/reject` | Manager | Reject a request |
| POST | `/integrations/hcm/batch-sync` | HCM/System | Batch balance update |
| POST | `/integrations/hcm/balance-update` | HCM/System | Single balance update |
| GET | `/health` | System | Health check |

---

> **PHASE 3 COMPLETE — Awaiting approval to proceed to Phase 4: State Machine Implementation Design**


## phase4_state_machine.md

# ReadyOn Time-Off Microservice — State Machine Design

**Phase:** 4 of 11  
**Depends on:** Phase 1 (TRD), Phase 2 (Data Model), Phase 3 (API Contract)  
**Status:** DRAFT — Pending Approval

---

## 1. State Diagram

```mermaid
stateDiagram-v2
    [*] --> PENDING_APPROVAL : Employee submits request\n[Hold placed]

    PENDING_APPROVAL --> APPROVED_PENDING_HCM : Manager approves\n[Balance revalidated, Outbox entry created]
    PENDING_APPROVAL --> REJECTED : Manager rejects\n[Hold released]
    PENDING_APPROVAL --> CANCELLED : Employee cancels\n[Hold released]

    APPROVED_PENDING_HCM --> APPROVED : HCM confirms deduction\n[Hold converted, Balance updated]
    APPROVED_PENDING_HCM --> FAILED_HCM : HCM permanently rejects\n[Hold released]
    APPROVED_PENDING_HCM --> CANCELLED : Employee cancels\n[Hold released, Outbox cancelled]

    APPROVED --> RECONCILIATION_REQUIRED : Reconciliation detects drift

    FAILED_HCM --> RECONCILIATION_REQUIRED : Admin flags for review

    RECONCILIATION_REQUIRED --> APPROVED : Reconciliation resolves (confirmed)
    RECONCILIATION_REQUIRED --> CANCELLED : Reconciliation resolves (reverted)
```

---

## 2. State Definitions

| State | Description | Hold Status | Terminal? |
|-------|-------------|-------------|-----------|
| `PENDING_APPROVAL` | Request submitted, awaiting manager action. Balance is held. | `ACTIVE` | No |
| `APPROVED_PENDING_HCM` | Manager approved. Queued for HCM deduction via outbox. | `ACTIVE` | No |
| `APPROVED` | HCM confirmed the deduction. Balance permanently adjusted. | `CONVERTED` | **Yes** |
| `REJECTED` | Manager rejected the request. | `RELEASED` | **Yes** |
| `CANCELLED` | Employee cancelled the request. | `RELEASED` | **Yes** |
| `FAILED_HCM` | HCM permanently rejected (e.g., insufficient balance in HCM). | `RELEASED` | **Yes*** |
| `RECONCILIATION_REQUIRED` | Drift detected between local and HCM state. Needs manual/auto resolution. | Varies | No |

> *`FAILED_HCM` is terminal for normal flow but can transition to `RECONCILIATION_REQUIRED` via admin action.

---

## 3. Transition Table

| # | From | To | Trigger | Actor | Preconditions | Side Effects |
|---|------|----|---------|-------|---------------|-------------|
| T1 | `(new)` | `PENDING_APPROVAL` | Create request | Employee | Balance sufficient, no date overlap | Insert request, insert hold (ACTIVE), audit log |
| T2 | `PENDING_APPROVAL` | `APPROVED_PENDING_HCM` | Approve | Manager | Is assigned manager, balance revalidated | Update request, insert outbox entry, audit log |
| T3 | `PENDING_APPROVAL` | `REJECTED` | Reject | Manager | Is assigned manager, reason provided | Update request, release hold, audit log |
| T4 | `PENDING_APPROVAL` | `CANCELLED` | Cancel | Employee | Is request owner | Update request, release hold, audit log |
| T5 | `APPROVED_PENDING_HCM` | `APPROVED` | HCM success | System | Outbox entry completed | Update request, convert hold, update balance projection, audit log |
| T6 | `APPROVED_PENDING_HCM` | `FAILED_HCM` | HCM permanent failure | System | Outbox retries exhausted or permanent error | Update request, release hold, audit log |
| T7 | `APPROVED_PENDING_HCM` | `CANCELLED` | Cancel | Employee | Is request owner | Update request, release hold, cancel outbox entry, audit log |
| T8 | `APPROVED` | `RECONCILIATION_REQUIRED` | Drift detected | System | Reconciliation job finds mismatch | Update request, audit log with drift details |
| T9 | `FAILED_HCM` | `RECONCILIATION_REQUIRED` | Admin escalation | System | Admin/system flags for review | Update request, audit log |
| T10 | `RECONCILIATION_REQUIRED` | `APPROVED` | Resolution: confirmed | System/Admin | HCM state verified as deducted | Update request, ensure hold converted, audit log |
| T11 | `RECONCILIATION_REQUIRED` | `CANCELLED` | Resolution: reverted | System/Admin | HCM state verified as not deducted | Update request, ensure hold released, audit log |

---

## 4. Transition Matrix (Valid/Invalid)

Rows = current state, Columns = target state. ✅ = valid, ❌ = invalid.

| From \ To | PENDING_APPROVAL | APPROVED_PENDING_HCM | APPROVED | REJECTED | CANCELLED | FAILED_HCM | RECONCILIATION_REQUIRED |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **PENDING_APPROVAL** | ❌ | ✅ T2 | ❌ | ✅ T3 | ✅ T4 | ❌ | ❌ |
| **APPROVED_PENDING_HCM** | ❌ | ❌ | ✅ T5 | ❌ | ✅ T7 | ✅ T6 | ❌ |
| **APPROVED** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ T8 |
| **REJECTED** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **CANCELLED** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **FAILED_HCM** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ T9 |
| **RECONCILIATION_REQUIRED** | ❌ | ❌ | ✅ T10 | ❌ | ✅ T11 | ❌ | ❌ |

---

## 5. Invalid Transition Handling

When an invalid transition is attempted:

```
1. Look up current status from DB (inside transaction)
2. Check transition matrix: isValidTransition(currentStatus, targetStatus)
3. If INVALID:
   a. DO NOT modify any state
   b. Log warning with correlation_id, actor, attempted transition
   c. Return HTTP 400 with error:
      {
        "error": "INVALID_STATE_TRANSITION",
        "message": "Cannot transition from REJECTED to APPROVED",
        "details": {
          "current_status": "REJECTED",
          "attempted_status": "APPROVED",
          "request_id": "req-uuid-001"
        }
      }
```

**Implementation approach — transition map in code:**

```typescript
const VALID_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  PENDING_APPROVAL:        ['APPROVED_PENDING_HCM', 'REJECTED', 'CANCELLED'],
  APPROVED_PENDING_HCM:    ['APPROVED', 'FAILED_HCM', 'CANCELLED'],
  APPROVED:                ['RECONCILIATION_REQUIRED'],
  REJECTED:                [],
  CANCELLED:               [],
  FAILED_HCM:              ['RECONCILIATION_REQUIRED'],
  RECONCILIATION_REQUIRED: ['APPROVED', 'CANCELLED'],
};

function assertValidTransition(from: RequestStatus, to: RequestStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new InvalidStateTransitionException(from, to);
  }
}
```

---

## 6. Idempotency Per Transition

Each transition is designed to be **safely retriable**:

| Transition | Idempotency Mechanism |
|------------|----------------------|
| T1 Create | `Idempotency-Key` header → if key exists, return original `201` response |
| T2 Approve | `Idempotency-Key` + version check → if already `APPROVED_PENDING_HCM`, return current state |
| T3 Reject | `Idempotency-Key` + version check → if already `REJECTED`, return current state |
| T4 Cancel | `Idempotency-Key` + version check → if already `CANCELLED`, return current state |
| T5 HCM Success | Outbox `idempotency_key` → HCM dedup; outbox status check prevents double processing |
| T6 HCM Failure | Outbox status check → if already `FAILED`, skip |
| T7 Cancel (post-approve) | `Idempotency-Key` + outbox cancellation is idempotent |
| T8-T11 Reconciliation | System-driven, checked against current state before applying |

**Key principle:** If a transition has already occurred, the idempotent retry returns the **current state** without performing the transition again. It does NOT return an error.

---

## 7. Hold Lifecycle Correlation

The hold's status is tightly coupled to the request's state:

```
Request Created (PENDING_APPROVAL)    → Hold ACTIVE
  ├─ Approved (APPROVED_PENDING_HCM)  → Hold remains ACTIVE (still reserving)
  │    ├─ HCM Success (APPROVED)      → Hold CONVERTED (becomes real deduction)
  │    ├─ HCM Failure (FAILED_HCM)    → Hold RELEASED
  │    └─ Cancelled (CANCELLED)       → Hold RELEASED
  ├─ Rejected (REJECTED)              → Hold RELEASED
  └─ Cancelled (CANCELLED)            → Hold RELEASED
```

**Invariant:** A hold is ACTIVE if and only if its request is in `PENDING_APPROVAL` or `APPROVED_PENDING_HCM`.

This invariant is enforced by:
1. Every transition that exits these states **must** release or convert the hold in the same transaction.
2. A consistency check query can verify this invariant:

```sql
-- This should return 0 rows. Any results indicate a bug.
SELECT bh.id, bh.request_id, bh.status AS hold_status, tor.status AS request_status
FROM balance_holds bh
JOIN time_off_requests tor ON bh.request_id = tor.id
WHERE (bh.status = 'ACTIVE' AND tor.status NOT IN ('PENDING_APPROVAL', 'APPROVED_PENDING_HCM'))
   OR (bh.status != 'ACTIVE' AND tor.status IN ('PENDING_APPROVAL', 'APPROVED_PENDING_HCM'));
```

---

## 8. Concurrency Scenarios

| Scenario | Resolution |
|----------|-----------|
| Manager approves while employee cancels | First writer wins (optimistic lock). Second gets `VERSION_CONFLICT`. |
| Two managers try to approve same request | Only one assigned manager can approve (`FORBIDDEN` for others). Even if same manager retries, idempotency handles it. |
| Outbox processor runs while employee cancels (APPROVED_PENDING_HCM) | Cancel acquires write lock first → outbox finds request in CANCELLED → skips. OR outbox acquires first → request moves to APPROVED → cancel gets `INVALID_STATE_TRANSITION`. |
| HCM batch sync changes balance while approval in progress | Approval transaction sees the balance at transaction start (serialized). Batch sync waits for approval to commit. |
| Two requests for same employee submitted simultaneously | SQLite single-writer serializes them. Second request sees the hold from the first and may get `INSUFFICIENT_BALANCE`. |

---

## 9. State Machine Enforcement Rules

1. **Single authority**: The `assertValidTransition()` function is the ONLY gate for status changes. No code path bypasses it.
2. **Atomic transitions**: Status change + hold update + audit log happen in ONE transaction. No partial state.
3. **Version bump on every transition**: `version = version + 1` on every status change.
4. **No backward transitions**: Except via `RECONCILIATION_REQUIRED` resolution paths (T10, T11).
5. **Terminal states are final**: `REJECTED`, `CANCELLED`, `APPROVED` cannot transition to any new state except `APPROVED → RECONCILIATION_REQUIRED`.

---

> **PHASE 4 COMPLETE — Awaiting approval to proceed to Phase 5: Core Business Logic Design**


## phase5_business_logic.md

# ReadyOn Time-Off Microservice — Core Business Logic Design

**Phase:** 5 of 11  
**Depends on:** Phases 1–4  
**Status:** DRAFT — Pending Approval

---

## 1. Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Transaction-first** | Every operation wraps all mutations in a single `BEGIN IMMEDIATE` transaction |
| **Validate-then-mutate** | All reads and validations happen before any writes within the transaction |
| **Hold-before-confirm** | Balance is reserved (hold) at creation; revalidated at approval |
| **Fail-fast on conflict** | Optimistic lock check (`version`) fails immediately, no retry at service level |
| **Audit everything** | Every mutation produces an audit log entry within the same transaction |

### SQLite Transaction Strategy

```
BEGIN IMMEDIATE;
-- IMMEDIATE acquires a RESERVED lock, preventing other writers from starting
-- Readers (WAL mode) are NOT blocked
-- This gives us serializable writes without explicit row locks
```

> SQLite's `BEGIN IMMEDIATE` is our equivalent of `SELECT FOR UPDATE`. It ensures only one writer can be active, which eliminates write-write races entirely.

---

## 2. Create Request (Employee)

**Entry:** `POST /api/v1/employees/me/requests`  
**Actor:** Employee (from `X-Employee-Id` header)  
**Transition:** `(new) → PENDING_APPROVAL`

### Step-by-Step

```
STEP 1: Input Validation (pre-transaction)
├── Validate DTO: leave_type, start_date, end_date, hours_requested, reason
├── Assert start_date <= end_date
├── Assert start_date > today (UTC)
├── Assert hours_requested > 0
└── On failure → return 400 VALIDATION_ERROR

STEP 2: Idempotency Check (pre-transaction)
├── Query idempotency store by Idempotency-Key header
├── If key exists AND payload hash matches → return stored response (201)
├── If key exists AND payload hash differs → return 409 DUPLICATE_REQUEST
└── If key not found → continue

STEP 3: BEGIN IMMEDIATE TRANSACTION
│
├── STEP 3a: Load Balance Projection
│   ├── SELECT * FROM balance_projections
│   │   WHERE employee_id = :employeeId AND leave_type = :leaveType
│   ├── If not found → ROLLBACK, return 404 (no balance for this leave type)
│   └── Store as `projection`
│
├── STEP 3b: Check for Overlapping Requests
│   ├── SELECT COUNT(*) FROM time_off_requests
│   │   WHERE employee_id = :employeeId
│   │     AND leave_type = :leaveType
│   │     AND status IN ('PENDING_APPROVAL', 'APPROVED_PENDING_HCM', 'APPROVED')
│   │     AND start_date <= :endDate
│   │     AND end_date >= :startDate
│   ├── If count > 0 → ROLLBACK, return 409 OVERLAPPING_REQUEST
│   └── Continue
│
├── STEP 3c: Calculate Effective Available Balance
│   ├── SELECT COALESCE(SUM(hold_amount), 0) AS total_held
│   │   FROM balance_holds
│   │   WHERE employee_id = :employeeId
│   │     AND leave_type = :leaveType
│   │     AND status = 'ACTIVE'
│   ├── effective_available = projection.projected_available - total_held
│   ├── If effective_available < hours_requested
│   │   → ROLLBACK, return 409 INSUFFICIENT_BALANCE
│   │     { available: effective_available, requested: hours_requested }
│   └── Continue
│
├── STEP 3d: Insert Time-Off Request
│   ├── Generate request_id = UUIDv4
│   ├── INSERT INTO time_off_requests (
│   │     id, employee_id, manager_id, leave_type,
│   │     start_date, end_date, hours_requested,
│   │     reason, status, version
│   │   ) VALUES (
│   │     :id, :employeeId, :managerId, :leaveType,
│   │     :startDate, :endDate, :hoursRequested,
│   │     :reason, 'PENDING_APPROVAL', 1
│   │   )
│   └── manager_id resolved from employee→manager mapping (or null for V1)
│
├── STEP 3e: Insert Balance Hold
│   ├── Generate hold_id = UUIDv4
│   ├── INSERT INTO balance_holds (
│   │     id, request_id, employee_id, leave_type,
│   │     hold_amount, status, version
│   │   ) VALUES (
│   │     :holdId, :requestId, :employeeId, :leaveType,
│   │     :hoursRequested, 'ACTIVE', 1
│   │   )
│   └── Continue
│
├── STEP 3f: Insert Audit Log
│   ├── INSERT INTO audit_logs (
│   │     id, entity_type, entity_id, action,
│   │     actor_type, actor_id, before_state, after_state,
│   │     correlation_id
│   │   ) VALUES (
│   │     UUIDv4, 'REQUEST', :requestId, 'CREATED',
│   │     'EMPLOYEE', :employeeId, NULL, :afterStateJSON,
│   │     :correlationId
│   │   )
│   └── Continue
│
└── COMMIT

STEP 4: Store Idempotency Record
├── Save Idempotency-Key → response mapping (with 24h TTL)
└── Return 201 Created with request data
```

---

## 3. Approve Request (Manager)

**Entry:** `POST /api/v1/managers/me/requests/:requestId/approve`  
**Actor:** Manager (from `X-Manager-Id` header)  
**Transition:** `PENDING_APPROVAL → APPROVED_PENDING_HCM`

### Step-by-Step

```
STEP 1: Input Validation (pre-transaction)
├── Validate requestId is valid UUID
├── Validate version is present in body
└── On failure → return 400 VALIDATION_ERROR

STEP 2: Idempotency Check (pre-transaction)
├── Same as Create flow
└── If already processed → return stored response

STEP 3: BEGIN IMMEDIATE TRANSACTION
│
├── STEP 3a: Load Request
│   ├── SELECT * FROM time_off_requests WHERE id = :requestId
│   ├── If not found → ROLLBACK, return 404
│   └── Store as `request`
│
├── STEP 3b: Authorization Check
│   ├── If request.manager_id != :managerId
│   │   → ROLLBACK, return 403 FORBIDDEN
│   └── Continue
│
├── STEP 3c: State Machine Validation
│   ├── assertValidTransition(request.status, 'APPROVED_PENDING_HCM')
│   ├── If invalid → ROLLBACK, return 400 INVALID_STATE_TRANSITION
│   └── Continue
│
├── STEP 3d: Optimistic Lock Check
│   ├── If request.version != :expectedVersion
│   │   → ROLLBACK, return 409 VERSION_CONFLICT
│   └── Continue
│
├── STEP 3e: Revalidate Balance ⚠️ CRITICAL
│   ├── Load balance_projection for employee + leave_type
│   ├── Calculate total_held from ALL active holds EXCEPT this request's hold
│   │   SELECT COALESCE(SUM(hold_amount), 0) FROM balance_holds
│   │   WHERE employee_id = :employeeId
│   │     AND leave_type = :leaveType
│   │     AND status = 'ACTIVE'
│   │     AND request_id != :requestId
│   ├── effective_available = projection.projected_available - total_held
│   ├── If effective_available < request.hours_requested
│   │   → ROLLBACK, return 409 INSUFFICIENT_BALANCE
│   │   (Balance changed between submission and approval)
│   └── Continue
│
├── STEP 3f: Update Request Status
│   ├── UPDATE time_off_requests
│   │   SET status = 'APPROVED_PENDING_HCM',
│   │       version = version + 1,
│   │       updated_at = NOW()
│   │   WHERE id = :requestId AND version = :expectedVersion
│   ├── Assert changes() == 1 (optimistic lock)
│   └── Continue
│
├── STEP 3g: Create Outbox Entry
│   ├── Generate idempotency_key = UUIDv4
│   ├── INSERT INTO integration_outbox (
│   │     id, request_id, action, idempotency_key,
│   │     payload, status, max_retries
│   │   ) VALUES (
│   │     UUIDv4, :requestId, 'POST_TIME_OFF', :idempotencyKey,
│   │     :payloadJSON, 'PENDING', 5
│   │   )
│   └── Payload includes: employee_id, leave_type, start_date, end_date, hours
│
├── STEP 3h: Insert Audit Log
│   ├── INSERT audit_log with before/after state snapshots
│   └── action = 'STATUS_CHANGED', metadata includes revalidation result
│
└── COMMIT

STEP 4: Store Idempotency Record + Return 200
```

### Why revalidate at approval?

The balance may have changed between submission and approval due to:
- Another request was submitted and held balance
- A batch sync reduced the total balance
- An HCM deduction completed, increasing `used_balance`

We exclude the **current request's hold** from the calculation because that hold is already reserving this request's hours. We're checking: "Is there still enough balance for this hold to be valid?"

---

## 4. Reject Request (Manager)

**Entry:** `POST /api/v1/managers/me/requests/:requestId/reject`  
**Actor:** Manager  
**Transition:** `PENDING_APPROVAL → REJECTED`

### Step-by-Step

```
STEP 1: Input Validation (pre-transaction)
├── Validate requestId, version, rejection_reason (required, non-empty)
└── On failure → return 400

STEP 2: Idempotency Check → same pattern

STEP 3: BEGIN IMMEDIATE TRANSACTION
│
├── STEP 3a: Load Request
│   ├── SELECT * FROM time_off_requests WHERE id = :requestId
│   └── If not found → ROLLBACK, return 404
│
├── STEP 3b: Authorization Check
│   ├── If request.manager_id != :managerId → ROLLBACK, return 403
│   └── Continue
│
├── STEP 3c: State Machine Validation
│   ├── assertValidTransition(request.status, 'REJECTED')
│   └── If invalid → ROLLBACK, return 400
│
├── STEP 3d: Optimistic Lock Check
│   └── If request.version != :expectedVersion → ROLLBACK, return 409
│
├── STEP 3e: Update Request Status
│   ├── UPDATE time_off_requests
│   │   SET status = 'REJECTED',
│   │       rejection_reason = :reason,
│   │       version = version + 1,
│   │       updated_at = NOW()
│   │   WHERE id = :requestId AND version = :expectedVersion
│   └── Assert changes() == 1
│
├── STEP 3f: Release Balance Hold ⚠️
│   ├── UPDATE balance_holds
│   │   SET status = 'RELEASED',
│   │       released_at = NOW(),
│   │       version = version + 1,
│   │       updated_at = NOW()
│   │   WHERE request_id = :requestId AND status = 'ACTIVE'
│   ├── Assert changes() == 1 (exactly one active hold expected)
│   └── If changes() == 0 → Log ERROR (invariant violation: no active hold found)
│
├── STEP 3g: Insert Audit Logs (request + hold)
│
└── COMMIT

STEP 4: Store Idempotency Record + Return 200
```

**No balance revalidation needed** — we're releasing the hold, not consuming it.

---

## 5. Cancel Request (Employee)

**Entry:** `POST /api/v1/employees/me/requests/:requestId/cancel`  
**Actor:** Employee  
**Transition:** `PENDING_APPROVAL → CANCELLED` or `APPROVED_PENDING_HCM → CANCELLED`

### Step-by-Step

```
STEP 1: Input Validation (pre-transaction)
├── Validate requestId, version
└── On failure → return 400

STEP 2: Idempotency Check → same pattern

STEP 3: BEGIN IMMEDIATE TRANSACTION
│
├── STEP 3a: Load Request
│   ├── SELECT * FROM time_off_requests WHERE id = :requestId
│   ├── If not found → ROLLBACK, return 404
│   └── If request.employee_id != :employeeId → ROLLBACK, return 404
│       (Don't reveal existence to non-owners)
│
├── STEP 3b: State Machine Validation
│   ├── assertValidTransition(request.status, 'CANCELLED')
│   ├── Valid from: PENDING_APPROVAL, APPROVED_PENDING_HCM
│   └── If invalid → ROLLBACK, return 400
│
├── STEP 3c: Optimistic Lock Check
│   └── If request.version != :expectedVersion → ROLLBACK, return 409
│
├── STEP 3d: Update Request Status
│   ├── UPDATE time_off_requests
│   │   SET status = 'CANCELLED',
│   │       version = version + 1,
│   │       updated_at = NOW()
│   │   WHERE id = :requestId AND version = :expectedVersion
│   └── Assert changes() == 1
│
├── STEP 3e: Release Balance Hold
│   ├── UPDATE balance_holds
│   │   SET status = 'RELEASED',
│   │       released_at = NOW(),
│   │       version = version + 1
│   │   WHERE request_id = :requestId AND status = 'ACTIVE'
│   └── Assert changes() == 1
│
├── STEP 3f: Cancel Outbox Entry (if exists)
│   ├── Only applicable when cancelling from APPROVED_PENDING_HCM
│   ├── UPDATE integration_outbox
│   │   SET status = 'FAILED',
│   │       error_category = 'PERMANENT',
│   │       last_error = 'Request cancelled by employee',
│   │       updated_at = NOW()
│   │   WHERE request_id = :requestId
│   │     AND status IN ('PENDING', 'PROCESSING')
│   └── If no rows affected → outbox may have already completed (race with processor)
│       → This is handled: if outbox already sent to HCM, we'll need a cancellation
│         outbox entry (future enhancement). For V1, log a warning.
│
├── STEP 3g: Insert Audit Logs
│
└── COMMIT

STEP 4: Store Idempotency Record + Return 200
```

### Cancel Race Condition: Employee Cancel vs Outbox Processor

```
Timeline:
  T1: Outbox processor picks up entry, marks PROCESSING
  T2: Employee hits cancel
  T3: Outbox processor calls HCM successfully
  T4: Outbox processor tries to update request to APPROVED

Resolution:
  At T2: Cancel acquires IMMEDIATE lock first
    → Request moves to CANCELLED
    → Hold released
    → Outbox entry marked FAILED
    → When outbox processor returns at T4, it finds:
       - Outbox status = FAILED → skips
       - OR request status = CANCELLED → assertValidTransition fails → skips

  At T2: Outbox processor holds lock (T1 acquired it)
    → Employee cancel waits for lock (busy_timeout = 5s)
    → Outbox processor completes at T3/T4 → request now APPROVED
    → Employee cancel gets lock → assertValidTransition(APPROVED, CANCELLED) → FAILS
    → Return 400 INVALID_STATE_TRANSITION
    → This is correct! Once HCM has deducted, we can't cancel locally.
```

---

## 6. Outbox Processing (System)

**Trigger:** Scheduled job (every 10 seconds)  
**Actor:** System  
**Transition:** `APPROVED_PENDING_HCM → APPROVED` or `APPROVED_PENDING_HCM → FAILED_HCM`

### Step-by-Step

```
STEP 1: Claim Outbox Entries
├── BEGIN IMMEDIATE TRANSACTION
├── SELECT id, request_id, action, idempotency_key, payload, retry_count
│   FROM integration_outbox
│   WHERE status = 'PENDING'
│     AND (next_retry_at IS NULL OR next_retry_at <= NOW())
│   ORDER BY created_at ASC
│   LIMIT 10
├── UPDATE integration_outbox SET status = 'PROCESSING'
│   WHERE id IN (:selectedIds) AND status = 'PENDING'
├── COMMIT
└── Store claimed entries in memory

STEP 2: For Each Claimed Entry
│
├── STEP 2a: Verify Request Still Valid
│   ├── SELECT status FROM time_off_requests WHERE id = :requestId
│   ├── If status != 'APPROVED_PENDING_HCM' → mark outbox FAILED, skip
│   └── Continue
│
├── STEP 2b: Call HCM Adapter
│   ├── result = hcmAdapter.postTimeOff({
│   │     idempotency_key, employee_id, leave_type,
│   │     start_date, end_date, hours
│   │   })
│   ├── Timeout: 30 seconds
│   └── Capture result or error
│
├── STEP 2c: Handle SUCCESS
│   ├── BEGIN IMMEDIATE TRANSACTION
│   │
│   ├── Re-read request (status check + version)
│   ├── If status != 'APPROVED_PENDING_HCM' → ROLLBACK (cancelled in flight)
│   │
│   ├── UPDATE time_off_requests
│   │   SET status = 'APPROVED',
│   │       hcm_reference_id = :hcmRefId,
│   │       version = version + 1
│   │
│   ├── UPDATE balance_holds
│   │   SET status = 'CONVERTED', released_at = NOW(), version = version + 1
│   │   WHERE request_id = :requestId AND status = 'ACTIVE'
│   │
│   ├── UPDATE balance_projections
│   │   SET used_balance = used_balance + :hours,
│   │       projected_available = projected_available - :hours,
│   │       version = version + 1
│   │   WHERE employee_id = :employeeId AND leave_type = :leaveType
│   │
│   ├── UPDATE integration_outbox
│   │   SET status = 'COMPLETED', completed_at = NOW()
│   │   WHERE id = :outboxId
│   │
│   ├── INSERT audit_logs (REQUEST status change + BALANCE update + HOLD conversion)
│   │
│   └── COMMIT
│
├── STEP 2d: Handle TRANSIENT FAILURE (timeout, 5xx, network error)
│   ├── UPDATE integration_outbox
│   │   SET status = 'PENDING',
│   │       retry_count = retry_count + 1,
│   │       next_retry_at = NOW() + exponential_backoff(retry_count),
│   │       last_error = :errorMessage,
│   │       error_category = 'TRANSIENT'
│   │   WHERE id = :outboxId
│   ├── If retry_count >= max_retries → handle as permanent failure
│   └── Continue to next entry
│
└── STEP 2e: Handle PERMANENT FAILURE (400, 422, insufficient_balance)
    ├── BEGIN IMMEDIATE TRANSACTION
    │
    ├── UPDATE time_off_requests
    │   SET status = 'FAILED_HCM', version = version + 1
    │   WHERE id = :requestId AND status = 'APPROVED_PENDING_HCM'
    │
    ├── UPDATE balance_holds
    │   SET status = 'RELEASED', released_at = NOW(), version = version + 1
    │   WHERE request_id = :requestId AND status = 'ACTIVE'
    │
    ├── UPDATE integration_outbox
    │   SET status = 'FAILED', error_category = 'PERMANENT',
    │       last_error = :errorMessage
    │   WHERE id = :outboxId
    │
    ├── INSERT audit_logs
    │
    └── COMMIT

Exponential Backoff Schedule:
  Retry 1: 10 seconds
  Retry 2: 30 seconds
  Retry 3: 90 seconds
  Retry 4: 270 seconds (~4.5 min)
  Retry 5: 810 seconds (~13.5 min)
  Total window: ~19 minutes before permanent failure
```

---

## 7. Balance Calculation Reference

Used in both Create and Approve flows:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  total_balance (from HCM)                               │
│  ├── used_balance (confirmed HCM deductions)            │
│  │   └── projected_available = total - used             │
│  │       ├── active_holds (sum of ACTIVE holds)         │
│  │       │   └── effective_available = projected - held │
│  │       └── *** This is what we check against ***      │
│                                                         │
└─────────────────────────────────────────────────────────┘

At CREATE:
  effective_available = projected_available - SUM(all active holds)
  Must be >= hours_requested

At APPROVE (revalidation):
  effective_available = projected_available - SUM(active holds EXCLUDING this request)
  Must be >= this request's hours_requested
  (We exclude this hold because it's already counted)
```

---

## 8. Cross-Cutting Concerns

### Correlation ID Propagation
- Every API request generates or accepts a `correlation_id`
- Passed through: Controller → Service → Repository → Audit Log
- Used in all log statements for request tracing

### Error Logging Strategy
- **INFO**: Successful state transitions, balance calculations
- **WARN**: Idempotent duplicate detected, stale batch skipped, cancel race (benign)
- **ERROR**: Invariant violations (missing hold, unexpected state), HCM permanent failures
- **FATAL**: Transaction failures, database corruption indicators

### Transaction Timeout
- All transactions should complete within 5 seconds
- If `busy_timeout` expires (another writer holds lock), SQLite throws `SQLITE_BUSY`
- Caught and returned as `500 INTERNAL_ERROR` with retry guidance

---

> **PHASE 5 COMPLETE — Awaiting approval to proceed to Phase 6: HCM Integration Layer**


## phase6_hcm_integration.md

# ReadyOn Time-Off Microservice — HCM Integration Layer

**Phase:** 6 of 11  
**Depends on:** Phases 1–5  
**Status:** DRAFT — Pending Approval

---

## 1. Architecture: Port & Adapter Pattern

```
┌─────────────────────────────────────────────┐
│           Business Logic Layer              │
│                                             │
│  TimeOffService / OutboxProcessor           │
│         │                                   │
│         ▼                                   │
│  ┌─────────────────────┐                    │
│  │  HcmAdapterPort     │ ← Interface (Port) │
│  │  (abstract contract)│                    │
│  └────────┬────────────┘                    │
│           │                                 │
└───────────┼─────────────────────────────────┘
            │
     ┌──────┴──────────────┐
     │                     │
┌────▼─────────┐   ┌──────▼──────────┐
│ Production   │   │ Mock HCM        │
│ HCM Adapter  │   │ Adapter         │
│ (HTTP calls) │   │ (In-memory,     │
│              │   │  configurable)  │
└──────────────┘   └─────────────────┘
```

The business logic depends **only** on `HcmAdapterPort`. The concrete implementation is injected via NestJS DI, making the entire HCM layer swappable for testing.

---

## 2. Adapter Interface (Port)

```typescript
// hcm-adapter.port.ts

export interface HcmAdapterPort {
  /**
   * Fetch the current balance for an employee + leave type from HCM.
   * Used during reconciliation to compare against local projection.
   */
  getBalance(request: HcmGetBalanceRequest): Promise<HcmGetBalanceResponse>;

  /**
   * Post a time-off deduction to HCM. Must be idempotent — calling with
   * the same idempotency_key returns the original result, not a new deduction.
   */
  postTimeOff(request: HcmPostTimeOffRequest): Promise<HcmPostTimeOffResponse>;

  /**
   * Cancel a previously posted time-off in HCM.
   * Idempotent via the cancellation idempotency key.
   */
  cancelTimeOff(request: HcmCancelTimeOffRequest): Promise<HcmCancelTimeOffResponse>;

  /**
   * Fetch batch balance updates from HCM.
   * Returns all balances updated since the given checkpoint.
   */
  getBatchBalances(request: HcmBatchBalancesRequest): Promise<HcmBatchBalancesResponse>;
}

// Injection token
export const HCM_ADAPTER_PORT = Symbol('HCM_ADAPTER_PORT');
```

---

## 3. DTOs — Request & Response Types

### 3.1 getBalance

```typescript
interface HcmGetBalanceRequest {
  employee_id: string;
  leave_type: string;
  correlation_id: string;
}

interface HcmGetBalanceResponse {
  employee_id: string;
  leave_type: string;
  total_balance: number;
  used_balance: number;
  hcm_version: string;       // HCM's version stamp for this balance record
}
```

### 3.2 postTimeOff

```typescript
interface HcmPostTimeOffRequest {
  idempotency_key: string;    // UUIDv4 — HCM uses this for dedup
  employee_id: string;
  leave_type: string;
  start_date: string;         // ISO-8601 date
  end_date: string;
  hours: number;
  correlation_id: string;
}

interface HcmPostTimeOffResponse {
  hcm_reference_id: string;   // HCM's internal ID for this time-off record
  status: 'ACCEPTED';         // HCM has accepted and deducted
  hcm_version: string;        // New balance version after deduction
}
```

### 3.3 cancelTimeOff

```typescript
interface HcmCancelTimeOffRequest {
  idempotency_key: string;    // Cancellation-specific key (NOT same as original post key)
  hcm_reference_id: string;   // From original postTimeOff response
  employee_id: string;
  leave_type: string;
  correlation_id: string;
}

interface HcmCancelTimeOffResponse {
  status: 'CANCELLED';
  hcm_version: string;        // New balance version after reversal
}
```

### 3.4 getBatchBalances

```typescript
interface HcmBatchBalancesRequest {
  since_checkpoint: string;   // ISO-8601 timestamp — "give me updates since..."
  correlation_id: string;
}

interface HcmBatchBalancesResponse {
  checkpoint: string;         // New checkpoint for next call
  items: HcmBalanceItem[];
}

interface HcmBalanceItem {
  employee_id: string;
  leave_type: string;
  total_balance: number;
  used_balance: number;
  hcm_version: string;
}
```

---

## 4. Error Classification

All HCM errors are classified into **exactly two categories** to drive retry behavior:

### 4.1 Error Hierarchy

```typescript
// Base error
abstract class HcmError extends Error {
  abstract readonly category: 'TRANSIENT' | 'PERMANENT';
  abstract readonly hcmErrorCode: string;
  readonly correlationId: string;
}

// TRANSIENT — safe to retry
class HcmTransientError extends HcmError {
  readonly category = 'TRANSIENT' as const;
}

// PERMANENT — do NOT retry, will never succeed
class HcmPermanentError extends HcmError {
  readonly category = 'PERMANENT' as const;
}
```

### 4.2 Classification Matrix

| HCM Response | HTTP Status | Category | Error Code | Action |
|-------------|-------------|----------|------------|--------|
| Timeout (no response) | — | `TRANSIENT` | `HCM_TIMEOUT` | Retry with backoff |
| Connection refused | — | `TRANSIENT` | `HCM_UNREACHABLE` | Retry with backoff |
| Connection reset | — | `TRANSIENT` | `HCM_CONNECTION_RESET` | Retry with backoff |
| 429 Too Many Requests | 429 | `TRANSIENT` | `HCM_RATE_LIMITED` | Retry with `Retry-After` header value |
| 500 Internal Server Error | 500 | `TRANSIENT` | `HCM_INTERNAL_ERROR` | Retry with backoff |
| 502 Bad Gateway | 502 | `TRANSIENT` | `HCM_BAD_GATEWAY` | Retry with backoff |
| 503 Service Unavailable | 503 | `TRANSIENT` | `HCM_UNAVAILABLE` | Retry with backoff |
| 504 Gateway Timeout | 504 | `TRANSIENT` | `HCM_GATEWAY_TIMEOUT` | Retry with backoff |
| 400 Bad Request | 400 | `PERMANENT` | `HCM_BAD_REQUEST` | Fail, log payload for debugging |
| 401 Unauthorized | 401 | `PERMANENT`* | `HCM_UNAUTHORIZED` | Fail, alert ops |
| 403 Forbidden | 403 | `PERMANENT` | `HCM_FORBIDDEN` | Fail, alert ops |
| 404 Not Found | 404 | `PERMANENT` | `HCM_NOT_FOUND` | Fail (employee/type not in HCM) |
| 409 Conflict | 409 | `PERMANENT` | `HCM_CONFLICT` | Fail (duplicate with different data) |
| 422 Insufficient Balance | 422 | `PERMANENT` | `HCM_INSUFFICIENT_BALANCE` | Fail, trigger reconciliation |
| 422 Invalid Leave Type | 422 | `PERMANENT` | `HCM_INVALID_LEAVE_TYPE` | Fail, alert ops |

> *401 could theoretically be transient (expired token), but in our model the integration uses service-to-service auth that shouldn't expire mid-request. Treating as permanent forces ops visibility.

---

## 5. Idempotency Key Strategy

### 5.1 Key Generation Rules

| Operation | Key Source | Format |
|-----------|-----------|--------|
| `postTimeOff` | Generated at outbox entry creation | `pto-{requestId}-{UUIDv4}` |
| `cancelTimeOff` | Generated at cancel outbox entry | `cancel-{requestId}-{UUIDv4}` |

### 5.2 Key Lifecycle

```
1. Key is generated INSIDE the approval transaction (Step 3g, Phase 5)
2. Key is stored in integration_outbox.idempotency_key
3. Key is sent as a header/field to HCM on every attempt (including retries)
4. HCM uses the key to deduplicate:
   - First call: processes and stores key → response mapping
   - Subsequent calls with same key: returns original response
5. Key is never reused for a different request
```

### 5.3 Idempotency Failure Modes

| Scenario | Handling |
|----------|----------|
| HCM returns success but we crash before committing | On restart, outbox processor retries with same key → HCM returns original success → we process normally |
| HCM returns success but our DB update fails | Same as above — retry is safe because HCM deduplicates |
| Network timeout — did HCM receive it? | Retry with same key — if HCM received it, returns original result; if not, processes normally |

---

## 6. Timeout Configuration

```typescript
interface HcmTimeoutConfig {
  // Per-operation timeouts
  getBalance: {
    connectTimeout: 5_000,     // 5s to establish connection
    requestTimeout: 15_000,    // 15s total request time
  },
  postTimeOff: {
    connectTimeout: 5_000,
    requestTimeout: 30_000,    // 30s — deduction is critical, allow more time
  },
  cancelTimeOff: {
    connectTimeout: 5_000,
    requestTimeout: 30_000,
  },
  getBatchBalances: {
    connectTimeout: 5_000,
    requestTimeout: 60_000,    // 60s — batch can be large
  },
}
```

### Timeout Handling

```
On timeout:
  1. We do NOT know if HCM processed the request
  2. Classify as TRANSIENT → retry with same idempotency key
  3. HCM's idempotency guarantee ensures no double deduction
  4. Log WARNING with correlation_id, elapsed time, operation
```

---

## 7. Retry Logic

### 7.1 Exponential Backoff Formula

```typescript
function calculateNextRetry(retryCount: number): Date {
  const baseDelayMs = 10_000;  // 10 seconds
  const maxDelayMs = 900_000;  // 15 minutes cap
  const jitterMs = Math.random() * 5_000;  // 0-5s random jitter

  const delayMs = Math.min(
    baseDelayMs * Math.pow(3, retryCount) + jitterMs,
    maxDelayMs
  );

  return new Date(Date.now() + delayMs);
}
```

### 7.2 Retry Schedule

| Retry # | Base Delay | With Jitter (approx) |
|---------|-----------|---------------------|
| 1 | 10s | 10–15s |
| 2 | 30s | 30–35s |
| 3 | 90s | 90–95s |
| 4 | 270s (~4.5m) | 4.5–5m |
| 5 | 810s (~13.5m) | 13.5–14m |
| **Total** | — | **~19 minutes** |

After max retries exhausted → classify as `PERMANENT` failure → trigger `FAILED_HCM` transition.

### 7.3 Retry Guards

```
Before each retry:
  1. Re-read outbox entry — if status != PENDING, skip (may have been cancelled)
  2. Re-read request — if status != APPROVED_PENDING_HCM, skip
  3. Check retry_count < max_retries
  4. Only then dispatch to HCM
```

---

## 8. Circuit Breaker (Lightweight)

A simple in-memory circuit breaker protects against sustained HCM outages:

```
States: CLOSED → OPEN → HALF_OPEN

CLOSED (normal):
  - All requests pass through
  - Track consecutive failures
  - If consecutive_failures >= 5 → transition to OPEN

OPEN (HCM assumed down):
  - All requests immediately return HcmTransientError
  - No actual HTTP calls made
  - After cool_down_period (60s) → transition to HALF_OPEN

HALF_OPEN (testing):
  - Allow 1 request through
  - If success → CLOSED, reset failure counter
  - If failure → OPEN, restart cool_down
```

**Why lightweight?** SQLite single-writer means we don't have high concurrency. A simple in-memory counter suffices. No need for external state or distributed circuit breaker.

---

## 9. Production Adapter Implementation Sketch

```typescript
@Injectable()
class ProductionHcmAdapter implements HcmAdapterPort {
  constructor(
    private readonly httpService: HttpService,
    private readonly config: HcmConfig,
    private readonly circuitBreaker: CircuitBreaker,
    private readonly logger: Logger,
  ) {}

  async postTimeOff(request: HcmPostTimeOffRequest): Promise<HcmPostTimeOffResponse> {
    // 1. Circuit breaker check
    this.circuitBreaker.ensureClosed();

    // 2. Build HTTP request
    const url = `${this.config.baseUrl}/api/time-off`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': request.idempotency_key,
      'X-Correlation-Id': request.correlation_id,
      'Authorization': `Bearer ${this.config.serviceToken}`,
    };

    try {
      // 3. Execute with timeout
      const response = await firstValueFrom(
        this.httpService.post(url, request, {
          headers,
          timeout: this.config.timeouts.postTimeOff.requestTimeout,
        })
      );

      // 4. Success — reset circuit breaker
      this.circuitBreaker.recordSuccess();

      return {
        hcm_reference_id: response.data.reference_id,
        status: 'ACCEPTED',
        hcm_version: response.data.version,
      };

    } catch (error) {
      // 5. Classify and throw
      const classified = this.classifyError(error, request.correlation_id);
      if (classified.category === 'TRANSIENT') {
        this.circuitBreaker.recordFailure();
      }
      throw classified;
    }
  }

  private classifyError(error: any, correlationId: string): HcmError {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new HcmTransientError('HCM_TIMEOUT', 'Request timed out', correlationId);
    }
    if (error.code === 'ECONNREFUSED') {
      return new HcmTransientError('HCM_UNREACHABLE', 'Connection refused', correlationId);
    }
    if (error.response) {
      const status = error.response.status;
      if ([429, 500, 502, 503, 504].includes(status)) {
        return new HcmTransientError(`HCM_${status}`, error.message, correlationId);
      }
      // All other HTTP errors are permanent
      return new HcmPermanentError(
        `HCM_${status}`,
        error.response.data?.message || error.message,
        correlationId
      );
    }
    // Unknown errors treated as transient (safe default)
    return new HcmTransientError('HCM_UNKNOWN', error.message, correlationId);
  }
}
```

---

## 10. Adapter Contract Summary

| Method | Idempotent? | Retry Safe? | Side Effects in HCM | Timeout |
|--------|:-----------:|:-----------:|---------------------|---------|
| `getBalance` | N/A (read) | Yes | None | 15s |
| `postTimeOff` | ✅ via key | ✅ | Deducts balance | 30s |
| `cancelTimeOff` | ✅ via key | ✅ | Reverses deduction | 30s |
| `getBatchBalances` | N/A (read) | Yes | None | 60s |

---

> **PHASE 6 COMPLETE — Awaiting approval to proceed to Phase 7: Batch Sync + Reconciliation**


## phase7_batch_reconciliation.md

# ReadyOn Time-Off Microservice — Batch Sync + Reconciliation

**Phase:** 7 of 11  
**Depends on:** Phases 1–6  
**Status:** DRAFT — Pending Approval

---

## 1. Overview

Two complementary mechanisms keep the local projection aligned with HCM:

| Mechanism | Direction | Trigger | Purpose |
|-----------|-----------|---------|---------|
| **Batch Sync** | HCM → ReadyOn | Scheduled or HCM-pushed | Apply bulk balance updates, reject stale data |
| **Reconciliation** | ReadyOn ↔ HCM | Scheduled | Detect drift, auto-repair or flag for review |

```
            Batch Sync (Inbound)                Reconciliation (Bidirectional)
            ─────────────────────               ───────────────────────────────
  HCM ──batch of balances──▶ ReadyOn     ReadyOn ──getBalance──▶ HCM
                                │                      │
                         version gate              compare
                                │                      │
                       update or skip          drift? repair or flag
```

---

## 2. Batch Sync — Inbound Balance Processing

### 2.1 Entry Point

Two paths to receive batch data:

1. **Push (API):** HCM calls `POST /api/v1/integrations/hcm/batch-sync` with a payload
2. **Pull (Scheduled):** Scheduler triggers `BatchSyncService.pull()` which calls `hcmAdapter.getBatchBalances()`

Both converge on the same processing pipeline.

### 2.2 Processing Flow

```
STEP 1: Create Batch Record
├── Generate batch internal ID
├── INSERT INTO integration_batches (
│     id, batch_id, source, status, total_items, started_at
│   )
├── If batch_id already exists → return 409 DUPLICATE_REQUEST
│   (batch_id has UNIQUE constraint)
└── Continue

STEP 2: Process Each Item (one-at-a-time, each in its own transaction)
│
FOR EACH item in batch.items:
│
├── STEP 2a: BEGIN IMMEDIATE TRANSACTION
│   │
│   ├── Load Local Projection
│   │   ├── SELECT * FROM balance_projections
│   │   │   WHERE employee_id = :item.employee_id
│   │   │     AND leave_type = :item.leave_type
│   │   └── Store as `local`
│   │
│   ├── STEP 2b: Version Gate ⚠️ CRITICAL
│   │   ├── If local is NULL (new employee/type):
│   │   │   → INSERT new balance_projection with HCM data → mark CREATED
│   │   │
│   │   ├── If item.hcm_version <= local.hcm_version:
│   │   │   → ROLLBACK, mark SKIPPED_STALE
│   │   │   → This HCM data is older than what we already have
│   │   │
│   │   └── If item.hcm_version > local.hcm_version:
│   │       → Continue to update
│   │
│   ├── STEP 2c: Apply Balance Update
│   │   ├── Store before_state for audit
│   │   ├── UPDATE balance_projections SET
│   │   │     total_balance = :item.total_balance,
│   │   │     used_balance = :item.used_balance,
│   │   │     projected_available = :item.total_balance - :item.used_balance,
│   │   │     hcm_version = :item.hcm_version,
│   │   │     version = version + 1,
│   │   │     updated_at = NOW()
│   │   │   WHERE employee_id = :item.employee_id
│   │   │     AND leave_type = :item.leave_type
│   │   │     AND version = :local.version  -- optimistic lock
│   │   ├── If changes() == 0 → concurrent modification
│   │   │   → ROLLBACK, mark FAILED (retry in next batch)
│   │   └── Continue
│   │
│   ├── STEP 2d: Revalidate Active Holds
│   │   ├── Calculate new effective_available:
│   │   │   new_projected = item.total_balance - item.used_balance
│   │   │   total_held = SUM(hold_amount) WHERE status = 'ACTIVE'
│   │   │                AND employee_id AND leave_type match
│   │   │   new_effective = new_projected - total_held
│   │   │
│   │   ├── If new_effective < 0:
│   │   │   → Active holds exceed available balance
│   │   │   → Flag affected requests as RECONCILIATION_REQUIRED
│   │   │   → INSERT audit_log with drift details
│   │   │   → DO NOT auto-release holds (could cause data loss)
│   │   │
│   │   └── If new_effective >= 0:
│   │       → Holds are still valid, no action needed
│   │
│   ├── STEP 2e: Audit Log
│   │   ├── INSERT audit_log with:
│   │   │   entity_type: 'BALANCE'
│   │   │   action: 'BATCH_UPDATED'
│   │   │   before_state: { old balance values }
│   │   │   after_state: { new balance values }
│   │   │   metadata: { batch_id, hcm_version_old, hcm_version_new }
│   │   └── Continue
│   │
│   └── COMMIT → mark item as UPDATED
│
└── Continue to next item

STEP 3: Finalize Batch Record
├── UPDATE integration_batches SET
│     status = (ALL succeeded? 'COMPLETED' : has failures? 'PARTIAL' : 'COMPLETED'),
│     processed_items = :count_updated + :count_created,
│     skipped_items = :count_skipped,
│     failed_items = :count_failed,
│     error_summary = :errorsJSON,
│     completed_at = NOW()
│   WHERE id = :batchId
└── Return batch summary
```

### 2.3 Version Gate Logic (Detail)

```
Version comparison uses string comparison of ISO-8601 timestamps:

  HCM sends:    hcm_version = "2026-04-24T00:00:00Z"
  Local has:    hcm_version = "2026-04-20T00:00:00Z"

  "2026-04-24..." > "2026-04-20..."  →  ACCEPT (newer data)

  HCM sends:    hcm_version = "2026-04-18T00:00:00Z"
  Local has:    hcm_version = "2026-04-20T00:00:00Z"

  "2026-04-18..." < "2026-04-20..."  →  REJECT (stale data)

Why ISO-8601 string comparison works:
  - Fixed format ensures lexicographic order matches temporal order
  - No timezone ambiguity (all UTC with Z suffix)
  - If HCM uses non-timestamp versions, we compare as opaque strings
    and fall back to always-accept (configurable)
```

### 2.4 Why Individual Transactions Per Item?

1. **Isolation**: One bad item doesn't roll back the entire batch
2. **Observability**: We know exactly which items succeeded/failed
3. **Recoverability**: Failed items can be retried in the next batch
4. **Hold revalidation**: Each item may affect different employees

---

## 3. Pull-Based Batch Sync (Scheduled)

### 3.1 Checkpoint Management

```sql
-- Stored in a simple key-value config table or file
CREATE TABLE IF NOT EXISTS sync_checkpoints (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row:
-- key: 'hcm_batch_checkpoint'
-- value: '2026-04-24T06:00:00Z'
```

### 3.2 Pull Flow

```
STEP 1: Read checkpoint
├── SELECT value FROM sync_checkpoints WHERE key = 'hcm_batch_checkpoint'
└── Default to epoch if not found

STEP 2: Call HCM
├── response = hcmAdapter.getBatchBalances({ since_checkpoint: checkpoint })
├── On HCM error → log, exit (try again next scheduled run)
└── Continue

STEP 3: Process items
├── Same pipeline as Section 2.2 (STEP 2 onward)
└── Generate a batch_id: 'pull-{timestamp}'

STEP 4: Update checkpoint
├── Only if at least 1 item was successfully processed
├── UPDATE sync_checkpoints SET value = response.checkpoint
└── If 0 items processed → keep old checkpoint (don't advance past failures)
```

### 3.3 Schedule

```
Batch sync pull: Every 15 minutes (configurable via environment variable)
  CRON: */15 * * * *
```

---

## 4. Reconciliation — Drift Detection & Repair

### 4.1 Purpose

Batch sync handles **known updates** from HCM. Reconciliation handles **unknown drift** — cases where our local projection has diverged from HCM without a batch update telling us.

Causes of drift:
- HCM admin manually adjusted balance
- Batch sync missed items (partial failure)
- Bug in our balance update logic
- HCM processed a deduction we don't know about
- Our outbox marked as success but HCM actually failed (rare, idempotency gap)

### 4.2 Reconciliation Flow

```
STEP 1: Select Employees to Reconcile
├── Strategy: Round-robin through all employees with active projections
├── SELECT DISTINCT employee_id, leave_type FROM balance_projections
│   WHERE employee_id > :last_reconciled_employee_id
│   ORDER BY employee_id
│   LIMIT :batch_size (default 50)
├── Store last_reconciled_employee_id for next run
└── If no more → wrap around to beginning

STEP 2: For Each Employee+LeaveType Pair
│
├── STEP 2a: Fetch HCM Balance
│   ├── response = hcmAdapter.getBalance({ employee_id, leave_type })
│   ├── On HCM error → skip this pair, log, continue to next
│   └── Store as `hcm_balance`
│
├── STEP 2b: Load Local State
│   ├── SELECT * FROM balance_projections
│   │   WHERE employee_id AND leave_type match
│   ├── Calculate local_effective:
│   │   used_with_holds = local.used_balance + SUM(active holds)
│   │   (What HCM should reflect once our pending deductions complete)
│   └── Store as `local`
│
├── STEP 2c: Calculate Drift
│   ├── total_drift = |hcm_balance.total_balance - local.total_balance|
│   ├── used_drift = |hcm_balance.used_balance - local.used_balance|
│   │
│   │   ⚠️ Note: used_balance drift is EXPECTED when we have active
│   │   holds (APPROVED_PENDING_HCM). We account for this:
│   │
│   ├── pending_deductions = SUM(hours_requested)
│   │   FROM time_off_requests
│   │   WHERE employee_id AND leave_type match
│   │     AND status = 'APPROVED_PENDING_HCM'
│   │
│   ├── adjusted_used_drift = |hcm_balance.used_balance
│   │                          - (local.used_balance + pending_deductions)|
│   │
│   └── effective_drift = MAX(total_drift, adjusted_used_drift)
│
├── STEP 2d: Apply Resolution Rules
│   │
│   ├── IF effective_drift == 0:
│   │   → No drift. Update hcm_version if HCM's is newer. Log INFO.
│   │
│   ├── IF effective_drift <= AUTO_REPAIR_THRESHOLD (default: 8 hours):
│   │   → Auto-repair:
│   │   ├── BEGIN IMMEDIATE TRANSACTION
│   │   ├── UPDATE balance_projections
│   │   │   SET total_balance = hcm_balance.total_balance,
│   │   │       used_balance = hcm_balance.used_balance,
│   │   │       projected_available = total - used,
│   │   │       hcm_version = hcm_balance.hcm_version,
│   │   │       version = version + 1
│   │   │   WHERE employee_id AND leave_type AND version = :expected
│   │   ├── Revalidate holds (same as batch sync Step 2d)
│   │   ├── INSERT audit_log (action: 'RECONCILIATION_AUTO_REPAIR')
│   │   │   metadata: { drift_amount, direction, hcm_values, local_values }
│   │   └── COMMIT
│   │
│   └── IF effective_drift > AUTO_REPAIR_THRESHOLD:
│       → Flag for manual review:
│       ├── Flag affected APPROVED requests as RECONCILIATION_REQUIRED
│       ├── INSERT audit_log (action: 'RECONCILIATION_FLAGGED')
│       │   metadata: { drift_amount, direction, hcm_values, local_values }
│       └── Log WARN with all details
│
└── Continue to next pair

STEP 3: Update Reconciliation Checkpoint
├── Store last_reconciled_employee_id
└── Log reconciliation summary (total checked, drifts found, repairs, flags)
```

### 4.3 Reconciliation Schedule

```
Reconciliation: Every 30 minutes (configurable)
  CRON: */30 * * * *
  
Full cycle time: depends on employee count / batch_size
  Example: 500 employees / 50 per run = 10 runs = 5 hours for full cycle
```

---

## 5. Hold Revalidation After Balance Changes

Both batch sync and reconciliation can change `projected_available`. When this happens:

```
new_projected = updated total_balance - updated used_balance
total_held = SUM(active holds for this employee + leave_type)
new_effective = new_projected - total_held

CASE 1: new_effective >= 0
  → All holds are still valid. No action.

CASE 2: new_effective < 0
  → Active holds exceed available balance
  → We CANNOT simply release holds (that would lose the reservation)
  → Instead:
    a. Flag each affected request as RECONCILIATION_REQUIRED
    b. Log with severity WARN
    c. Keep holds ACTIVE (conservative approach)
    d. Human/admin resolution required

Why not auto-release?
  - The request may be legitimately approved and pending HCM deduction
  - Auto-releasing could cause the employee to book conflicting time off
  - Better to flag and have a human decide
```

---

## 6. Reconciliation Resolution (Manual/Admin)

When a request is flagged `RECONCILIATION_REQUIRED`, resolution paths:

### 6.1 Resolution: Confirmed (request is valid in HCM)

```
IF HCM shows the deduction exists:
  → Transition request: RECONCILIATION_REQUIRED → APPROVED
  → Ensure hold is CONVERTED
  → Update local balance to match HCM
  → Audit log: 'RECONCILIATION_RESOLVED_CONFIRMED'
```

### 6.2 Resolution: Reverted (request does not exist in HCM)

```
IF HCM shows no deduction:
  → Transition request: RECONCILIATION_REQUIRED → CANCELLED
  → Release hold
  → Update local balance to match HCM
  → Audit log: 'RECONCILIATION_RESOLVED_REVERTED'
```

---

## 7. Edge Cases

| Edge Case | Handling |
|-----------|---------|
| Batch arrives during approval transaction | SQLite serialization — batch waits for approval to commit, then processes with updated state |
| Batch updates balance below current holds | Holds preserved, requests flagged `RECONCILIATION_REQUIRED` |
| Reconciliation runs while outbox is processing | Pending deductions accounted for in drift calculation (`adjusted_used_drift`) |
| HCM returns stale data during reconciliation | `hcm_version` checked — if older than local, skip the update |
| Employee terminated in HCM, balance set to 0 | Batch sync sets balance to 0, all active holds flagged for reconciliation |
| Duplicate batch_id received | `UNIQUE` constraint on `integration_batches.batch_id` → return 409 |
| Batch contains same employee twice | Processed sequentially — second entry uses state from first |
| Pull sync finds 0 items | Checkpoint NOT advanced (nothing to confirm) |
| Reconciliation can't reach HCM | Individual pair skipped, logged, tried again next run |

---

## 8. Configuration Summary

| Parameter | Default | Env Variable |
|-----------|---------|-------------|
| Batch sync interval | 15 min | `BATCH_SYNC_INTERVAL_MIN` |
| Reconciliation interval | 30 min | `RECONCILIATION_INTERVAL_MIN` |
| Reconciliation batch size | 50 | `RECONCILIATION_BATCH_SIZE` |
| Auto-repair threshold | 8 hours | `RECONCILIATION_AUTO_REPAIR_THRESHOLD_HOURS` |
| Outbox sweep interval | 10 sec | `OUTBOX_SWEEP_INTERVAL_SEC` |

---

> **PHASE 7 COMPLETE — Awaiting approval to proceed to Phase 8: Implementation (NestJS Code)**


## phase8_implementation.md

# ReadyOn Time-Off Microservice — Phase 8 Implementation Summary

**Phase:** 8 of 11  
**Status:** ✅ COMPLETE — Build passes, server boots, all routes registered

---

## 1. Verified Output

```
✅ TypeScript compilation: 0 errors
✅ NestJS build: successful
✅ Server boot: all modules initialized
✅ Migrations: 8/8 applied
✅ Routes: 11/11 registered
✅ Health check: {"status":"healthy"}
```

## 2. Registered Routes

```
GET    /api/v1/health
GET    /api/v1/employees/me/balances
POST   /api/v1/employees/me/requests
GET    /api/v1/employees/me/requests
GET    /api/v1/employees/me/requests/:requestId
POST   /api/v1/employees/me/requests/:requestId/cancel
GET    /api/v1/managers/me/pending-approvals
POST   /api/v1/managers/me/requests/:requestId/approve
POST   /api/v1/managers/me/requests/:requestId/reject
POST   /api/v1/integrations/hcm/batch-sync
POST   /api/v1/integrations/hcm/balance-update
```

## 3. File Structure

```
readyon/src/
├── main.ts                              # Entry point with global pipes/filters
├── app.module.ts                        # Root module
├── common/
│   ├── types/index.ts                   # Enums, row types, pagination
│   ├── exceptions/index.ts              # 10 custom exception classes
│   ├── utils/index.ts                   # UUID, timestamp, backoff utilities
│   ├── utils/state-machine.ts           # State transition validation
│   ├── interceptors/correlation-id.interceptor.ts
│   └── filters/http-exception.filter.ts # Global error normalizer
├── database/
│   ├── database.module.ts               # Global DB module
│   ├── database.service.ts              # SQLite + WAL + pragmas + transactions
│   └── migrations/index.ts              # 8 sequential migrations
├── audit/
│   ├── audit.module.ts
│   └── audit.service.ts                 # Immutable audit logging
├── idempotency/
│   ├── idempotency.module.ts
│   └── idempotency.service.ts           # Key storage, hash comparison, TTL
├── balance/
│   ├── balance.module.ts
│   ├── balance.controller.ts            # GET /employees/me/balances
│   ├── balance.service.ts               # Balance queries with hold deduction
│   └── balance.repository.ts            # Projections, holds calc, HCM sync
├── hold/
│   └── hold.repository.ts              # Create, release, convert holds
├── request/
│   ├── request.module.ts
│   ├── employee-request.controller.ts   # Employee CRUD + cancel
│   ├── manager-request.controller.ts    # Manager approve/reject
│   ├── request.service.ts              # Core business logic (5 operations)
│   ├── request.repository.ts           # Queries, overlap check, status update
│   └── dto/index.ts                    # Validated DTOs
├── integration/
│   ├── integration.module.ts
│   ├── integration.controller.ts        # HCM batch-sync + balance-update
│   ├── dto/index.ts                     # Batch sync DTOs
│   ├── hcm/
│   │   ├── hcm.module.ts              # Global HCM adapter provider
│   │   ├── hcm-adapter.port.ts        # Interface (port)
│   │   ├── hcm-errors.ts             # Transient/Permanent error classes
│   │   ├── circuit-breaker.ts         # CLOSED/OPEN/HALF_OPEN
│   │   └── mock-hcm-adapter.ts       # Full mock with failure injection
│   ├── outbox/
│   │   ├── outbox.repository.ts       # Claim, retry, complete, fail
│   │   └── outbox.processor.ts        # Scheduled sweep (every 10s)
│   ├── batch/
│   │   ├── batch.repository.ts        # Batch tracking
│   │   └── batch-sync.service.ts      # Version-gated processing + pull
│   └── reconciliation/
│       └── reconciliation.service.ts   # Drift detection + auto-repair
└── health/
    └── health.controller.ts            # Health check endpoint
```

## 4. Key Implementation Details

| Feature | Implementation |
|---------|---------------|
| **Transactions** | `DatabaseService.runInTransaction()` wraps better-sqlite3's transaction API |
| **Optimistic Locking** | Every update checks `WHERE version = :expected`, throws `VersionConflictException` on 0 changes |
| **State Machine** | `assertValidTransition()` — single gate for all status changes |
| **Idempotency** | `IdempotencyService` with SHA-256 payload hashing, 24h TTL, cleanup |
| **Balance Calculation** | `effective_available = projected_available - SUM(active holds)` |
| **Outbox Pattern** | Claim → Process → Complete/Retry/Fail with exponential backoff |
| **Circuit Breaker** | In-memory, 5 failures to open, 60s cooldown |
| **Mock HCM** | Full in-memory HCM with idempotency, balance tracking, failure injection |
| **Audit Trail** | Every mutation logged with before/after snapshots and correlation ID |

---

> **PHASE 8 COMPLETE — Awaiting approval to proceed to Phase 9: Mock HCM Server**

> Note: The Mock HCM adapter is already built as part of Phase 8 (`mock-hcm-adapter.ts`). Phase 9 will expand it into a standalone mock server with additional failure scenarios.


## phase9_mock_hcm.md

# ReadyOn Time-Off Microservice — Phase 9: Mock HCM Server

**Phase:** 9 of 11  
**Status:** ✅ COMPLETE — TypeScript compilation clean

---

## 1. Two Mock Implementations

| Component | Purpose | Location |
|-----------|---------|----------|
| **MockHcmAdapter** (in-process) | Injected via DI for unit/integration tests | `src/integration/hcm/mock-hcm-adapter.ts` |
| **Mock HCM HTTP Server** (standalone) | Separate process for E2E tests | `src/mock-hcm-server/server.ts` |

---

## 2. Enhanced Mock HCM Adapter (In-Process)

### Capabilities

| Feature | Detail |
|---------|--------|
| **In-memory balances** | `setBalance()`, `setBalances()`, `getBalanceState()` |
| **Full idempotency** | Same key → same response, checked BEFORE failure injection |
| **Deduction tracking** | `getDeductions()` returns all applied deductions |
| **Call statistics** | `getStats()` returns counts per operation + failures + duplicates |
| **Per-operation call counts** | `getCallCount('postTimeOff', 'emp-001')` |
| **Full reset** | `reset()` clears all state, `clearFailures()` clears only failure rules |

### Failure Injection Modes

| Mode | Behavior | Error Class |
|------|----------|-------------|
| `none` | No failure (default) | — |
| `transient` | One-shot transient failure | `HcmTransientError` |
| `transient_persistent` | Keeps failing N times or forever | `HcmTransientError` |
| `permanent` | One-shot permanent failure (400) | `HcmPermanentError` |
| `timeout` | Simulated timeout | `HcmTransientError` |
| `insufficient_balance` | HCM says insufficient balance | `HcmPermanentError` |
| `invalid_leave_type` | HCM says invalid leave type | `HcmPermanentError` |
| `not_found` | HCM says employee/resource not found | `HcmPermanentError` |
| `rate_limited` | HCM returns 429 | `HcmTransientError` |
| `server_error` | HCM returns 500 | `HcmTransientError` |

### Advanced Failure Configuration

```typescript
// Simple: fail next postTimeOff call with transient error
mockHcm.setFailureMode('transient');

// Advanced: fail 3rd getBalance call for emp-001 with timeout
mockHcm.addFailure({
  mode: 'timeout',
  countdown: 2,          // Succeed twice, then fail
  failureCount: 1,       // Fail once, then recover
  operation: 'getBalance',
  employeeId: 'emp-001',
});

// Persistent failures (simulate extended outage)
mockHcm.addFailure({
  mode: 'transient_persistent',
  countdown: 0,
  failureCount: 5,      // Fail 5 times, then auto-recover
  operation: 'postTimeOff',
  employeeId: null,     // All employees
});
```

### Idempotency Behavior

```
Call 1: postTimeOff(key="abc", employee="emp-001", hours=8)
  → Processes deduction, returns { hcm_reference_id, status: "ACCEPTED" }

Call 2: postTimeOff(key="abc", ...)  (retry with same key)
  → Returns SAME response from call 1, NO new deduction

Call 3: postTimeOff(key="abc", ...)  (even if failure injection is active)
  → Still returns original response (idempotency checked BEFORE failures)
```

---

## 3. Standalone Mock HCM HTTP Server

Run with: `npm run start:mock-hcm` (default port: 3001)

### HCM API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/balance?employee_id=X&leave_type=Y` | Get balance |
| POST | `/api/time-off` | Post time-off deduction (idempotent) |
| POST | `/api/time-off/cancel` | Cancel time-off deduction |
| GET | `/api/batch-balances?since=TIMESTAMP` | Batch balance feed |
| GET | `/health` | Health check |

### Admin API (Test Configuration)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/balances` | Set employee balance |
| GET | `/admin/balances` | List all balances |
| POST | `/admin/failures` | Add failure injection rule |
| DELETE | `/admin/failures` | Clear all failure rules |
| POST | `/admin/delay` | Set global response delay (ms) |
| GET | `/admin/deductions` | List all deductions |
| GET | `/admin/log` | Request log (last 50) |
| GET | `/admin/stats` | Server statistics |
| POST | `/admin/reset` | Full reset (all state) |

### Example Test Setup

```bash
# Start mock HCM
npm run start:mock-hcm &

# Set up employee balance
curl -X POST http://localhost:3001/admin/balances \
  -H 'Content-Type: application/json' \
  -d '{"employee_id":"emp-001","leave_type":"PTO","total_balance":120,"used_balance":0}'

# Inject a transient failure on next postTimeOff
curl -X POST http://localhost:3001/admin/failures \
  -H 'Content-Type: application/json' \
  -d '{"mode":"transient","countdown":0,"failure_count":1,"operation":"postTimeOff"}'

# Add 500ms delay to all responses
curl -X POST http://localhost:3001/admin/delay \
  -H 'Content-Type: application/json' \
  -d '{"delay_ms":500}'

# Check server stats
curl http://localhost:3001/admin/stats
```

---

## 4. Test Scenarios Supported

| Scenario | How to Configure |
|----------|-----------------|
| **Happy path** | Set balance, no failure rules |
| **Insufficient balance in HCM** | Set balance below request amount |
| **Transient failure with retry** | `addFailure({ mode: 'transient', failureCount: 1 })` |
| **Extended outage** | `addFailure({ mode: 'transient_persistent', failureCount: -1 })` |
| **Permanent rejection** | `addFailure({ mode: 'permanent' })` |
| **Timeout** | `setDelay(35000)` (exceeds 30s timeout) |
| **Rate limiting** | `addFailure({ mode: 'rate_limited', failureCount: 3 })` |
| **Idempotent retry** | Call twice with same key, verify single deduction |
| **Stale data** | `setBalance()` with old `hcm_version` |
| **Employee not found** | Don't set balance for the employee |
| **Concurrent requests** | Set balance, fire multiple requests simultaneously |
| **Selective failure** | Target specific operation+employee |
| **Failure countdown** | `countdown: 2` → succeed twice, then fail |

---

> **PHASE 9 COMPLETE — Awaiting approval to proceed to Phase 10: Test Suite**


## phase10_test_suite.md

# ReadyOn Time-Off Microservice — Phase 10: Test Suite

**Phase:** 10 of 11  
**Status:** ✅ ALL 81 TESTS PASSING (7 suites, 2.2s)

---

## Test Results

```
PASS src/api.e2e.spec.ts                     (20 tests)
PASS src/concurrency/concurrency.spec.ts     (8 tests)
PASS src/request/request-lifecycle.spec.ts   (14 tests)
PASS src/integration/batch/batch-reconciliation.spec.ts  (8 tests)
PASS src/integration/outbox/outbox.spec.ts   (4 tests)
PASS src/common/utils/state-machine.spec.ts  (17 tests)
PASS src/common/utils/utils.spec.ts          (5 tests)

Test Suites: 7 passed, 7 total
Tests:       81 passed, 81 total
Time:        2.188s
```

---

## Test Coverage By Layer

### 1. Unit Tests (22 tests)

**State Machine** — 17 tests
- ✅ 10 valid transitions verified
- ✅ 11 invalid transitions rejected (backward, skip, self, terminal)
- ✅ Exception includes request ID, current status, attempted status
- ✅ Terminal status detection (APPROVED, REJECTED, CANCELLED)
- ✅ Hold-active status detection (PENDING, APPROVED_PENDING_HCM)

**Utilities** — 5 tests
- ✅ UUID v4 format generation
- ✅ Uniqueness (100 IDs = 100 unique)
- ✅ ISO timestamp format
- ✅ Exponential backoff increasing delays
- ✅ Max delay cap at 15 minutes

### 2. Integration Tests — Request Lifecycle (14 tests)

**Create**
- ✅ Creates request + hold atomically
- ✅ Rejects insufficient balance
- ✅ Rejects overlapping date ranges
- ✅ Rejects past dates
- ✅ Rejects end_date < start_date

**Cancel**
- ✅ Cancels and releases hold
- ✅ Restores effective balance
- ✅ Rejects wrong employee
- ✅ Rejects stale version

**Approve**
- ✅ Transitions to APPROVED_PENDING_HCM
- ✅ Creates outbox entry

**Reject**
- ✅ Rejects and releases hold
- ✅ Requires rejection reason

**Query**
- ✅ Lists with pagination
- ✅ Filters by status

### 3. Integration Tests — Outbox Processor (4 tests)

- ✅ Processes entry → APPROVED + hold CONVERTED + balance deducted
- ✅ Transient failure → retry → success on next sweep
- ✅ Permanent failure → FAILED_HCM + hold RELEASED
- ✅ Idempotent HCM responses tracked

### 4. Integration Tests — Batch Sync & Reconciliation (8 tests)

**Batch Sync**
- ✅ Creates new balance projections
- ✅ Updates with newer version
- ✅ Skips stale versions (version gate)
- ✅ Rejects duplicate batch IDs
- ✅ Handles mixed results (created + updated + skipped)

**Reconciliation**
- ✅ No drift → OK
- ✅ Small drift → auto-repair
- ✅ Large drift → flagged for review

### 5. E2E API Tests (20 tests)

**Health**
- ✅ Returns healthy + database connected

**Balances**
- ✅ Returns balances with effective_available
- ✅ Filters by leave_type
- ✅ 404 for unknown employee

**Requests CRUD**
- ✅ Creates with 201 + hold
- ✅ Idempotent duplicate returns same response
- ✅ Rejects missing Idempotency-Key
- ✅ Correlation ID passthrough
- ✅ Lists with pagination
- ✅ Gets request detail with hold info
- ✅ 404 for non-existent request

**Manager Operations**
- ✅ Approve → APPROVED_PENDING_HCM + outbox
- ✅ Reject → REJECTED + reason

**Integration Endpoints**
- ✅ Batch sync processes items
- ✅ Single balance update

### 6. Concurrency & Invariant Tests (8 tests)

- ✅ **No Overbooking**: Multiple requests consume exactly the total balance
- ✅ **Balance Restoration**: Cancel restores effective_available
- ✅ **Optimistic Lock on Cancel**: Stale version rejected
- ✅ **Optimistic Lock on Approve**: Stale version rejected
- ✅ **Hold Lifecycle: ACTIVE → CONVERTED** (full approval path)
- ✅ **Hold Lifecycle: ACTIVE → RELEASED** (cancellation path)
- ✅ **Approval Revalidation**: Balance revalidated at approval time

---

## Key Safety Invariants Verified

| Invariant | Test |
|-----------|------|
| `effective_available` never goes negative | `No Overbooking` test |
| Holds released on cancel/reject | 4 tests across lifecycle + concurrency |
| Holds converted only on HCM confirmation | `Hold Lifecycle ACTIVE → CONVERTED` |
| Stale versions always rejected | 2 optimistic lock tests |
| Duplicate idempotency keys return same response | E2E idempotency test |
| State machine enforced at all transition points | 17 state machine unit tests |
| Balance revalidated at approval time | `Approval Revalidation` test |

---

> **PHASE 10 COMPLETE — Awaiting approval to proceed to Phase 11: README & Validation Report**


## phase11_validation_report.md

# ReadyOn Time-Off Microservice — Final Validation Report

**Date:** 2026-04-24  
**Status:** ✅ ALL PHASES COMPLETE

---

## Validation Checklist

| Check | Status | Detail |
|-------|--------|--------|
| TypeScript compilation | ✅ | 0 errors |
| NestJS build | ✅ | Clean build |
| Server boot | ✅ | All modules initialized |
| Migrations | ✅ | 8/8 applied |
| Routes registered | ✅ | 11/11 |
| Health check | ✅ | `{"status":"healthy"}` |
| Test suite | ✅ | **81/81 tests, 7 suites, 2.2s** |
| README | ✅ | Comprehensive documentation |

---

## Phase Completion Summary

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 | Technical Requirements Document | ✅ |
| 2 | Data Model (8 tables, SQLite schema) | ✅ |
| 3 | API Contract (11 endpoints) | ✅ |
| 4 | State Machine (7 states, 11 transitions) | ✅ |
| 5 | Business Logic (5 atomic operations) | ✅ |
| 6 | HCM Integration (adapter port, retry, circuit breaker) | ✅ |
| 7 | Batch Sync & Reconciliation (version gate, drift detection) | ✅ |
| 8 | Implementation (30+ source files, NestJS) | ✅ |
| 9 | Mock HCM Server (in-process + standalone) | ✅ |
| 10 | Test Suite (81 tests, 7 suites) | ✅ |
| 11 | README & Validation Report | ✅ |

---

## Final Test Output

```
PASS src/api.e2e.spec.ts                             (20 tests)
PASS src/concurrency/concurrency.spec.ts             (8 tests)
PASS src/request/request-lifecycle.spec.ts           (14 tests)
PASS src/integration/batch/batch-reconciliation.spec.ts (8 tests)
PASS src/integration/outbox/outbox.spec.ts           (4 tests)
PASS src/common/utils/state-machine.spec.ts          (17 tests)
PASS src/common/utils/utils.spec.ts                  (5 tests)

Test Suites: 7 passed, 7 total
Tests:       81 passed, 81 total
Time:        2.224s
```

---

## Safety Invariants Verified

| Invariant | Verified By |
|-----------|------------|
| No overbooking | Concurrency test: 3 requests exhaust 40h exactly |
| Hold release on cancel | Lifecycle + concurrency tests |
| Hold convert on HCM confirm | Outbox processor test |
| Optimistic locking rejects stale versions | 2 concurrency tests |
| State machine enforced | 17 unit tests + integration tests |
| Idempotency deduplication | E2E test: same key → same response |
| Batch version gating | Batch sync test: stale versions skipped |
| Reconciliation auto-repair | Batch test: small drift repaired |
| Reconciliation flagging | Batch test: large drift flagged |

---

## Commands Reference

```bash
npm install          # Install dependencies
npm run start:dev    # Development mode (hot reload)
npm run build        # Production build
npm run start:prod   # Production mode
npm test             # Run all tests
npm run test:cov     # Tests with coverage
npm run start:mock-hcm  # Standalone mock HCM server
```



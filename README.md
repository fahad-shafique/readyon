# ReadyOn — Time-Off Microservice

A production-grade, transactional **Time-Off Management Microservice** built with **NestJS** and **SQLite**. Designed for organizations that treat an external HCM system as the definitive source of truth while maintaining fast local reads, overbooking prevention, and eventual consistency via an asynchronous outbox pattern.

> 📄 **[Technical Requirements Document (TRD)](./TRD.md)** — Full system design, architecture decisions, data model, API contracts, state machine, HCM integration, and test strategy.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Key Design Decisions](#key-design-decisions)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [System Invariants](#system-invariants)
- [Concurrency & Safety Model](#concurrency--safety-model)
- [HCM Integration](#hcm-integration)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Configuration](#configuration)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       REST API Layer                            │
│  Employee Controller │ Manager Controller │ Integration Controller│
└──────────┬───────────┴─────────┬──────────┴──────────┬──────────┘
           │                     │                     │
    ┌──────▼──────────────────────▼──────────────────────▼──────┐
    │                    Business Logic                         │
    │  RequestService │ BalanceService │ BatchSyncService       │
    │  ┌──────────────────────────────────────────────────┐    │
    │  │           State Machine (single gate)             │    │
    │  │  PENDING → APPROVED_PENDING_HCM → APPROVED        │    │
    │  │         ↘ REJECTED      ↘ FAILED_HCM              │    │
    │  │         ↘ CANCELLED     ↘ CANCELLED                │    │
    │  └──────────────────────────────────────────────────┘    │
    └──────────────────────┬───────────────────────────────────┘
                           │
    ┌──────────────────────▼───────────────────────────────────┐
    │                  Persistence Layer                        │
    │  SQLite (WAL mode) │ Optimistic Locking │ Transactions   │
    │  ┌────────┐ ┌──────────────┐ ┌──────────────┐           │
    │  │Balances│ │Time-Off Reqs │ │Balance Holds │           │
    │  └────────┘ └──────────────┘ └──────────────┘           │
    │  ┌────────┐ ┌──────────────┐ ┌──────────────┐           │
    │  │ Outbox │ │   Batches    │ │ Audit Logs   │           │
    │  └────┬───┘ └──────────────┘ └──────────────┘           │
    └───────┼──────────────────────────────────────────────────┘
            │
    ┌───────▼──────────────────────────────────────────────────┐
    │              Async Integration Layer                      │
    │  Outbox Processor (10s) │ Reconciliation (30m)           │
    │  ┌──────────────────────────────────────┐                │
    │  │   HCM Adapter Port (Interface)       │                │
    │  │   ├── MockHcmAdapter (development)   │                │
    │  │   └── ProductionAdapter (future)     │                │
    │  └──────────────────────────────────────┘                │
    │  Circuit Breaker │ Exponential Backoff │ Retry Logic      │
    └──────────────────────────────────────────────────────────┘
```

### Pattern: Local Projection + Holds

The core insight is a **two-layer balance model**:

1. **Projected Available** = `total_balance - used_balance` (synced from HCM)
2. **Effective Available** = `projected_available - SUM(active holds)`

When a request is created, a **hold** immediately reserves the hours. This prevents overbooking even before the HCM confirms the deduction. The hold is only converted to a permanent deduction (increasing `used_balance`) after the outbox processor receives HCM confirmation.

---

## Key Design Decisions

### 1. Why Local Projection + Holds?

**Problem:** HCM is slow (network-dependent) and the source of truth. We can't make employees wait for an HCM roundtrip just to see their balance.

**Solution:** We maintain a local projection of balances synced periodically from HCM. When an employee submits a PTO request, we immediately create a "hold" that reserves those hours locally. This gives:
- **Fast reads** — balance queries are local SQLite lookups
- **No overbooking** — holds prevent double-booking even with concurrent requests
- **Eventual consistency** — the outbox pattern ensures HCM gets updated asynchronously

### 2. Why Transactional Outbox (not direct HCM calls)?

**Problem:** If we call HCM during the approval API call and it fails, we'd need complex compensation logic.

**Solution:** The outbox pattern separates the "decision" (approve the request) from the "side effect" (tell HCM). The approval atomically writes the status change AND an outbox entry in a single SQLite transaction. A background processor then handles HCM communication with retry logic. This ensures:
- **At-least-once delivery** — outbox entries are retried until success
- **Idempotent operations** — each outbox entry carries a unique idempotency key
- **No orphaned state** — the request and outbox are always consistent

### 3. Why Optimistic Locking (not pessimistic)?

**Problem:** SQLite has limited concurrent write support. We need to detect conflicts without long-held locks.

**Solution:** Every mutable entity has a `version` column. Updates include `WHERE version = :expected` and fail with `VersionConflictException` if the version has changed. This is ideal for SQLite because:
- Writes are serialized anyway (WAL mode allows concurrent reads)
- Version checks catch races without explicit lock management
- Clients get clear feedback: "retry with the latest version"

### 4. Why a State Machine?

**Problem:** Request status transitions are complex (7 states, 11 transitions). Without a formal gate, it's easy to introduce invalid transitions.

**Solution:** `assertValidTransition()` is the **single gate** for all status changes. No code path can change a request's status without going through this function. The valid transitions are defined declaratively:

```
PENDING_APPROVAL     → APPROVED_PENDING_HCM, REJECTED, CANCELLED
APPROVED_PENDING_HCM → APPROVED, FAILED_HCM, CANCELLED
APPROVED             → RECONCILIATION_REQUIRED
REJECTED             → (terminal)
CANCELLED            → (terminal)
FAILED_HCM           → RECONCILIATION_REQUIRED
RECONCILIATION_REQ   → APPROVED, CANCELLED
```

### 5. Why Circuit Breaker?

**Problem:** If HCM is down, the outbox processor would hammer it with retries, potentially overwhelming both systems.

**Solution:** An in-memory circuit breaker tracks consecutive failures. After 5 failures, it "opens" and blocks HCM calls for 60 seconds. This protects both our outbox processor and the HCM system during outages. After cooldown, it enters "half-open" mode and allows one test request through.

---

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode
npm run start:dev

# Run tests
npm test

# Build for production
npm run build
npm run start:prod

# Run standalone mock HCM server (port 3001)
npm run start:mock-hcm
```

The server starts on **port 3000** by default. The SQLite database is created automatically at `./readyon.db` with all migrations applied.

### Verify It's Running

```bash
curl http://localhost:3000/api/v1/health
```

```json
{
  "status": "healthy",
  "checks": {
    "database": "connected",
    "outbox_depth": 0,
    "last_batch_sync": null
  },
  "uptime_seconds": 42,
  "version": "1.0.0"
}
```

---

## API Reference

All mutating endpoints require an `Idempotency-Key` header and return a `X-Correlation-Id` header.

### Employee Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/employees/me/balances` | Get employee balances |
| `POST` | `/api/v1/employees/me/requests` | Create time-off request |
| `GET` | `/api/v1/employees/me/requests` | List requests (paginated) |
| `GET` | `/api/v1/employees/me/requests/:id` | Get request details |
| `POST` | `/api/v1/employees/me/requests/:id/cancel` | Cancel request |

### Manager Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/managers/me/pending-approvals` | List pending approvals |
| `POST` | `/api/v1/managers/me/requests/:id/approve` | Approve request |
| `POST` | `/api/v1/managers/me/requests/:id/reject` | Reject request |

### Integration Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/integrations/hcm/batch-sync` | Process batch balance update |
| `POST` | `/api/v1/integrations/hcm/balance-update` | Single balance update |

### System Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/health` | Health check |

### Example: Full Request Lifecycle

```bash
# 1. Seed balance (via HCM integration)
curl -X POST http://localhost:3000/api/v1/integrations/hcm/balance-update \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: seed-001' \
  -d '{"employee_id":"emp-001","leave_type":"PTO","total_balance":120,"used_balance":0,"hcm_version":"2026-01-01T00:00:00Z"}'

# 2. Check balance
curl http://localhost:3000/api/v1/employees/me/balances \
  -H 'X-Employee-Id: emp-001'

# 3. Create request
curl -X POST http://localhost:3000/api/v1/employees/me/requests \
  -H 'Content-Type: application/json' \
  -H 'X-Employee-Id: emp-001' \
  -H 'Idempotency-Key: req-001' \
  -d '{"leave_type":"PTO","start_date":"2027-06-01","end_date":"2027-06-02","hours_requested":16,"reason":"Vacation"}'

# 4. Manager approves (use the request ID and version from step 3)
curl -X POST http://localhost:3000/api/v1/managers/me/requests/{REQUEST_ID}/approve \
  -H 'Content-Type: application/json' \
  -H 'X-Employee-Id: manager-001' \
  -H 'Idempotency-Key: approve-001' \
  -d '{"version": 1}'

# 5. Outbox processor automatically sends to HCM within 10 seconds
# Request transitions: APPROVED_PENDING_HCM → APPROVED
```

---

## System Invariants

These invariants are enforced at the database and application level and are verified by the test suite:

| # | Invariant | Enforcement |
|---|-----------|-------------|
| 1 | `effective_available = projected_available - SUM(active holds)` | Calculated at query time, never stored |
| 2 | `effective_available >= 0` at request creation | Checked in transaction before hold creation |
| 3 | Balance revalidated at approval time | `approveRequest()` recalculates (excludes own hold) |
| 4 | Holds are never auto-released on balance drops | Flagged for reconciliation instead |
| 5 | All status transitions pass through state machine | `assertValidTransition()` is the single gate |
| 6 | Optimistic lock on every mutable update | `WHERE version = :expected`, throws on 0 changes |
| 7 | Outbox entries are idempotent | Unique `idempotency_key` per outbox entry |
| 8 | Audit log is append-only | No UPDATE/DELETE on `audit_logs` table |

---

## Concurrency & Safety Model

### Write Serialization

SQLite in WAL mode allows concurrent reads but serializes writes. All write operations use `DatabaseService.runInTransaction()` which wraps better-sqlite3's transaction API, ensuring atomic multi-table mutations.

### Optimistic Locking Flow

```
Client A reads request (version=1)
Client B reads request (version=1)
Client A cancels request → UPDATE ... WHERE version=1 → Success (version→2)
Client B cancels request → UPDATE ... WHERE version=1 → 0 rows → VersionConflictException
```

### Hold-Based Overbooking Prevention

```
Employee has 40h PTO
Request A: 24h → hold created → effective_available = 16h
Request B: 16h → hold created → effective_available = 0h
Request C:  1h → REJECTED (insufficient balance)

If Request A cancelled → hold released → effective_available = 16h
Request C:  1h → hold created → effective_available = 15h ✓
```

---

## HCM Integration

### Outbox Pattern

```
API Request → [Transaction: Update Status + Insert Outbox Entry]
                                    ↓
              Outbox Processor (every 10 seconds)
                                    ↓
              [Claim Entry] → [Call HCM] → [Update Status]
                                    ↓ (failure)
              [Exponential Backoff] → [Retry] → ... → [FAILED_HCM after 5 retries]
```

### Retry Strategy

| Retry | Base Delay | Approx Wait |
|-------|-----------|-------------|
| 1 | 10s × 3⁰ | ~10s |
| 2 | 10s × 3¹ | ~30s |
| 3 | 10s × 3² | ~90s |
| 4 | 10s × 3³ | ~270s (~4.5min) |
| 5 | 10s × 3⁴ | ~810s (~13.5min) |
| Total window | | ~19 minutes |

### Reconciliation

A scheduled task (every 30 minutes) compares local balances against HCM:
- **Drift ≤ 8h**: Auto-repaired (local updated to match HCM)
- **Drift > 8h**: Flagged for manual review, affected requests marked `RECONCILIATION_REQUIRED`

### Error Classification

| Category | Examples | Handling |
|----------|----------|----------|
| **Transient** | Timeout, 500, rate limit | Retry with backoff |
| **Permanent** | 400, invalid leave type, not found | Fail immediately, release hold |

---

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:cov

# Run specific suite
npx jest --testPathPattern="state-machine"
npx jest --testPathPattern="request-lifecycle"
npx jest --testPathPattern="outbox"
npx jest --testPathPattern="batch-reconciliation"
npx jest --testPathPattern="concurrency"
npx jest --testPathPattern="api.e2e"
```

### Test Suite Summary (81 tests, 7 suites)

| Suite | Tests | What It Verifies |
|-------|-------|-----------------|
| State Machine | 17 | All valid/invalid transitions, terminal/hold-active detection |
| Utilities | 5 | UUID generation, timestamps, exponential backoff |
| Request Lifecycle | 14 | Create, cancel, approve, reject, query + all error paths |
| Outbox Processor | 4 | HCM success, transient retry, permanent failure, idempotency |
| Batch/Reconciliation | 8 | Version-gated sync, stale skip, auto-repair, drift flagging |
| E2E API | 20 | All endpoints, idempotency, correlation IDs, pagination |
| Concurrency | 8 | No overbooking, optimistic locking, hold lifecycle |

### Test Architecture

Tests use **in-memory SQLite** (`:memory:`) for complete isolation. Each test suite gets a fresh database with all migrations applied. The `MockHcmAdapter` is injected via NestJS DI, allowing per-test failure injection without mocking frameworks.

---

## Project Structure

```
readyon/
├── src/
│   ├── main.ts                              # Entry point
│   ├── app.module.ts                        # Root module
│   ├── common/
│   │   ├── types/index.ts                   # Shared enums & interfaces
│   │   ├── exceptions/index.ts              # Custom exception hierarchy
│   │   ├── utils/index.ts                   # UUID, timestamp, backoff
│   │   ├── utils/state-machine.ts           # Transition validation
│   │   ├── interceptors/                    # Correlation ID
│   │   └── filters/                         # Global exception filter
│   ├── database/
│   │   ├── database.service.ts              # SQLite + WAL + transactions
│   │   └── migrations/index.ts              # 8 sequential migrations
│   ├── audit/                               # Immutable audit logging
│   ├── idempotency/                         # Key storage with TTL
│   ├── balance/                             # Balance projections + queries
│   ├── hold/                                # Balance hold management
│   ├── request/                             # Core business logic
│   │   ├── request.service.ts               # 5 operations (create/cancel/approve/reject/list)
│   │   ├── employee-request.controller.ts   # Employee API
│   │   └── manager-request.controller.ts    # Manager API
│   ├── integration/
│   │   ├── hcm/                             # Adapter port + mock + circuit breaker
│   │   ├── outbox/                          # Transactional outbox + processor
│   │   ├── batch/                           # Batch sync + version gating
│   │   └── reconciliation/                  # Drift detection + auto-repair
│   ├── health/                              # Health check endpoint
│   ├── mock-hcm-server/                     # Standalone mock HCM HTTP server
│   └── test-utils/                          # Test helper + seed data
├── package.json
├── tsconfig.json
└── README.md
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `DB_PATH` | `./readyon.db` | SQLite database file path |
| `MOCK_HCM_PORT` | `3001` | Standalone mock HCM server port |
| `CIRCUIT_FAILURE_THRESHOLD` | `5` | Failures before circuit opens |
| `CIRCUIT_COOLDOWN_MS` | `60000` | Circuit breaker cooldown (ms) |
| `RECONCILIATION_BATCH_SIZE` | `50` | Projections per reconciliation run |
| `RECONCILIATION_AUTO_REPAIR_THRESHOLD_HOURS` | `8` | Max auto-repair drift (hours) |

---

## Database Schema

8 tables, all created via sequential migrations:

| Table | Purpose |
|-------|---------|
| `balance_projections` | Local cache of HCM balances |
| `time_off_requests` | Request lifecycle tracking |
| `balance_holds` | Overbooking prevention reservations |
| `integration_outbox` | Reliable async HCM communication |
| `integration_batches` | Batch sync tracking |
| `audit_logs` | Immutable event history |
| `idempotency_keys` | Request deduplication with TTL |
| `sync_checkpoints` | HCM sync cursor tracking |

---

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js |
| Framework | NestJS 11 |
| Database | SQLite 3 (better-sqlite3) |
| Validation | class-validator + class-transformer |
| Scheduling | @nestjs/schedule |
| Testing | Jest + Supertest |
| Language | TypeScript 5 |

---

*Built as a take-home assessment demonstrating production-grade backend engineering practices.*

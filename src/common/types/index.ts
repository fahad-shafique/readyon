// ─── Request Status (State Machine) ─────────────────────────────────

export enum RequestStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED_PENDING_HCM = 'APPROVED_PENDING_HCM',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  FAILED_HCM = 'FAILED_HCM',
  RECONCILIATION_REQUIRED = 'RECONCILIATION_REQUIRED',
}

// ─── Hold Status ────────────────────────────────────────────────────

export enum HoldStatus {
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
  CONVERTED = 'CONVERTED',
}

// ─── Outbox Status ──────────────────────────────────────────────────

export enum OutboxStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// ─── Outbox Action ──────────────────────────────────────────────────

export enum OutboxAction {
  POST_TIME_OFF = 'POST_TIME_OFF',
  CANCEL_TIME_OFF = 'CANCEL_TIME_OFF',
}

// ─── Batch Status ───────────────────────────────────────────────────

export enum BatchStatus {
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
}

// ─── Audit Types ────────────────────────────────────────────────────

export enum EntityType {
  REQUEST = 'REQUEST',
  BALANCE = 'BALANCE',
  HOLD = 'HOLD',
  OUTBOX = 'OUTBOX',
  BATCH = 'BATCH',
}

export enum ActorType {
  EMPLOYEE = 'EMPLOYEE',
  MANAGER = 'MANAGER',
  SYSTEM = 'SYSTEM',
  HCM = 'HCM',
}

// ─── Error Codes ────────────────────────────────────────────────────

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',
  NOT_FOUND = 'NOT_FOUND',
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  OVERLAPPING_REQUEST = 'OVERLAPPING_REQUEST',
  VERSION_CONFLICT = 'VERSION_CONFLICT',
  DUPLICATE_REQUEST = 'DUPLICATE_REQUEST',
  STALE_BATCH = 'STALE_BATCH',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

// ─── Error Category (HCM) ──────────────────────────────────────────

export enum HcmErrorCategory {
  TRANSIENT = 'TRANSIENT',
  PERMANENT = 'PERMANENT',
}

// ─── Row Types (DB) ─────────────────────────────────────────────────

export interface BalanceProjectionRow {
  id: string;
  employee_id: string;
  leave_type: string;
  location: string | null;
  total_balance: number;
  used_balance: number;
  projected_available: number;
  hcm_version: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TimeOffRequestRow {
  id: string;
  employee_id: string;
  manager_id: string | null;
  leave_type: string;
  location: string | null;
  start_date: string;
  end_date: string;
  hours_requested: number;
  reason: string;
  status: RequestStatus;
  rejection_reason: string | null;
  hcm_reference_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface BalanceHoldRow {
  id: string;
  request_id: string;
  employee_id: string;
  leave_type: string;
  location: string | null;
  hold_amount: number;
  status: HoldStatus;
  released_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface IntegrationOutboxRow {
  id: string;
  request_id: string;
  action: OutboxAction;
  idempotency_key: string;
  payload: string;
  status: OutboxStatus;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  last_error: string | null;
  error_category: HcmErrorCategory | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationBatchRow {
  id: string;
  batch_id: string;
  source: string;
  status: BatchStatus;
  total_items: number;
  processed_items: number;
  skipped_items: number;
  failed_items: number;
  error_summary: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  action: string;
  actor_type: ActorType;
  actor_id: string;
  before_state: string | null;
  after_state: string | null;
  metadata: string | null;
  correlation_id: string | null;
  created_at: string;
}

// ─── Pagination ─────────────────────────────────────────────────────

export interface PaginationMeta {
  next_cursor: string | null;
  has_more: boolean;
  limit: number;
}

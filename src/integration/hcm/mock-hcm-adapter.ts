import { Injectable, Logger } from '@nestjs/common';
import {
  HcmAdapterPort,
  HcmGetBalanceRequest,
  HcmGetBalanceResponse,
  HcmPostTimeOffRequest,
  HcmPostTimeOffResponse,
  HcmCancelTimeOffRequest,
  HcmCancelTimeOffResponse,
  HcmBatchBalancesRequest,
  HcmBatchBalancesResponse,
} from './hcm-adapter.port';
import { HcmPermanentError, HcmTransientError } from './hcm-errors';
import { generateId } from '../../common/utils';

// ─── Configuration Types ────────────────────────────────────────────

export interface MockBalance {
  total_balance: number;
  used_balance: number;
  hcm_version: string;
}

export interface MockDeduction {
  idempotency_key: string;
  hcm_reference_id: string;
  employee_id: string;
  leave_type: string;
  hours: number;
  start_date: string;
  end_date: string;
  timestamp: string;
}

export type FailureMode =
  | 'none'
  | 'transient'
  | 'transient_persistent' // Keeps failing transient forever
  | 'permanent'
  | 'timeout'
  | 'insufficient_balance'
  | 'invalid_leave_type'
  | 'not_found'
  | 'rate_limited'
  | 'server_error';

export interface FailureConfig {
  mode: FailureMode;
  /** Number of calls to succeed before failure triggers. 0 = fail immediately. */
  countdown: number;
  /** For transient_persistent: number of failures before auto-recovery. -1 = never recover */
  failureCount: number;
  /** Target operation filter. null = all operations */
  operation?: 'getBalance' | 'postTimeOff' | 'cancelTimeOff' | 'getBatchBalances' | null;
  /** Target employee filter. null = all employees */
  employeeId?: string | null;
}

export interface MockHcmStats {
  totalCalls: number;
  getBalanceCalls: number;
  postTimeOffCalls: number;
  cancelTimeOffCalls: number;
  getBatchBalancesCalls: number;
  failuresInjected: number;
  idempotentDuplicatesDetected: number;
}

/**
 * Enhanced Mock HCM Adapter for comprehensive testing.
 *
 * Capabilities:
 * - In-memory balance tracking with deduction/reversal
 * - Full idempotency (same key → same response)
 * - Configurable failure injection (transient, permanent, timeout, etc.)
 * - Configurable response delays
 * - Call statistics for test assertions
 * - Per-employee and per-operation failure targeting
 * - Batch balance feed with filtering
 */
@Injectable()
export class MockHcmAdapter implements HcmAdapterPort {
  private readonly logger = new Logger(MockHcmAdapter.name);

  // ─── State ──────────────────────────────────────────────────────────

  private balances = new Map<string, MockBalance>();
  private idempotencyStore = new Map<string, { response: any; timestamp: number }>();
  private deductions: MockDeduction[] = [];
  private delayMs = 0;
  private failureConfigs: FailureConfig[] = [];
  private callCounts = new Map<string, number>();
  private stats: MockHcmStats = this.createEmptyStats();

  constructor() {
    this.logger.log('Mock HCM Adapter initialized (enhanced)');
  }

  // ─── Setup Methods (for tests) ─────────────────────────────────────

  /** Set a balance for an employee+leaveType */
  setBalance(employeeId: string, leaveType: string, balance: MockBalance): void {
    this.balances.set(`${employeeId}:${leaveType}`, {
      total_balance: parseInt(balance.total_balance as any, 10),
      used_balance: parseInt(balance.used_balance as any, 10),
      hcm_version: balance.hcm_version,
    });
  }

  /** Bulk-set balances */
  setBalances(entries: Array<{ employeeId: string; leaveType: string; balance: MockBalance }>): void {
    for (const entry of entries) {
      this.setBalance(entry.employeeId, entry.leaveType, entry.balance);
    }
  }

  /** Get current balance (for test assertions) */
  getBalanceState(employeeId: string, leaveType: string): MockBalance | undefined {
    return this.balances.get(`${employeeId}:${leaveType}`);
  }

  /** Set response delay in milliseconds */
  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  /** Add a failure injection rule */
  addFailure(config: FailureConfig): void {
    this.failureConfigs.push({ ...config });
  }

  /** Convenience: set a single failure mode (replaces all existing) */
  setFailureMode(mode: FailureMode, countdown = 0): void {
    this.failureConfigs = [{ mode, countdown, failureCount: 1, operation: null, employeeId: null }];
  }

  /** Get all deductions that have been applied */
  getDeductions(): MockDeduction[] {
    return [...this.deductions];
  }

  /** Get call statistics */
  getStats(): MockHcmStats {
    return { ...this.stats };
  }

  /** Full reset */
  reset(): void {
    this.balances.clear();
    this.idempotencyStore.clear();
    this.deductions = [];
    this.delayMs = 0;
    this.failureConfigs = [];
    this.callCounts.clear();
    this.stats = this.createEmptyStats();
  }

  /** Reset only failure configs (keep balances and deductions) */
  clearFailures(): void {
    this.failureConfigs = [];
  }

  // ─── HCM Adapter Interface ─────────────────────────────────────────

  async getBalance(request: HcmGetBalanceRequest): Promise<HcmGetBalanceResponse> {
    this.stats.totalCalls++;
    this.stats.getBalanceCalls++;
    this.incrementCallCount('getBalance', request.employee_id);

    await this.applyDelay();
    this.checkFailure('getBalance', request.employee_id, request.correlation_id);

    const key = `${request.employee_id}:${request.leave_type}`;
    const balance = this.balances.get(key);

    if (!balance) {
      throw new HcmPermanentError(
        'HCM_NOT_FOUND',
        `No balance record found for employee=${request.employee_id}, type=${request.leave_type}`,
        request.correlation_id,
      );
    }

    return {
      employee_id: request.employee_id,
      leave_type: request.leave_type,
      total_balance: balance.total_balance,
      used_balance: balance.used_balance,
      hcm_version: balance.hcm_version,
    };
  }

  async postTimeOff(request: HcmPostTimeOffRequest): Promise<HcmPostTimeOffResponse> {
    this.stats.totalCalls++;
    this.stats.postTimeOffCalls++;
    this.incrementCallCount('postTimeOff', request.employee_id);

    await this.applyDelay();

    // ── Idempotency check (BEFORE failure injection) ──
    // Real HCM systems check idempotency before processing, so a retry
    // of a previously-successful call should succeed even if we're now
    // injecting failures.
    const existingResult = this.idempotencyStore.get(request.idempotency_key);
    if (existingResult) {
      this.stats.idempotentDuplicatesDetected++;
      this.logger.debug(
        `[MockHCM] Idempotent duplicate: key=${request.idempotency_key}, ` +
          `returning original response (age=${Date.now() - existingResult.timestamp}ms)`,
      );
      return existingResult.response;
    }

    // ── Failure injection (AFTER idempotency) ──
    this.checkFailure('postTimeOff', request.employee_id, request.correlation_id);

    if (request.hours !== undefined) {
      request.hours = parseInt(request.hours as any, 10);
      if (isNaN(request.hours)) {
        throw new HcmPermanentError('HCM_BAD_REQUEST', 'hours must be an integer', request.correlation_id);
      }
    }

    const balanceKey = `${request.employee_id}:${request.leave_type}`;
    let balance = this.balances.get(balanceKey);

    if (!balance) {
      this.logger.warn(`[MockHCM] Auto-provisioning balance for ${balanceKey} (testing fallback)`);
      balance = { total_balance: 1000, used_balance: 0, hcm_version: new Date().toISOString() };
      this.balances.set(balanceKey, balance);
    }

    // ── Balance check ──
    const available = balance.total_balance - balance.used_balance;
    if (available < request.hours) {
      throw new HcmPermanentError(
        'HCM_INSUFFICIENT_BALANCE',
        `Insufficient balance: available=${available}h, requested=${request.hours}h ` +
          `(total=${balance.total_balance}, used=${balance.used_balance})`,
        request.correlation_id,
      );
    }

    // ── Apply deduction ──
    balance.used_balance += request.hours;
    balance.hcm_version = new Date().toISOString();

    const hcmReferenceId = `hcm-ref-${generateId()}`;

    const response: HcmPostTimeOffResponse = {
      hcm_reference_id: hcmReferenceId,
      status: 'ACCEPTED',
      hcm_version: balance.hcm_version,
    };

    // ── Store idempotency record ──
    this.idempotencyStore.set(request.idempotency_key, {
      response: { ...response },
      timestamp: Date.now(),
    });

    // ── Track deduction ──
    this.deductions.push({
      idempotency_key: request.idempotency_key,
      hcm_reference_id: hcmReferenceId,
      employee_id: request.employee_id,
      leave_type: request.leave_type,
      hours: request.hours,
      start_date: request.start_date,
      end_date: request.end_date,
      timestamp: new Date().toISOString(),
    });

    this.logger.debug(
      `[MockHCM] Deducted ${request.hours}h from ${balanceKey}. ` +
        `Balance: ${balance.total_balance - balance.used_balance}h remaining. ` +
        `Ref: ${hcmReferenceId}`,
    );

    return response;
  }

  async cancelTimeOff(request: HcmCancelTimeOffRequest): Promise<HcmCancelTimeOffResponse> {
    this.stats.totalCalls++;
    this.stats.cancelTimeOffCalls++;
    this.incrementCallCount('cancelTimeOff', request.employee_id);

    await this.applyDelay();

    // Idempotency for cancellation
    const existingCancel = this.idempotencyStore.get(request.idempotency_key);
    if (existingCancel) {
      this.stats.idempotentDuplicatesDetected++;
      return existingCancel.response;
    }

    this.checkFailure('cancelTimeOff', request.employee_id, request.correlation_id);

    // Find and reverse the deduction
    const deductionIdx = this.deductions.findIndex((d) => d.hcm_reference_id === request.hcm_reference_id);

    if (deductionIdx === -1) {
      throw new HcmPermanentError(
        'HCM_NOT_FOUND',
        `No time-off record found with reference ${request.hcm_reference_id}`,
        request.correlation_id,
      );
    }

    const deduction = this.deductions[deductionIdx];
    const balanceKey = `${deduction.employee_id}:${deduction.leave_type}`;
    const balance = this.balances.get(balanceKey);

    if (balance) {
      balance.used_balance -= deduction.hours;
      balance.hcm_version = new Date().toISOString();
    }

    // Remove deduction
    this.deductions.splice(deductionIdx, 1);

    const response: HcmCancelTimeOffResponse = {
      status: 'CANCELLED',
      hcm_version: balance?.hcm_version || new Date().toISOString(),
    };

    // Store cancellation idempotency
    this.idempotencyStore.set(request.idempotency_key, {
      response: { ...response },
      timestamp: Date.now(),
    });

    this.logger.debug(
      `[MockHCM] Reversed deduction ${request.hcm_reference_id}: +${deduction.hours}h to ${balanceKey}`,
    );

    return response;
  }

  async getBatchBalances(request: HcmBatchBalancesRequest): Promise<HcmBatchBalancesResponse> {
    this.stats.totalCalls++;
    this.stats.getBatchBalancesCalls++;
    this.incrementCallCount('getBatchBalances', 'system');

    await this.applyDelay();
    this.checkFailure('getBatchBalances', 'system', request.correlation_id);

    const items = Array.from(this.balances.entries())
      .filter(([_, balance]) => balance.hcm_version > request.since_checkpoint)
      .map(([key, balance]) => {
        const [employee_id, leave_type] = key.split(':');
        return {
          employee_id,
          leave_type,
          total_balance: balance.total_balance,
          used_balance: balance.used_balance,
          hcm_version: balance.hcm_version,
        };
      });

    return {
      checkpoint: new Date().toISOString(),
      items,
    };
  }

  // ─── Failure Injection Engine ───────────────────────────────────────

  private checkFailure(operation: string, employeeId: string, correlationId: string): void {
    for (let i = this.failureConfigs.length - 1; i >= 0; i--) {
      const config = this.failureConfigs[i];

      // Check operation filter
      if (config.operation && config.operation !== operation) continue;

      // Check employee filter
      if (config.employeeId && config.employeeId !== employeeId) continue;

      // Check countdown
      if (config.countdown > 0) {
        config.countdown--;
        continue;
      }

      // Time to fail!
      this.stats.failuresInjected++;

      // Manage failure count
      if (config.mode !== 'transient_persistent') {
        config.failureCount--;
        if (config.failureCount <= 0) {
          this.failureConfigs.splice(i, 1); // Remove exhausted config
        }
      } else if (config.failureCount > 0) {
        config.failureCount--;
        if (config.failureCount <= 0) {
          this.failureConfigs.splice(i, 1); // Auto-recover after N failures
        }
      }
      // failureCount === -1 means never recover

      this.throwFailure(config.mode, correlationId);
    }
  }

  private throwFailure(mode: FailureMode, correlationId: string): never {
    switch (mode) {
      case 'transient':
      case 'transient_persistent':
        throw new HcmTransientError('HCM_TIMEOUT', 'Mock: Transient failure (simulated timeout)', correlationId);

      case 'timeout':
        throw new HcmTransientError('HCM_TIMEOUT', 'Mock: Request timed out', correlationId);

      case 'permanent':
        throw new HcmPermanentError('HCM_BAD_REQUEST', 'Mock: Permanent failure (bad request)', correlationId);

      case 'insufficient_balance':
        throw new HcmPermanentError(
          'HCM_INSUFFICIENT_BALANCE',
          'Mock: Insufficient balance in HCM',
          correlationId,
        );

      case 'invalid_leave_type':
        throw new HcmPermanentError(
          'HCM_INVALID_LEAVE_TYPE',
          'Mock: Invalid leave type dimension',
          correlationId,
        );

      case 'not_found':
        throw new HcmPermanentError(
          'HCM_NOT_FOUND',
          'Mock: Employee or resource not found in HCM',
          correlationId,
        );

      case 'rate_limited':
        throw new HcmTransientError(
          'HCM_RATE_LIMITED',
          'Mock: Rate limit exceeded (429)',
          correlationId,
        );

      case 'server_error':
        throw new HcmTransientError(
          'HCM_INTERNAL_ERROR',
          'Mock: Internal server error (500)',
          correlationId,
        );

      default:
        throw new HcmTransientError('HCM_UNKNOWN', `Mock: Unknown failure mode: ${mode}`, correlationId);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private async applyDelay(): Promise<void> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
  }

  private incrementCallCount(operation: string, employeeId: string): void {
    const key = `${operation}:${employeeId}`;
    this.callCounts.set(key, (this.callCounts.get(key) || 0) + 1);
  }

  /** Get call count for a specific operation+employee combination */
  getCallCount(operation: string, employeeId?: string): number {
    if (employeeId) {
      return this.callCounts.get(`${operation}:${employeeId}`) || 0;
    }
    // Sum all calls for the operation
    let total = 0;
    for (const [key, count] of this.callCounts) {
      if (key.startsWith(`${operation}:`)) total += count;
    }
    return total;
  }

  private createEmptyStats(): MockHcmStats {
    return {
      totalCalls: 0,
      getBalanceCalls: 0,
      postTimeOffCalls: 0,
      cancelTimeOffCalls: 0,
      getBatchBalancesCalls: 0,
      failuresInjected: 0,
      idempotentDuplicatesDetected: 0,
    };
  }
}

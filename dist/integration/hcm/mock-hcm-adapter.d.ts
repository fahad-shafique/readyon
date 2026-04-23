import { HcmAdapterPort, HcmGetBalanceRequest, HcmGetBalanceResponse, HcmPostTimeOffRequest, HcmPostTimeOffResponse, HcmCancelTimeOffRequest, HcmCancelTimeOffResponse, HcmBatchBalancesRequest, HcmBatchBalancesResponse } from './hcm-adapter.port';
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
export type FailureMode = 'none' | 'transient' | 'transient_persistent' | 'permanent' | 'timeout' | 'insufficient_balance' | 'invalid_leave_type' | 'not_found' | 'rate_limited' | 'server_error';
export interface FailureConfig {
    mode: FailureMode;
    countdown: number;
    failureCount: number;
    operation?: 'getBalance' | 'postTimeOff' | 'cancelTimeOff' | 'getBatchBalances' | null;
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
export declare class MockHcmAdapter implements HcmAdapterPort {
    private readonly logger;
    private balances;
    private idempotencyStore;
    private deductions;
    private delayMs;
    private failureConfigs;
    private callCounts;
    private stats;
    constructor();
    setBalance(employeeId: string, leaveType: string, balance: MockBalance): void;
    setBalances(entries: Array<{
        employeeId: string;
        leaveType: string;
        balance: MockBalance;
    }>): void;
    getBalanceState(employeeId: string, leaveType: string): MockBalance | undefined;
    setDelay(ms: number): void;
    addFailure(config: FailureConfig): void;
    setFailureMode(mode: FailureMode, countdown?: number): void;
    getDeductions(): MockDeduction[];
    getStats(): MockHcmStats;
    reset(): void;
    clearFailures(): void;
    getBalance(request: HcmGetBalanceRequest): Promise<HcmGetBalanceResponse>;
    postTimeOff(request: HcmPostTimeOffRequest): Promise<HcmPostTimeOffResponse>;
    cancelTimeOff(request: HcmCancelTimeOffRequest): Promise<HcmCancelTimeOffResponse>;
    getBatchBalances(request: HcmBatchBalancesRequest): Promise<HcmBatchBalancesResponse>;
    private checkFailure;
    private throwFailure;
    private applyDelay;
    private incrementCallCount;
    getCallCount(operation: string, employeeId?: string): number;
    private createEmptyStats;
}

"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MockHcmAdapter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockHcmAdapter = void 0;
const common_1 = require("@nestjs/common");
const hcm_errors_1 = require("./hcm-errors");
const utils_1 = require("../../common/utils");
let MockHcmAdapter = MockHcmAdapter_1 = class MockHcmAdapter {
    logger = new common_1.Logger(MockHcmAdapter_1.name);
    balances = new Map();
    idempotencyStore = new Map();
    deductions = [];
    delayMs = 0;
    failureConfigs = [];
    callCounts = new Map();
    stats = this.createEmptyStats();
    constructor() {
        this.logger.log('Mock HCM Adapter initialized (enhanced)');
    }
    setBalance(employeeId, leaveType, balance) {
        this.balances.set(`${employeeId}:${leaveType}`, { ...balance });
    }
    setBalances(entries) {
        for (const entry of entries) {
            this.setBalance(entry.employeeId, entry.leaveType, entry.balance);
        }
    }
    getBalanceState(employeeId, leaveType) {
        return this.balances.get(`${employeeId}:${leaveType}`);
    }
    setDelay(ms) {
        this.delayMs = ms;
    }
    addFailure(config) {
        this.failureConfigs.push({ ...config });
    }
    setFailureMode(mode, countdown = 0) {
        this.failureConfigs = [{ mode, countdown, failureCount: 1, operation: null, employeeId: null }];
    }
    getDeductions() {
        return [...this.deductions];
    }
    getStats() {
        return { ...this.stats };
    }
    reset() {
        this.balances.clear();
        this.idempotencyStore.clear();
        this.deductions = [];
        this.delayMs = 0;
        this.failureConfigs = [];
        this.callCounts.clear();
        this.stats = this.createEmptyStats();
    }
    clearFailures() {
        this.failureConfigs = [];
    }
    async getBalance(request) {
        this.stats.totalCalls++;
        this.stats.getBalanceCalls++;
        this.incrementCallCount('getBalance', request.employee_id);
        await this.applyDelay();
        this.checkFailure('getBalance', request.employee_id, request.correlation_id);
        const key = `${request.employee_id}:${request.leave_type}`;
        const balance = this.balances.get(key);
        if (!balance) {
            throw new hcm_errors_1.HcmPermanentError('HCM_NOT_FOUND', `No balance record found for employee=${request.employee_id}, type=${request.leave_type}`, request.correlation_id);
        }
        return {
            employee_id: request.employee_id,
            leave_type: request.leave_type,
            total_balance: balance.total_balance,
            used_balance: balance.used_balance,
            hcm_version: balance.hcm_version,
        };
    }
    async postTimeOff(request) {
        this.stats.totalCalls++;
        this.stats.postTimeOffCalls++;
        this.incrementCallCount('postTimeOff', request.employee_id);
        await this.applyDelay();
        const existingResult = this.idempotencyStore.get(request.idempotency_key);
        if (existingResult) {
            this.stats.idempotentDuplicatesDetected++;
            this.logger.debug(`[MockHCM] Idempotent duplicate: key=${request.idempotency_key}, ` +
                `returning original response (age=${Date.now() - existingResult.timestamp}ms)`);
            return existingResult.response;
        }
        this.checkFailure('postTimeOff', request.employee_id, request.correlation_id);
        const balanceKey = `${request.employee_id}:${request.leave_type}`;
        const balance = this.balances.get(balanceKey);
        if (!balance) {
            throw new hcm_errors_1.HcmPermanentError('HCM_NOT_FOUND', `Employee ${request.employee_id} has no ${request.leave_type} balance in HCM`, request.correlation_id);
        }
        const available = balance.total_balance - balance.used_balance;
        if (available < request.hours) {
            throw new hcm_errors_1.HcmPermanentError('HCM_INSUFFICIENT_BALANCE', `Insufficient balance: available=${available}h, requested=${request.hours}h ` +
                `(total=${balance.total_balance}, used=${balance.used_balance})`, request.correlation_id);
        }
        balance.used_balance += request.hours;
        balance.hcm_version = new Date().toISOString();
        const hcmReferenceId = `hcm-ref-${(0, utils_1.generateId)()}`;
        const response = {
            hcm_reference_id: hcmReferenceId,
            status: 'ACCEPTED',
            hcm_version: balance.hcm_version,
        };
        this.idempotencyStore.set(request.idempotency_key, {
            response: { ...response },
            timestamp: Date.now(),
        });
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
        this.logger.debug(`[MockHCM] Deducted ${request.hours}h from ${balanceKey}. ` +
            `Balance: ${balance.total_balance - balance.used_balance}h remaining. ` +
            `Ref: ${hcmReferenceId}`);
        return response;
    }
    async cancelTimeOff(request) {
        this.stats.totalCalls++;
        this.stats.cancelTimeOffCalls++;
        this.incrementCallCount('cancelTimeOff', request.employee_id);
        await this.applyDelay();
        const existingCancel = this.idempotencyStore.get(request.idempotency_key);
        if (existingCancel) {
            this.stats.idempotentDuplicatesDetected++;
            return existingCancel.response;
        }
        this.checkFailure('cancelTimeOff', request.employee_id, request.correlation_id);
        const deductionIdx = this.deductions.findIndex((d) => d.hcm_reference_id === request.hcm_reference_id);
        if (deductionIdx === -1) {
            throw new hcm_errors_1.HcmPermanentError('HCM_NOT_FOUND', `No time-off record found with reference ${request.hcm_reference_id}`, request.correlation_id);
        }
        const deduction = this.deductions[deductionIdx];
        const balanceKey = `${deduction.employee_id}:${deduction.leave_type}`;
        const balance = this.balances.get(balanceKey);
        if (balance) {
            balance.used_balance -= deduction.hours;
            balance.hcm_version = new Date().toISOString();
        }
        this.deductions.splice(deductionIdx, 1);
        const response = {
            status: 'CANCELLED',
            hcm_version: balance?.hcm_version || new Date().toISOString(),
        };
        this.idempotencyStore.set(request.idempotency_key, {
            response: { ...response },
            timestamp: Date.now(),
        });
        this.logger.debug(`[MockHCM] Reversed deduction ${request.hcm_reference_id}: +${deduction.hours}h to ${balanceKey}`);
        return response;
    }
    async getBatchBalances(request) {
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
    checkFailure(operation, employeeId, correlationId) {
        for (let i = this.failureConfigs.length - 1; i >= 0; i--) {
            const config = this.failureConfigs[i];
            if (config.operation && config.operation !== operation)
                continue;
            if (config.employeeId && config.employeeId !== employeeId)
                continue;
            if (config.countdown > 0) {
                config.countdown--;
                continue;
            }
            this.stats.failuresInjected++;
            if (config.mode !== 'transient_persistent') {
                config.failureCount--;
                if (config.failureCount <= 0) {
                    this.failureConfigs.splice(i, 1);
                }
            }
            else if (config.failureCount > 0) {
                config.failureCount--;
                if (config.failureCount <= 0) {
                    this.failureConfigs.splice(i, 1);
                }
            }
            this.throwFailure(config.mode, correlationId);
        }
    }
    throwFailure(mode, correlationId) {
        switch (mode) {
            case 'transient':
            case 'transient_persistent':
                throw new hcm_errors_1.HcmTransientError('HCM_TIMEOUT', 'Mock: Transient failure (simulated timeout)', correlationId);
            case 'timeout':
                throw new hcm_errors_1.HcmTransientError('HCM_TIMEOUT', 'Mock: Request timed out', correlationId);
            case 'permanent':
                throw new hcm_errors_1.HcmPermanentError('HCM_BAD_REQUEST', 'Mock: Permanent failure (bad request)', correlationId);
            case 'insufficient_balance':
                throw new hcm_errors_1.HcmPermanentError('HCM_INSUFFICIENT_BALANCE', 'Mock: Insufficient balance in HCM', correlationId);
            case 'invalid_leave_type':
                throw new hcm_errors_1.HcmPermanentError('HCM_INVALID_LEAVE_TYPE', 'Mock: Invalid leave type dimension', correlationId);
            case 'not_found':
                throw new hcm_errors_1.HcmPermanentError('HCM_NOT_FOUND', 'Mock: Employee or resource not found in HCM', correlationId);
            case 'rate_limited':
                throw new hcm_errors_1.HcmTransientError('HCM_RATE_LIMITED', 'Mock: Rate limit exceeded (429)', correlationId);
            case 'server_error':
                throw new hcm_errors_1.HcmTransientError('HCM_INTERNAL_ERROR', 'Mock: Internal server error (500)', correlationId);
            default:
                throw new hcm_errors_1.HcmTransientError('HCM_UNKNOWN', `Mock: Unknown failure mode: ${mode}`, correlationId);
        }
    }
    async applyDelay() {
        if (this.delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.delayMs));
        }
    }
    incrementCallCount(operation, employeeId) {
        const key = `${operation}:${employeeId}`;
        this.callCounts.set(key, (this.callCounts.get(key) || 0) + 1);
    }
    getCallCount(operation, employeeId) {
        if (employeeId) {
            return this.callCounts.get(`${operation}:${employeeId}`) || 0;
        }
        let total = 0;
        for (const [key, count] of this.callCounts) {
            if (key.startsWith(`${operation}:`))
                total += count;
        }
        return total;
    }
    createEmptyStats() {
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
};
exports.MockHcmAdapter = MockHcmAdapter;
exports.MockHcmAdapter = MockHcmAdapter = MockHcmAdapter_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], MockHcmAdapter);
//# sourceMappingURL=mock-hcm-adapter.js.map
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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var OutboxProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboxProcessor = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const database_service_1 = require("../../database/database.service");
const outbox_repository_1 = require("./outbox.repository");
const request_repository_1 = require("../../request/request.repository");
const balance_repository_1 = require("../../balance/balance.repository");
const hold_repository_1 = require("../../hold/hold.repository");
const audit_service_1 = require("../../audit/audit.service");
const hcm_adapter_port_1 = require("../hcm/hcm-adapter.port");
const hcm_errors_1 = require("../hcm/hcm-errors");
const types_1 = require("../../common/types");
const utils_1 = require("../../common/utils");
let OutboxProcessor = OutboxProcessor_1 = class OutboxProcessor {
    dbService;
    outboxRepo;
    requestRepo;
    balanceRepo;
    holdRepo;
    auditService;
    hcmAdapter;
    logger = new common_1.Logger(OutboxProcessor_1.name);
    processing = false;
    constructor(dbService, outboxRepo, requestRepo, balanceRepo, holdRepo, auditService, hcmAdapter) {
        this.dbService = dbService;
        this.outboxRepo = outboxRepo;
        this.requestRepo = requestRepo;
        this.balanceRepo = balanceRepo;
        this.holdRepo = holdRepo;
        this.auditService = auditService;
        this.hcmAdapter = hcmAdapter;
    }
    async processOutbox() {
        if (this.processing) {
            this.logger.debug('Outbox processor already running, skipping');
            return;
        }
        this.processing = true;
        try {
            await this.sweep();
        }
        finally {
            this.processing = false;
        }
    }
    async sweep() {
        const entries = this.dbService.runInTransaction(() => {
            return this.outboxRepo.claimPendingEntries(10);
        });
        if (entries.length === 0)
            return 0;
        this.logger.log(`Processing ${entries.length} outbox entries`);
        let processed = 0;
        for (const entry of entries) {
            try {
                const request = this.requestRepo.findById(entry.request_id);
                if (!request || request.status !== types_1.RequestStatus.APPROVED_PENDING_HCM) {
                    this.logger.warn(`Request ${entry.request_id} no longer in APPROVED_PENDING_HCM, skipping outbox ${entry.id}`);
                    this.outboxRepo.markFailed(entry.id, 'Request no longer in valid state', types_1.HcmErrorCategory.PERMANENT);
                    continue;
                }
                const payload = JSON.parse(entry.payload);
                const hcmRequest = {
                    idempotency_key: entry.idempotency_key,
                    employee_id: payload.employee_id,
                    leave_type: payload.leave_type,
                    start_date: payload.start_date,
                    end_date: payload.end_date,
                    hours: payload.hours,
                    correlation_id: (0, utils_1.generateId)(),
                };
                const hcmResponse = await this.hcmAdapter.postTimeOff(hcmRequest);
                this.dbService.runInTransaction(() => {
                    const currentRequest = this.requestRepo.findById(entry.request_id);
                    if (!currentRequest || currentRequest.status !== types_1.RequestStatus.APPROVED_PENDING_HCM) {
                        this.logger.warn(`Request ${entry.request_id} changed during HCM call, skipping`);
                        this.outboxRepo.markFailed(entry.id, 'Request state changed during HCM call', types_1.HcmErrorCategory.PERMANENT);
                        return;
                    }
                    this.requestRepo.updateStatus(entry.request_id, types_1.RequestStatus.APPROVED, currentRequest.version, {
                        hcmReferenceId: hcmResponse.hcm_reference_id,
                    });
                    this.holdRepo.convert(entry.request_id);
                    const projection = this.balanceRepo.findByEmployeeAndType(payload.employee_id, payload.leave_type);
                    if (projection) {
                        this.balanceRepo.applyDeduction(payload.employee_id, payload.leave_type, payload.hours, projection.version);
                    }
                    this.outboxRepo.markCompleted(entry.id);
                    this.auditService.logInTransaction({
                        entityType: types_1.EntityType.REQUEST,
                        entityId: entry.request_id,
                        action: 'HCM_DEDUCTION_CONFIRMED',
                        actorType: types_1.ActorType.SYSTEM,
                        actorId: 'outbox-processor',
                        afterState: { status: types_1.RequestStatus.APPROVED, hcm_reference_id: hcmResponse.hcm_reference_id },
                        metadata: { outbox_id: entry.id, hcm_version: hcmResponse.hcm_version },
                    });
                });
                processed++;
                this.logger.log(`Outbox entry ${entry.id} processed successfully (request: ${entry.request_id})`);
            }
            catch (error) {
                if (error instanceof hcm_errors_1.HcmError) {
                    if (error.category === types_1.HcmErrorCategory.TRANSIENT) {
                        const newRetryCount = entry.retry_count + 1;
                        if (newRetryCount >= entry.max_retries) {
                            this.logger.error(`Outbox ${entry.id} exhausted retries, marking as permanent failure`);
                            this.handlePermanentFailure(entry.id, entry.request_id, `Retries exhausted: ${error.message}`);
                        }
                        else {
                            this.logger.warn(`Outbox ${entry.id} transient failure (retry ${newRetryCount}/${entry.max_retries}): ${error.message}`);
                            this.outboxRepo.markForRetry(entry.id, error.message, newRetryCount);
                        }
                    }
                    else {
                        this.logger.error(`Outbox ${entry.id} permanent HCM failure: ${error.hcmErrorCode} — ${error.message}`);
                        this.handlePermanentFailure(entry.id, entry.request_id, error.message);
                    }
                }
                else {
                    this.logger.error(`Outbox ${entry.id} unexpected error: ${error.message}`);
                    const newRetryCount = entry.retry_count + 1;
                    if (newRetryCount >= entry.max_retries) {
                        this.handlePermanentFailure(entry.id, entry.request_id, error.message);
                    }
                    else {
                        this.outboxRepo.markForRetry(entry.id, error.message, newRetryCount);
                    }
                }
            }
        }
        return processed;
    }
    handlePermanentFailure(outboxId, requestId, errorMessage) {
        this.dbService.runInTransaction(() => {
            const request = this.requestRepo.findById(requestId);
            if (request && request.status === types_1.RequestStatus.APPROVED_PENDING_HCM) {
                this.requestRepo.updateStatus(requestId, types_1.RequestStatus.FAILED_HCM, request.version);
                this.holdRepo.release(requestId);
                this.auditService.logInTransaction({
                    entityType: types_1.EntityType.REQUEST,
                    entityId: requestId,
                    action: 'HCM_DEDUCTION_FAILED',
                    actorType: types_1.ActorType.SYSTEM,
                    actorId: 'outbox-processor',
                    afterState: { status: types_1.RequestStatus.FAILED_HCM },
                    metadata: { outbox_id: outboxId, error: errorMessage },
                });
            }
            this.outboxRepo.markFailed(outboxId, errorMessage, types_1.HcmErrorCategory.PERMANENT);
        });
    }
};
exports.OutboxProcessor = OutboxProcessor;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_10_SECONDS),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], OutboxProcessor.prototype, "processOutbox", null);
exports.OutboxProcessor = OutboxProcessor = OutboxProcessor_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(6, (0, common_1.Inject)(hcm_adapter_port_1.HCM_ADAPTER_PORT)),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        outbox_repository_1.OutboxRepository,
        request_repository_1.RequestRepository,
        balance_repository_1.BalanceRepository,
        hold_repository_1.HoldRepository,
        audit_service_1.AuditService, Object])
], OutboxProcessor);
//# sourceMappingURL=outbox.processor.js.map
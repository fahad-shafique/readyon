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
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationController = void 0;
const common_1 = require("@nestjs/common");
const batch_sync_service_1 = require("./batch/batch-sync.service");
const balance_repository_1 = require("../balance/balance.repository");
const audit_service_1 = require("../audit/audit.service");
const idempotency_service_1 = require("../idempotency/idempotency.service");
const database_service_1 = require("../database/database.service");
const dto_1 = require("./dto");
const exceptions_1 = require("../common/exceptions");
const types_1 = require("../common/types");
const hcm_adapter_port_1 = require("./hcm/hcm-adapter.port");
const mock_hcm_adapter_1 = require("./hcm/mock-hcm-adapter");
let IntegrationController = class IntegrationController {
    batchSyncService;
    balanceRepo;
    auditService;
    idempotencyService;
    dbService;
    hcmAdapter;
    constructor(batchSyncService, balanceRepo, auditService, idempotencyService, dbService, hcmAdapter) {
        this.batchSyncService = batchSyncService;
        this.balanceRepo = balanceRepo;
        this.auditService = auditService;
        this.idempotencyService = idempotencyService;
        this.dbService = dbService;
        this.hcmAdapter = hcmAdapter;
    }
    mockFailures(dto) {
        if (!(this.hcmAdapter instanceof mock_hcm_adapter_1.MockHcmAdapter)) {
            return { status: 'ignored', reason: 'HCM Adapter is not Mock' };
        }
        if (dto.reset) {
            if (this.hcmAdapter instanceof mock_hcm_adapter_1.MockHcmAdapter) {
                this.hcmAdapter.reset();
            }
            this.dbService.resetDatabase();
            return { status: 'reset' };
        }
        if (dto.mode) {
            this.hcmAdapter.addFailure({
                mode: dto.mode,
                countdown: dto.countdown || 0,
                failureCount: dto.failureCount || 1,
                operation: dto.operation || null,
                employeeId: dto.employeeId || null,
            });
            return { status: 'failure_added', config: dto };
        }
        return { status: 'no_action' };
    }
    batchSync(req, dto) {
        if (!dto.batch_id || !dto.items || dto.items.length === 0) {
            throw new exceptions_1.ValidationException('batch_id and non-empty items array required');
        }
        const result = this.batchSyncService.processBatch(dto.batch_id, dto.items);
        return { data: result };
    }
    singleBalanceUpdate(req, dto) {
        const idempotencyKey = req.headers['idempotency-key'];
        const correlationId = req.correlationId;
        if (!idempotencyKey) {
            throw new exceptions_1.ValidationException('Idempotency-Key header is required');
        }
        const existing = this.idempotencyService.check(idempotencyKey);
        if (existing) {
            const payloadHash = this.idempotencyService.hashPayload(dto);
            if (existing.payloadHash !== payloadHash) {
                throw new exceptions_1.DuplicateRequestException(idempotencyKey);
            }
            return existing.response;
        }
        const result = this.dbService.runInTransaction(() => {
            const loc = dto.location || 'HQ';
            const local = this.balanceRepo.findByEmployeeAndType(dto.employee_id, dto.leave_type, loc);
            if (local && dto.hcm_version <= local.hcm_version) {
                throw new exceptions_1.StaleBatchException(dto.employee_id, dto.leave_type);
            }
            const previousBalance = local?.total_balance;
            if (!local) {
                this.balanceRepo.create({
                    employeeId: dto.employee_id,
                    leaveType: dto.leave_type,
                    location: loc,
                    totalBalance: dto.total_balance,
                    usedBalance: dto.used_balance,
                    hcmVersion: dto.hcm_version,
                });
            }
            else {
                this.balanceRepo.updateFromHcm(dto.employee_id, dto.leave_type, loc, dto.total_balance, dto.used_balance, dto.hcm_version, local.version);
            }
            if (this.hcmAdapter instanceof mock_hcm_adapter_1.MockHcmAdapter) {
                this.hcmAdapter.setBalance(dto.employee_id, dto.leave_type, {
                    total_balance: dto.total_balance,
                    used_balance: dto.used_balance,
                    hcm_version: dto.hcm_version,
                });
            }
            const effectiveAvailable = this.balanceRepo.getEffectiveAvailable(dto.employee_id, dto.leave_type, loc);
            this.auditService.logInTransaction({
                entityType: types_1.EntityType.BALANCE,
                entityId: `${dto.employee_id}/${dto.leave_type}`,
                action: 'SINGLE_UPDATE',
                actorType: types_1.ActorType.HCM,
                actorId: 'hcm-single-update',
                metadata: { hcm_version: dto.hcm_version },
                correlationId,
            });
            return {
                employee_id: dto.employee_id,
                leave_type: dto.leave_type,
                result: local ? 'UPDATED' : 'CREATED',
                previous_balance: previousBalance ?? null,
                new_balance: dto.total_balance,
                effective_available: effectiveAvailable,
            };
        });
        const response = { data: result };
        this.idempotencyService.store(idempotencyKey, this.idempotencyService.hashPayload(dto), response, 200);
        return response;
    }
};
exports.IntegrationController = IntegrationController;
__decorate([
    (0, common_1.Post)('mock-failures'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], IntegrationController.prototype, "mockFailures", null);
__decorate([
    (0, common_1.Post)('batch-sync'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.BatchSyncRequestDto]),
    __metadata("design:returntype", void 0)
], IntegrationController.prototype, "batchSync", null);
__decorate([
    (0, common_1.Post)('balance-update'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.SingleBalanceUpdateDto]),
    __metadata("design:returntype", void 0)
], IntegrationController.prototype, "singleBalanceUpdate", null);
exports.IntegrationController = IntegrationController = __decorate([
    (0, common_1.Controller)('api/v1/integrations/hcm'),
    __param(5, (0, common_1.Inject)(hcm_adapter_port_1.HCM_ADAPTER_PORT)),
    __metadata("design:paramtypes", [batch_sync_service_1.BatchSyncService,
        balance_repository_1.BalanceRepository,
        audit_service_1.AuditService,
        idempotency_service_1.IdempotencyService,
        database_service_1.DatabaseService, Object])
], IntegrationController);
//# sourceMappingURL=integration.controller.js.map
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
var BatchSyncService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchSyncService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../../database/database.service");
const balance_repository_1 = require("../../balance/balance.repository");
const hold_repository_1 = require("../../hold/hold.repository");
const request_repository_1 = require("../../request/request.repository");
const batch_repository_1 = require("./batch.repository");
const audit_service_1 = require("../../audit/audit.service");
const hcm_adapter_port_1 = require("../hcm/hcm-adapter.port");
const types_1 = require("../../common/types");
const exceptions_1 = require("../../common/exceptions");
const utils_1 = require("../../common/utils");
let BatchSyncService = BatchSyncService_1 = class BatchSyncService {
    dbService;
    balanceRepo;
    holdRepo;
    requestRepo;
    batchRepo;
    auditService;
    hcmAdapter;
    logger = new common_1.Logger(BatchSyncService_1.name);
    constructor(dbService, balanceRepo, holdRepo, requestRepo, batchRepo, auditService, hcmAdapter) {
        this.dbService = dbService;
        this.balanceRepo = balanceRepo;
        this.holdRepo = holdRepo;
        this.requestRepo = requestRepo;
        this.batchRepo = batchRepo;
        this.auditService = auditService;
        this.hcmAdapter = hcmAdapter;
    }
    processBatch(batchId, items) {
        const existing = this.batchRepo.findByBatchId(batchId);
        if (existing) {
            throw new exceptions_1.DuplicateRequestException(batchId);
        }
        const batch = this.batchRepo.create(batchId, items.length);
        let processed = 0;
        let skipped = 0;
        let failed = 0;
        const errors = [];
        const results = [];
        for (const item of items) {
            try {
                const result = this.processItem(item);
                results.push({ employee_id: item.employee_id, leave_type: item.leave_type, result });
                if (result === 'UPDATED' || result === 'CREATED') {
                    processed++;
                }
                else {
                    skipped++;
                }
            }
            catch (error) {
                failed++;
                const msg = `${item.employee_id}/${item.leave_type}: ${error.message}`;
                errors.push(msg);
                results.push({ employee_id: item.employee_id, leave_type: item.leave_type, result: 'FAILED' });
                this.logger.error(`Batch item failed: ${msg}`);
            }
        }
        this.batchRepo.updateCounts(batch.id, processed, skipped, failed, errors);
        const status = failed > 0 && processed === 0 ? 'FAILED' : failed > 0 ? 'PARTIAL' : 'COMPLETED';
        return {
            batch_id: batchId,
            status,
            total_items: items.length,
            processed_items: processed,
            skipped_items: skipped,
            failed_items: failed,
            results,
        };
    }
    processItem(item) {
        return this.dbService.runInTransaction(() => {
            const local = this.balanceRepo.findByEmployeeAndType(item.employee_id, item.leave_type);
            if (!local) {
                this.balanceRepo.create({
                    employeeId: item.employee_id,
                    leaveType: item.leave_type,
                    totalBalance: item.total_balance,
                    usedBalance: item.used_balance,
                    hcmVersion: item.hcm_version,
                });
                this.auditService.logInTransaction({
                    entityType: types_1.EntityType.BALANCE,
                    entityId: `${item.employee_id}/${item.leave_type}`,
                    action: 'BATCH_CREATED',
                    actorType: types_1.ActorType.HCM,
                    actorId: 'batch-sync',
                    afterState: { ...item },
                });
                return 'CREATED';
            }
            if (item.hcm_version <= local.hcm_version) {
                this.logger.debug(`Skipping stale batch item for ${item.employee_id}/${item.leave_type}: ` +
                    `batch version ${item.hcm_version} <= local ${local.hcm_version}`);
                return 'SKIPPED_STALE';
            }
            const beforeState = { ...local };
            this.balanceRepo.updateFromHcm(item.employee_id, item.leave_type, item.total_balance, item.used_balance, item.hcm_version, local.version);
            const newProjected = item.total_balance - item.used_balance;
            const totalHeld = this.balanceRepo.getActiveHoldsTotal(item.employee_id, item.leave_type);
            const newEffective = newProjected - totalHeld;
            if (newEffective < 0) {
                this.logger.warn(`Balance update for ${item.employee_id}/${item.leave_type} causes holds to exceed available. ` +
                    `New projected: ${newProjected}, held: ${totalHeld}, effective: ${newEffective}`);
                const activeHolds = this.holdRepo.findActiveByEmployeeAndType(item.employee_id, item.leave_type);
                for (const hold of activeHolds) {
                    const request = this.requestRepo.findById(hold.request_id);
                    if (request && request.status !== types_1.RequestStatus.RECONCILIATION_REQUIRED) {
                        try {
                            this.requestRepo.updateStatus(hold.request_id, types_1.RequestStatus.RECONCILIATION_REQUIRED, request.version);
                            this.auditService.logInTransaction({
                                entityType: types_1.EntityType.REQUEST,
                                entityId: hold.request_id,
                                action: 'FLAGGED_RECONCILIATION',
                                actorType: types_1.ActorType.SYSTEM,
                                actorId: 'batch-sync',
                                metadata: { reason: 'Balance update caused hold to exceed available', new_effective: newEffective },
                            });
                        }
                        catch {
                        }
                    }
                }
            }
            this.auditService.logInTransaction({
                entityType: types_1.EntityType.BALANCE,
                entityId: `${item.employee_id}/${item.leave_type}`,
                action: 'BATCH_UPDATED',
                actorType: types_1.ActorType.HCM,
                actorId: 'batch-sync',
                beforeState,
                afterState: { ...item },
                metadata: { holds_exceeded: newEffective < 0 },
            });
            return 'UPDATED';
        });
    }
    async pullFromHcm() {
        try {
            const checkpoint = this.getCheckpoint();
            const response = await this.hcmAdapter.getBatchBalances({
                since_checkpoint: checkpoint,
                correlation_id: (0, utils_1.generateId)(),
            });
            if (response.items.length === 0) {
                this.logger.debug('No new batch items from HCM');
                return null;
            }
            const batchId = `pull-${new Date().toISOString()}`;
            const result = this.processBatch(batchId, response.items);
            if (result.processed_items > 0) {
                this.setCheckpoint(response.checkpoint);
            }
            return result;
        }
        catch (error) {
            this.logger.error(`Pull batch sync failed: ${error.message}`);
            return null;
        }
    }
    getCheckpoint() {
        const row = this.dbService
            .getDb()
            .prepare(`SELECT value FROM sync_checkpoints WHERE key = 'hcm_batch_checkpoint'`)
            .get();
        return row?.value || '1970-01-01T00:00:00Z';
    }
    setCheckpoint(value) {
        this.dbService
            .getDb()
            .prepare(`INSERT OR REPLACE INTO sync_checkpoints (key, value, updated_at) VALUES ('hcm_batch_checkpoint', ?, ?)`)
            .run(value, new Date().toISOString());
    }
};
exports.BatchSyncService = BatchSyncService;
exports.BatchSyncService = BatchSyncService = BatchSyncService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(6, (0, common_1.Inject)(hcm_adapter_port_1.HCM_ADAPTER_PORT)),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        balance_repository_1.BalanceRepository,
        hold_repository_1.HoldRepository,
        request_repository_1.RequestRepository,
        batch_repository_1.BatchRepository,
        audit_service_1.AuditService, Object])
], BatchSyncService);
//# sourceMappingURL=batch-sync.service.js.map
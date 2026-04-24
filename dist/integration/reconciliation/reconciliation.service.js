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
var ReconciliationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReconciliationService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const database_service_1 = require("../../database/database.service");
const balance_repository_1 = require("../../balance/balance.repository");
const request_repository_1 = require("../../request/request.repository");
const hold_repository_1 = require("../../hold/hold.repository");
const audit_service_1 = require("../../audit/audit.service");
const hcm_adapter_port_1 = require("../hcm/hcm-adapter.port");
const types_1 = require("../../common/types");
const utils_1 = require("../../common/utils");
let ReconciliationService = ReconciliationService_1 = class ReconciliationService {
    dbService;
    balanceRepo;
    requestRepo;
    holdRepo;
    auditService;
    hcmAdapter;
    logger = new common_1.Logger(ReconciliationService_1.name);
    lastReconciledEmployeeId = '';
    batchSize = parseInt(process.env.RECONCILIATION_BATCH_SIZE || '50', 10);
    autoRepairThreshold = parseFloat(process.env.RECONCILIATION_AUTO_REPAIR_THRESHOLD_HOURS || '8');
    constructor(dbService, balanceRepo, requestRepo, holdRepo, auditService, hcmAdapter) {
        this.dbService = dbService;
        this.balanceRepo = balanceRepo;
        this.requestRepo = requestRepo;
        this.holdRepo = holdRepo;
        this.auditService = auditService;
        this.hcmAdapter = hcmAdapter;
    }
    async runReconciliation() {
        this.logger.log('Starting reconciliation run');
        const projections = this.balanceRepo.findAllProjections(this.lastReconciledEmployeeId || undefined, this.batchSize);
        if (projections.length === 0) {
            this.lastReconciledEmployeeId = '';
            this.logger.log('Reconciliation cycle complete, wrapping around');
            return;
        }
        let checked = 0;
        let driftsFound = 0;
        let repaired = 0;
        let flagged = 0;
        for (const projection of projections) {
            try {
                const loc = projection.location || 'HQ';
                const result = await this.reconcileOne(projection.employee_id, projection.leave_type, loc);
                checked++;
                if (result === 'REPAIRED') {
                    driftsFound++;
                    repaired++;
                }
                else if (result === 'FLAGGED') {
                    driftsFound++;
                    flagged++;
                }
            }
            catch (error) {
                this.logger.error(`Reconciliation failed for ${projection.employee_id}/${projection.leave_type}: ${error.message}`);
            }
            this.lastReconciledEmployeeId = projection.employee_id;
        }
        this.logger.log(`Reconciliation run complete: checked=${checked}, drifts=${driftsFound}, repaired=${repaired}, flagged=${flagged}`);
    }
    async reconcileOne(employeeId, leaveType, location) {
        const hcmBalance = await this.hcmAdapter.getBalance({
            employee_id: employeeId,
            leave_type: leaveType,
            correlation_id: (0, utils_1.generateId)(),
        });
        const local = this.balanceRepo.findByEmployeeAndType(employeeId, leaveType, location);
        if (!local) {
            this.logger.warn(`No local projection for ${employeeId}/${leaveType} during reconciliation`);
            return 'OK';
        }
        const pendingHours = this.requestRepo.getPendingDeductionHours(employeeId, leaveType);
        const totalDrift = Math.abs(hcmBalance.total_balance - local.total_balance);
        const adjustedUsedDrift = Math.abs(hcmBalance.used_balance - (local.used_balance + pendingHours));
        const effectiveDrift = Math.max(totalDrift, adjustedUsedDrift);
        if (effectiveDrift === 0) {
            if (hcmBalance.hcm_version > local.hcm_version) {
                this.dbService.runInTransaction(() => {
                    this.balanceRepo.updateFromHcm(employeeId, leaveType, location, hcmBalance.total_balance, hcmBalance.used_balance, hcmBalance.hcm_version, local.version);
                });
            }
            return 'OK';
        }
        this.logger.warn(`Drift detected for ${employeeId}/${leaveType}: effective_drift=${effectiveDrift}h ` +
            `(total: HCM=${hcmBalance.total_balance} vs local=${local.total_balance}, ` +
            `used: HCM=${hcmBalance.used_balance} vs local=${local.used_balance}+pending=${pendingHours})`);
        if (effectiveDrift <= this.autoRepairThreshold) {
            this.dbService.runInTransaction(() => {
                const current = this.balanceRepo.findByEmployeeAndType(employeeId, leaveType, location);
                if (!current)
                    return;
                const beforeState = { ...current };
                this.balanceRepo.updateFromHcm(employeeId, leaveType, location, hcmBalance.total_balance, hcmBalance.used_balance, hcmBalance.hcm_version, current.version);
                const newProjected = hcmBalance.total_balance - hcmBalance.used_balance;
                const totalHeld = this.balanceRepo.getActiveHoldsTotal(employeeId, leaveType, location);
                if (newProjected - totalHeld < 0) {
                    this.flagActiveHoldsForReconciliation(employeeId, leaveType, location);
                }
                this.auditService.logInTransaction({
                    entityType: types_1.EntityType.BALANCE,
                    entityId: `${employeeId}/${leaveType}`,
                    action: 'RECONCILIATION_AUTO_REPAIR',
                    actorType: types_1.ActorType.SYSTEM,
                    actorId: 'reconciliation',
                    beforeState,
                    afterState: { ...hcmBalance },
                    metadata: { drift: effectiveDrift, pending_hours: pendingHours },
                });
            });
            return 'REPAIRED';
        }
        this.dbService.runInTransaction(() => {
            this.flagActiveHoldsForReconciliation(employeeId, leaveType, location);
            this.auditService.logInTransaction({
                entityType: types_1.EntityType.BALANCE,
                entityId: `${employeeId}/${leaveType}`,
                action: 'RECONCILIATION_FLAGGED',
                actorType: types_1.ActorType.SYSTEM,
                actorId: 'reconciliation',
                metadata: {
                    drift: effectiveDrift,
                    threshold: this.autoRepairThreshold,
                    hcm_values: hcmBalance,
                    local_values: { total: local.total_balance, used: local.used_balance },
                    pending_hours: pendingHours,
                },
            });
        });
        return 'FLAGGED';
    }
    flagActiveHoldsForReconciliation(employeeId, leaveType, location) {
        const activeHolds = this.holdRepo.findActiveByEmployeeAndType(employeeId, leaveType, location);
        for (const hold of activeHolds) {
            const request = this.requestRepo.findById(hold.request_id);
            if (request && request.status !== types_1.RequestStatus.RECONCILIATION_REQUIRED) {
                try {
                    this.requestRepo.updateStatus(hold.request_id, types_1.RequestStatus.RECONCILIATION_REQUIRED, request.version);
                }
                catch {
                }
            }
        }
    }
};
exports.ReconciliationService = ReconciliationService;
__decorate([
    (0, schedule_1.Cron)('*/30 * * * *'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ReconciliationService.prototype, "runReconciliation", null);
exports.ReconciliationService = ReconciliationService = ReconciliationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(5, (0, common_1.Inject)(hcm_adapter_port_1.HCM_ADAPTER_PORT)),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        balance_repository_1.BalanceRepository,
        request_repository_1.RequestRepository,
        hold_repository_1.HoldRepository,
        audit_service_1.AuditService, Object])
], ReconciliationService);
//# sourceMappingURL=reconciliation.service.js.map
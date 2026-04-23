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
var RequestService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const request_repository_1 = require("./request.repository");
const balance_repository_1 = require("../balance/balance.repository");
const hold_repository_1 = require("../hold/hold.repository");
const outbox_repository_1 = require("../integration/outbox/outbox.repository");
const audit_service_1 = require("../audit/audit.service");
const types_1 = require("../common/types");
const state_machine_1 = require("../common/utils/state-machine");
const utils_1 = require("../common/utils");
const exceptions_1 = require("../common/exceptions");
let RequestService = RequestService_1 = class RequestService {
    dbService;
    requestRepo;
    balanceRepo;
    holdRepo;
    outboxRepo;
    auditService;
    logger = new common_1.Logger(RequestService_1.name);
    constructor(dbService, requestRepo, balanceRepo, holdRepo, outboxRepo, auditService) {
        this.dbService = dbService;
        this.requestRepo = requestRepo;
        this.balanceRepo = balanceRepo;
        this.holdRepo = holdRepo;
        this.outboxRepo = outboxRepo;
        this.auditService = auditService;
    }
    createRequest(employeeId, dto, correlationId) {
        if (dto.end_date < dto.start_date) {
            throw new exceptions_1.ValidationException('end_date must be >= start_date');
        }
        const today = new Date().toISOString().split('T')[0];
        if (dto.start_date <= today) {
            throw new exceptions_1.ValidationException('start_date must be in the future');
        }
        return this.dbService.runInTransaction(() => {
            const projection = this.balanceRepo.findByEmployeeAndType(employeeId, dto.leave_type);
            if (!projection) {
                throw new exceptions_1.NotFoundException('balance_projection', `${employeeId}/${dto.leave_type}`);
            }
            if (this.requestRepo.hasOverlap(employeeId, dto.leave_type, dto.start_date, dto.end_date)) {
                throw new exceptions_1.OverlappingRequestException(employeeId, dto.start_date, dto.end_date);
            }
            const effectiveAvailable = this.balanceRepo.getEffectiveAvailable(employeeId, dto.leave_type);
            if (effectiveAvailable < dto.hours_requested) {
                throw new exceptions_1.InsufficientBalanceException(effectiveAvailable, dto.hours_requested, dto.leave_type);
            }
            const request = this.requestRepo.create({
                employeeId,
                leaveType: dto.leave_type,
                startDate: dto.start_date,
                endDate: dto.end_date,
                hoursRequested: dto.hours_requested,
                reason: dto.reason,
            });
            const hold = this.holdRepo.create({
                requestId: request.id,
                employeeId,
                leaveType: dto.leave_type,
                holdAmount: dto.hours_requested,
            });
            this.auditService.logInTransaction({
                entityType: types_1.EntityType.REQUEST,
                entityId: request.id,
                action: 'CREATED',
                actorType: types_1.ActorType.EMPLOYEE,
                actorId: employeeId,
                afterState: { ...request },
                metadata: { hold_id: hold.id, effective_available_before: effectiveAvailable },
                correlationId,
            });
            return {
                id: request.id,
                employee_id: request.employee_id,
                leave_type: request.leave_type,
                start_date: request.start_date,
                end_date: request.end_date,
                hours_requested: request.hours_requested,
                reason: request.reason,
                status: request.status,
                hold_id: hold.id,
                version: request.version,
                created_at: request.created_at,
            };
        });
    }
    getRequest(requestId, employeeId) {
        const request = this.requestRepo.findById(requestId);
        if (!request || request.employee_id !== employeeId) {
            throw new exceptions_1.NotFoundException('time_off_request', requestId);
        }
        const hold = this.holdRepo.findByRequestId(requestId);
        return {
            ...request,
            hold: hold
                ? {
                    id: hold.id,
                    hold_amount: hold.hold_amount,
                    status: hold.status,
                }
                : null,
        };
    }
    listRequests(employeeId, filters, cursor, limit = 20) {
        const clampedLimit = Math.min(Math.max(limit, 1), 100);
        const rows = this.requestRepo.findByEmployeeId(employeeId, filters, cursor, clampedLimit);
        const hasMore = rows.length > clampedLimit;
        const data = hasMore ? rows.slice(0, clampedLimit) : rows;
        return {
            data,
            pagination: {
                next_cursor: hasMore ? data[data.length - 1].id : null,
                has_more: hasMore,
                limit: clampedLimit,
            },
        };
    }
    cancelRequest(requestId, employeeId, dto, correlationId) {
        return this.dbService.runInTransaction(() => {
            const request = this.requestRepo.findById(requestId);
            if (!request || request.employee_id !== employeeId) {
                throw new exceptions_1.NotFoundException('time_off_request', requestId);
            }
            (0, state_machine_1.assertValidTransition)(request.status, types_1.RequestStatus.CANCELLED, requestId);
            if (request.version !== dto.version) {
                throw new exceptions_1.VersionConflictException('time_off_request', requestId);
            }
            const beforeState = { ...request };
            const updated = this.requestRepo.updateStatus(requestId, types_1.RequestStatus.CANCELLED, dto.version);
            this.holdRepo.release(requestId);
            if (request.status === types_1.RequestStatus.APPROVED_PENDING_HCM) {
                this.outboxRepo.cancelByRequestId(requestId);
            }
            this.auditService.logInTransaction({
                entityType: types_1.EntityType.REQUEST,
                entityId: requestId,
                action: 'CANCELLED',
                actorType: types_1.ActorType.EMPLOYEE,
                actorId: employeeId,
                beforeState,
                afterState: { ...updated },
                metadata: { cancel_reason: dto.reason, previous_status: request.status },
                correlationId,
            });
            return {
                id: updated.id,
                status: updated.status,
                hold_status: 'RELEASED',
                version: updated.version,
                updated_at: updated.updated_at,
            };
        });
    }
    approveRequest(requestId, managerId, dto, correlationId) {
        return this.dbService.runInTransaction(() => {
            const request = this.requestRepo.findById(requestId);
            if (!request) {
                throw new exceptions_1.NotFoundException('time_off_request', requestId);
            }
            if (request.manager_id && request.manager_id !== managerId) {
                throw new exceptions_1.ForbiddenException('Not the assigned manager for this request');
            }
            (0, state_machine_1.assertValidTransition)(request.status, types_1.RequestStatus.APPROVED_PENDING_HCM, requestId);
            if (request.version !== dto.version) {
                throw new exceptions_1.VersionConflictException('time_off_request', requestId);
            }
            const effectiveAvailable = this.balanceRepo.getEffectiveAvailable(request.employee_id, request.leave_type, requestId);
            if (effectiveAvailable < request.hours_requested) {
                throw new exceptions_1.InsufficientBalanceException(effectiveAvailable, request.hours_requested, request.leave_type);
            }
            const beforeState = { ...request };
            const updated = this.requestRepo.updateStatus(requestId, types_1.RequestStatus.APPROVED_PENDING_HCM, dto.version);
            const idempotencyKey = `pto-${requestId}-${(0, utils_1.generateId)()}`;
            const outboxEntry = this.outboxRepo.create({
                requestId,
                action: types_1.OutboxAction.POST_TIME_OFF,
                idempotencyKey,
                payload: JSON.stringify({
                    employee_id: request.employee_id,
                    leave_type: request.leave_type,
                    start_date: request.start_date,
                    end_date: request.end_date,
                    hours: request.hours_requested,
                }),
            });
            this.auditService.logInTransaction({
                entityType: types_1.EntityType.REQUEST,
                entityId: requestId,
                action: 'APPROVED_BY_MANAGER',
                actorType: types_1.ActorType.MANAGER,
                actorId: managerId,
                beforeState,
                afterState: { ...updated },
                metadata: {
                    outbox_id: outboxEntry.id,
                    idempotency_key: idempotencyKey,
                    effective_available: effectiveAvailable,
                },
                correlationId,
            });
            return {
                id: updated.id,
                status: updated.status,
                version: updated.version,
                outbox_id: outboxEntry.id,
                updated_at: updated.updated_at,
            };
        });
    }
    rejectRequest(requestId, managerId, dto, correlationId) {
        if (!dto.rejection_reason || dto.rejection_reason.trim().length === 0) {
            throw new exceptions_1.ValidationException('rejection_reason is required');
        }
        return this.dbService.runInTransaction(() => {
            const request = this.requestRepo.findById(requestId);
            if (!request) {
                throw new exceptions_1.NotFoundException('time_off_request', requestId);
            }
            if (request.manager_id && request.manager_id !== managerId) {
                throw new exceptions_1.ForbiddenException('Not the assigned manager for this request');
            }
            (0, state_machine_1.assertValidTransition)(request.status, types_1.RequestStatus.REJECTED, requestId);
            if (request.version !== dto.version) {
                throw new exceptions_1.VersionConflictException('time_off_request', requestId);
            }
            const beforeState = { ...request };
            const updated = this.requestRepo.updateStatus(requestId, types_1.RequestStatus.REJECTED, dto.version, {
                rejectionReason: dto.rejection_reason,
            });
            this.holdRepo.release(requestId);
            this.auditService.logInTransaction({
                entityType: types_1.EntityType.REQUEST,
                entityId: requestId,
                action: 'REJECTED_BY_MANAGER',
                actorType: types_1.ActorType.MANAGER,
                actorId: managerId,
                beforeState,
                afterState: { ...updated },
                metadata: { rejection_reason: dto.rejection_reason },
                correlationId,
            });
            return {
                id: updated.id,
                status: updated.status,
                rejection_reason: updated.rejection_reason,
                hold_status: 'RELEASED',
                version: updated.version,
                updated_at: updated.updated_at,
            };
        });
    }
    listPendingApprovals(managerId, cursor, limit = 20) {
        const clampedLimit = Math.min(Math.max(limit, 1), 100);
        const rows = this.requestRepo.findPendingByManager(managerId, cursor, clampedLimit);
        const hasMore = rows.length > clampedLimit;
        const data = hasMore ? rows.slice(0, clampedLimit) : rows;
        return {
            data,
            pagination: {
                next_cursor: hasMore ? data[data.length - 1].id : null,
                has_more: hasMore,
                limit: clampedLimit,
            },
        };
    }
};
exports.RequestService = RequestService;
exports.RequestService = RequestService = RequestService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        request_repository_1.RequestRepository,
        balance_repository_1.BalanceRepository,
        hold_repository_1.HoldRepository,
        outbox_repository_1.OutboxRepository,
        audit_service_1.AuditService])
], RequestService);
//# sourceMappingURL=request.service.js.map
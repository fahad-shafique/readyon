import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RequestRepository } from './request.repository';
import { BalanceRepository } from '../balance/balance.repository';
import { HoldRepository } from '../hold/hold.repository';
import { OutboxRepository } from '../integration/outbox/outbox.repository';
import { AuditService } from '../audit/audit.service';
import { RequestStatus, EntityType, ActorType, OutboxAction } from '../common/types';
import { assertValidTransition } from '../common/utils/state-machine';
import { generateId } from '../common/utils';
import {
  NotFoundException,
  InsufficientBalanceException,
  OverlappingRequestException,
  ForbiddenException,
  ValidationException,
  VersionConflictException,
} from '../common/exceptions';
import { CreateTimeOffRequestDto, CancelRequestDto, ApproveRequestDto, RejectRequestDto } from './dto';

@Injectable()
export class RequestService {
  private readonly logger = new Logger(RequestService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly requestRepo: RequestRepository,
    private readonly balanceRepo: BalanceRepository,
    private readonly holdRepo: HoldRepository,
    private readonly outboxRepo: OutboxRepository,
    private readonly auditService: AuditService,
  ) {}

  // ─── CREATE REQUEST ─────────────────────────────────────────────────

  createRequest(employeeId: string, dto: CreateTimeOffRequestDto, correlationId?: string) {
    // Pre-transaction validation
    if (dto.end_date < dto.start_date) {
      throw new ValidationException('end_date must be >= start_date');
    }
    const today = new Date().toISOString().split('T')[0];
    if (dto.start_date <= today) {
      throw new ValidationException('start_date must be in the future');
    }

    return this.dbService.runInTransaction(() => {
      const loc = dto.location || 'HQ';

      // Check balance projection exists
      const projection = this.balanceRepo.findByEmployeeAndType(employeeId, dto.leave_type, loc);
      if (!projection) {
        throw new NotFoundException('balance_projection', `${employeeId}/${dto.leave_type}/${loc}`);
      }

      // Check overlapping requests
      if (this.requestRepo.hasOverlap(employeeId, dto.leave_type, dto.start_date, dto.end_date)) {
        throw new OverlappingRequestException(employeeId, dto.start_date, dto.end_date);
      }

      // Calculate effective available
      const effectiveAvailable = this.balanceRepo.getEffectiveAvailable(employeeId, dto.leave_type, loc);
      if (effectiveAvailable < dto.hours_requested) {
        throw new InsufficientBalanceException(effectiveAvailable, dto.hours_requested, dto.leave_type);
      }

      // Insert request
      const request = this.requestRepo.create({
        employeeId,
        leaveType: dto.leave_type,
        location: loc,
        startDate: dto.start_date,
        endDate: dto.end_date,
        hoursRequested: dto.hours_requested,
        reason: dto.reason,
      });

      // Insert hold
      const hold = this.holdRepo.create({
        requestId: request.id,
        employeeId,
        leaveType: dto.leave_type,
        location: loc,
        holdAmount: dto.hours_requested,
      });

      // Audit log
      this.auditService.logInTransaction({
        entityType: EntityType.REQUEST,
        entityId: request.id,
        action: 'CREATED',
        actorType: ActorType.EMPLOYEE,
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

  // ─── GET REQUESTS ───────────────────────────────────────────────────

  getRequest(requestId: string, employeeId: string) {
    const request = this.requestRepo.findById(requestId);
    if (!request || request.employee_id !== employeeId) {
      throw new NotFoundException('time_off_request', requestId);
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

  listRequests(
    employeeId: string,
    filters?: { status?: string; leaveType?: string; startDateFrom?: string; startDateTo?: string },
    cursor?: string,
    limit = 20,
  ) {
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

  // ─── CANCEL REQUEST ─────────────────────────────────────────────────

  cancelRequest(requestId: string, employeeId: string, dto: CancelRequestDto, correlationId?: string) {
    return this.dbService.runInTransaction(() => {
      const request = this.requestRepo.findById(requestId);
      if (!request || request.employee_id !== employeeId) {
        throw new NotFoundException('time_off_request', requestId);
      }

      // State machine validation
      assertValidTransition(request.status, RequestStatus.CANCELLED, requestId);

      // Optimistic lock
      if (request.version !== dto.version) {
        throw new VersionConflictException('time_off_request', requestId);
      }

      const beforeState = { ...request };

      // Update request
      const updated = this.requestRepo.updateStatus(requestId, RequestStatus.CANCELLED, dto.version);

      // Release hold
      this.holdRepo.release(requestId);

      // Cancel outbox entry if exists (for APPROVED_PENDING_HCM)
      if (request.status === RequestStatus.APPROVED_PENDING_HCM) {
        this.outboxRepo.cancelByRequestId(requestId);
      }

      // Compensating transaction if already synced
      if (request.status === RequestStatus.APPROVED) {
        const idempotencyKey = `cancel-${requestId}-${generateId()}`;
        this.outboxRepo.create({
          requestId,
          action: OutboxAction.CANCEL_TIME_OFF,
          idempotencyKey,
          payload: JSON.stringify({
            employee_id: request.employee_id,
            leave_type: request.leave_type,
            hcm_reference_id: request.hcm_reference_id
          })
        });
      }

      // Audit
      this.auditService.logInTransaction({
        entityType: EntityType.REQUEST,
        entityId: requestId,
        action: 'CANCELLED',
        actorType: ActorType.EMPLOYEE,
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

  // ─── APPROVE REQUEST ────────────────────────────────────────────────

  approveRequest(requestId: string, managerId: string, dto: ApproveRequestDto, correlationId?: string) {
    return this.dbService.runInTransaction(() => {
      const request = this.requestRepo.findById(requestId);
      if (!request) {
        throw new NotFoundException('time_off_request', requestId);
      }

      // Auth check
      if (request.manager_id && request.manager_id !== managerId) {
        throw new ForbiddenException('Not the assigned manager for this request');
      }

      // State machine
      assertValidTransition(request.status, RequestStatus.APPROVED_PENDING_HCM, requestId);

      // Optimistic lock
      if (request.version !== dto.version) {
        throw new VersionConflictException('time_off_request', requestId);
      }

      // CRITICAL: Revalidate balance (exclude this request's hold)
      const loc = request.location || 'HQ';
      const effectiveAvailable = this.balanceRepo.getEffectiveAvailable(
        request.employee_id,
        request.leave_type,
        loc,
        requestId,
      );
      if (effectiveAvailable < request.hours_requested) {
        throw new InsufficientBalanceException(effectiveAvailable, request.hours_requested, request.leave_type);
      }

      const beforeState = { ...request };

      // Update status
      const updated = this.requestRepo.updateStatus(requestId, RequestStatus.APPROVED_PENDING_HCM, dto.version);

      // Create outbox entry
      const idempotencyKey = `pto-${requestId}-${generateId()}`;
      const outboxEntry = this.outboxRepo.create({
        requestId,
        action: OutboxAction.POST_TIME_OFF,
        idempotencyKey,
        payload: JSON.stringify({
          employee_id: request.employee_id,
          leave_type: request.leave_type,
          start_date: request.start_date,
          end_date: request.end_date,
          hours: request.hours_requested,
        }),
      });

      // Audit
      this.auditService.logInTransaction({
        entityType: EntityType.REQUEST,
        entityId: requestId,
        action: 'APPROVED_BY_MANAGER',
        actorType: ActorType.MANAGER,
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

  // ─── REJECT REQUEST ─────────────────────────────────────────────────

  rejectRequest(requestId: string, managerId: string, dto: RejectRequestDto, correlationId?: string) {
    if (!dto.rejection_reason || dto.rejection_reason.trim().length === 0) {
      throw new ValidationException('rejection_reason is required');
    }

    return this.dbService.runInTransaction(() => {
      const request = this.requestRepo.findById(requestId);
      if (!request) {
        throw new NotFoundException('time_off_request', requestId);
      }

      // Auth check
      if (request.manager_id && request.manager_id !== managerId) {
        throw new ForbiddenException('Not the assigned manager for this request');
      }

      // State machine
      assertValidTransition(request.status, RequestStatus.REJECTED, requestId);

      // Optimistic lock
      if (request.version !== dto.version) {
        throw new VersionConflictException('time_off_request', requestId);
      }

      const beforeState = { ...request };

      // Update status
      const updated = this.requestRepo.updateStatus(requestId, RequestStatus.REJECTED, dto.version, {
        rejectionReason: dto.rejection_reason,
      });

      // Release hold
      this.holdRepo.release(requestId);

      // Audit
      this.auditService.logInTransaction({
        entityType: EntityType.REQUEST,
        entityId: requestId,
        action: 'REJECTED_BY_MANAGER',
        actorType: ActorType.MANAGER,
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

  // ─── MANAGER: LIST PENDING ──────────────────────────────────────────

  listPendingApprovals(managerId: string, cursor?: string, limit = 20) {
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
}

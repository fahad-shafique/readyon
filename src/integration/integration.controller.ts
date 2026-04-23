import { Controller, Post, Body, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { BatchSyncService } from './batch/batch-sync.service';
import { BalanceRepository } from '../balance/balance.repository';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { DatabaseService } from '../database/database.service';
import { BatchSyncRequestDto, SingleBalanceUpdateDto } from './dto';
import { ValidationException, DuplicateRequestException, StaleBatchException } from '../common/exceptions';
import { EntityType, ActorType } from '../common/types';

@Controller('api/v1/integrations/hcm')
export class IntegrationController {
  constructor(
    private readonly batchSyncService: BatchSyncService,
    private readonly balanceRepo: BalanceRepository,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
    private readonly dbService: DatabaseService,
  ) {}

  @Post('batch-sync')
  @HttpCode(HttpStatus.OK)
  batchSync(@Req() req: any, @Body() dto: BatchSyncRequestDto) {
    if (!dto.batch_id || !dto.items || dto.items.length === 0) {
      throw new ValidationException('batch_id and non-empty items array required');
    }

    const result = this.batchSyncService.processBatch(dto.batch_id, dto.items);
    return { data: result };
  }

  @Post('balance-update')
  @HttpCode(HttpStatus.OK)
  singleBalanceUpdate(@Req() req: any, @Body() dto: SingleBalanceUpdateDto) {
    const idempotencyKey = req.headers['idempotency-key'];
    const correlationId = req.correlationId;

    if (!idempotencyKey) {
      throw new ValidationException('Idempotency-Key header is required');
    }

    // Idempotency check
    const existing = this.idempotencyService.check(idempotencyKey);
    if (existing) {
      const payloadHash = this.idempotencyService.hashPayload(dto);
      if (existing.payloadHash !== payloadHash) {
        throw new DuplicateRequestException(idempotencyKey);
      }
      return existing.response;
    }

    const result = this.dbService.runInTransaction(() => {
      const local = this.balanceRepo.findByEmployeeAndType(dto.employee_id, dto.leave_type);

      if (local && dto.hcm_version <= local.hcm_version) {
        throw new StaleBatchException(dto.employee_id, dto.leave_type);
      }

      const previousBalance = local?.total_balance;

      if (!local) {
        this.balanceRepo.create({
          employeeId: dto.employee_id,
          leaveType: dto.leave_type,
          totalBalance: dto.total_balance,
          usedBalance: dto.used_balance,
          hcmVersion: dto.hcm_version,
        });
      } else {
        this.balanceRepo.updateFromHcm(
          dto.employee_id,
          dto.leave_type,
          dto.total_balance,
          dto.used_balance,
          dto.hcm_version,
          local.version,
        );
      }

      const effectiveAvailable = this.balanceRepo.getEffectiveAvailable(dto.employee_id, dto.leave_type);

      this.auditService.logInTransaction({
        entityType: EntityType.BALANCE,
        entityId: `${dto.employee_id}/${dto.leave_type}`,
        action: 'SINGLE_UPDATE',
        actorType: ActorType.HCM,
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
}

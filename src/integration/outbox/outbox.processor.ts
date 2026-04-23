import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.service';
import { OutboxRepository } from './outbox.repository';
import { RequestRepository } from '../../request/request.repository';
import { BalanceRepository } from '../../balance/balance.repository';
import { HoldRepository } from '../../hold/hold.repository';
import { AuditService } from '../../audit/audit.service';
import { HCM_ADAPTER_PORT } from '../hcm/hcm-adapter.port';
import type { HcmAdapterPort, HcmPostTimeOffRequest } from '../hcm/hcm-adapter.port';
import { HcmError } from '../hcm/hcm-errors';
import { RequestStatus, EntityType, ActorType, HcmErrorCategory } from '../../common/types';
import { generateId } from '../../common/utils';

@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  private processing = false;

  constructor(
    private readonly dbService: DatabaseService,
    private readonly outboxRepo: OutboxRepository,
    private readonly requestRepo: RequestRepository,
    private readonly balanceRepo: BalanceRepository,
    private readonly holdRepo: HoldRepository,
    private readonly auditService: AuditService,
    @Inject(HCM_ADAPTER_PORT) private readonly hcmAdapter: HcmAdapterPort,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async processOutbox(): Promise<void> {
    if (this.processing) {
      this.logger.debug('Outbox processor already running, skipping');
      return;
    }

    this.processing = true;
    try {
      await this.sweep();
    } finally {
      this.processing = false;
    }
  }

  async sweep(): Promise<number> {
    // Claim entries inside a transaction
    const entries = this.dbService.runInTransaction(() => {
      return this.outboxRepo.claimPendingEntries(10);
    });

    if (entries.length === 0) return 0;

    this.logger.log(`Processing ${entries.length} outbox entries`);
    let processed = 0;

    for (const entry of entries) {
      try {
        // Verify request still valid
        const request = this.requestRepo.findById(entry.request_id);
        if (!request || request.status !== RequestStatus.APPROVED_PENDING_HCM) {
          this.logger.warn(`Request ${entry.request_id} no longer in APPROVED_PENDING_HCM, skipping outbox ${entry.id}`);
          this.outboxRepo.markFailed(entry.id, 'Request no longer in valid state', HcmErrorCategory.PERMANENT);
          continue;
        }

        // Parse payload and call HCM
        const payload = JSON.parse(entry.payload);
        const hcmRequest: HcmPostTimeOffRequest = {
          idempotency_key: entry.idempotency_key,
          employee_id: payload.employee_id,
          leave_type: payload.leave_type,
          start_date: payload.start_date,
          end_date: payload.end_date,
          hours: payload.hours,
          correlation_id: generateId(),
        };

        const hcmResponse = await this.hcmAdapter.postTimeOff(hcmRequest);

        // SUCCESS — apply within transaction
        this.dbService.runInTransaction(() => {
          // Re-read request to ensure it's still valid
          const currentRequest = this.requestRepo.findById(entry.request_id);
          if (!currentRequest || currentRequest.status !== RequestStatus.APPROVED_PENDING_HCM) {
            this.logger.warn(`Request ${entry.request_id} changed during HCM call, skipping`);
            this.outboxRepo.markFailed(entry.id, 'Request state changed during HCM call', HcmErrorCategory.PERMANENT);
            return;
          }

          // Update request to APPROVED
          this.requestRepo.updateStatus(entry.request_id, RequestStatus.APPROVED, currentRequest.version, {
            hcmReferenceId: hcmResponse.hcm_reference_id,
          });

          // Convert hold to permanent deduction
          this.holdRepo.convert(entry.request_id);

          // Update balance projection
          const projection = this.balanceRepo.findByEmployeeAndType(payload.employee_id, payload.leave_type);
          if (projection) {
            this.balanceRepo.applyDeduction(payload.employee_id, payload.leave_type, payload.hours, projection.version);
          }

          // Mark outbox completed
          this.outboxRepo.markCompleted(entry.id);

          // Audit
          this.auditService.logInTransaction({
            entityType: EntityType.REQUEST,
            entityId: entry.request_id,
            action: 'HCM_DEDUCTION_CONFIRMED',
            actorType: ActorType.SYSTEM,
            actorId: 'outbox-processor',
            afterState: { status: RequestStatus.APPROVED, hcm_reference_id: hcmResponse.hcm_reference_id },
            metadata: { outbox_id: entry.id, hcm_version: hcmResponse.hcm_version },
          });
        });

        processed++;
        this.logger.log(`Outbox entry ${entry.id} processed successfully (request: ${entry.request_id})`);
      } catch (error) {
        if (error instanceof HcmError) {
          if (error.category === HcmErrorCategory.TRANSIENT) {
            const newRetryCount = entry.retry_count + 1;
            if (newRetryCount >= entry.max_retries) {
              this.logger.error(`Outbox ${entry.id} exhausted retries, marking as permanent failure`);
              this.handlePermanentFailure(entry.id, entry.request_id, `Retries exhausted: ${error.message}`);
            } else {
              this.logger.warn(`Outbox ${entry.id} transient failure (retry ${newRetryCount}/${entry.max_retries}): ${error.message}`);
              this.outboxRepo.markForRetry(entry.id, error.message, newRetryCount);
            }
          } else {
            this.logger.error(`Outbox ${entry.id} permanent HCM failure: ${error.hcmErrorCode} — ${error.message}`);
            this.handlePermanentFailure(entry.id, entry.request_id, error.message);
          }
        } else {
          this.logger.error(`Outbox ${entry.id} unexpected error: ${(error as Error).message}`);
          const newRetryCount = entry.retry_count + 1;
          if (newRetryCount >= entry.max_retries) {
            this.handlePermanentFailure(entry.id, entry.request_id, (error as Error).message);
          } else {
            this.outboxRepo.markForRetry(entry.id, (error as Error).message, newRetryCount);
          }
        }
      }
    }

    return processed;
  }

  private handlePermanentFailure(outboxId: string, requestId: string, errorMessage: string): void {
    this.dbService.runInTransaction(() => {
      const request = this.requestRepo.findById(requestId);
      if (request && request.status === RequestStatus.APPROVED_PENDING_HCM) {
        this.requestRepo.updateStatus(requestId, RequestStatus.FAILED_HCM, request.version);
        this.holdRepo.release(requestId);

        this.auditService.logInTransaction({
          entityType: EntityType.REQUEST,
          entityId: requestId,
          action: 'HCM_DEDUCTION_FAILED',
          actorType: ActorType.SYSTEM,
          actorId: 'outbox-processor',
          afterState: { status: RequestStatus.FAILED_HCM },
          metadata: { outbox_id: outboxId, error: errorMessage },
        });
      }

      this.outboxRepo.markFailed(outboxId, errorMessage, HcmErrorCategory.PERMANENT);
    });
  }
}

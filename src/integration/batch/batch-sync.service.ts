import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.service';
import { BalanceRepository } from '../../balance/balance.repository';
import { HoldRepository } from '../../hold/hold.repository';
import { RequestRepository } from '../../request/request.repository';
import { BatchRepository } from './batch.repository';
import { AuditService } from '../../audit/audit.service';
import { HCM_ADAPTER_PORT } from '../hcm/hcm-adapter.port';
import type { HcmAdapterPort } from '../hcm/hcm-adapter.port';
import { EntityType, ActorType, RequestStatus } from '../../common/types';
import { DuplicateRequestException } from '../../common/exceptions';
import { generateId } from '../../common/utils';

export interface BatchSyncItem {
  employee_id: string;
  leave_type: string;
  location?: string;
  total_balance: number;
  used_balance: number;
  hcm_version: string;
}

export interface BatchSyncResult {
  batch_id: string;
  status: string;
  total_items: number;
  processed_items: number;
  skipped_items: number;
  failed_items: number;
  results: Array<{ employee_id: string; leave_type: string; result: string }>;
}

@Injectable()
export class BatchSyncService {
  private readonly logger = new Logger(BatchSyncService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly balanceRepo: BalanceRepository,
    private readonly holdRepo: HoldRepository,
    private readonly requestRepo: RequestRepository,
    private readonly batchRepo: BatchRepository,
    private readonly auditService: AuditService,
    @Inject(HCM_ADAPTER_PORT) private readonly hcmAdapter: HcmAdapterPort,
  ) {}

  /**
   * Process an inbound batch of balance updates.
   */
  processBatch(batchId: string, items: BatchSyncItem[]): BatchSyncResult {
    // Check for duplicate batch
    const existing = this.batchRepo.findByBatchId(batchId);
    if (existing) {
      throw new DuplicateRequestException(batchId);
    }

    // Create batch record
    const batch = this.batchRepo.create(batchId, items.length);

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    const results: Array<{ employee_id: string; leave_type: string; result: string }> = [];

    for (const item of items) {
      try {
        const result = this.processItem(item);
        results.push({ employee_id: item.employee_id, leave_type: item.leave_type, result });

        if (result === 'UPDATED' || result === 'CREATED') {
          processed++;
        } else {
          skipped++;
        }
      } catch (error) {
        failed++;
        const msg = `${item.employee_id}/${item.leave_type}: ${(error as Error).message}`;
        errors.push(msg);
        results.push({ employee_id: item.employee_id, leave_type: item.leave_type, result: 'FAILED' });
        this.logger.error(`Batch item failed: ${msg}`);
      }
    }

    // Update batch record
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

  private processItem(item: BatchSyncItem): string {
    return this.dbService.runInTransaction(() => {
      const loc = item.location || 'HQ';
      const local = this.balanceRepo.findByEmployeeAndType(item.employee_id, item.leave_type, loc);

      // New employee/type — create
      if (!local) {
        this.balanceRepo.create({
          employeeId: item.employee_id,
          leaveType: item.leave_type,
          location: loc,
          totalBalance: item.total_balance,
          usedBalance: item.used_balance,
          hcmVersion: item.hcm_version,
        });

        this.auditService.logInTransaction({
          entityType: EntityType.BALANCE,
          entityId: `${item.employee_id}/${item.leave_type}`,
          action: 'BATCH_CREATED',
          actorType: ActorType.HCM,
          actorId: 'batch-sync',
          afterState: { ...item },
        });

        return 'CREATED';
      }

      // Version gate — reject stale
      if (item.hcm_version <= local.hcm_version) {
        this.logger.debug(
          `Skipping stale batch item for ${item.employee_id}/${item.leave_type}: ` +
            `batch version ${item.hcm_version} <= local ${local.hcm_version}`,
        );
        return 'SKIPPED_STALE';
      }

      const beforeState = { ...local };

      // Apply update
      this.balanceRepo.updateFromHcm(
        item.employee_id,
        item.leave_type,
        loc,
        item.total_balance,
        item.used_balance,
        item.hcm_version,
        local.version,
      );

      // Revalidate active holds
      const newProjected = item.total_balance - item.used_balance;
      const totalHeld = this.balanceRepo.getActiveHoldsTotal(item.employee_id, item.leave_type, loc);
      const newEffective = newProjected - totalHeld;

      if (newEffective < 0) {
        this.logger.warn(
          `Balance update for ${item.employee_id}/${item.leave_type} causes holds to exceed available. ` +
            `New projected: ${newProjected}, held: ${totalHeld}, effective: ${newEffective}`,
        );

        // Flag affected requests
        const activeHolds = this.holdRepo.findActiveByEmployeeAndType(item.employee_id, item.leave_type, loc);
        for (const hold of activeHolds) {
          const request = this.requestRepo.findById(hold.request_id);
          if (request && request.status !== RequestStatus.RECONCILIATION_REQUIRED) {
            try {
              this.requestRepo.updateStatus(hold.request_id, RequestStatus.RECONCILIATION_REQUIRED, request.version);
              this.auditService.logInTransaction({
                entityType: EntityType.REQUEST,
                entityId: hold.request_id,
                action: 'FLAGGED_RECONCILIATION',
                actorType: ActorType.SYSTEM,
                actorId: 'batch-sync',
                metadata: { reason: 'Balance update caused hold to exceed available', new_effective: newEffective },
              });
            } catch {
              // Version conflict — another process may have already handled this
            }
          }
        }
      }

      this.auditService.logInTransaction({
        entityType: EntityType.BALANCE,
        entityId: `${item.employee_id}/${item.leave_type}`,
        action: 'BATCH_UPDATED',
        actorType: ActorType.HCM,
        actorId: 'batch-sync',
        beforeState,
        afterState: { ...item },
        metadata: { holds_exceeded: newEffective < 0 },
      });

      return 'UPDATED';
    });
  }

  /**
   * Pull-based batch sync (scheduled).
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async pullFromHcm(): Promise<BatchSyncResult | null> {
    try {
      const checkpoint = this.getCheckpoint();
      const response = await this.hcmAdapter.getBatchBalances({
        since_checkpoint: checkpoint,
        correlation_id: generateId(),
      });

      if (response.items.length === 0) {
        this.logger.debug('No new batch items from HCM');
        return null;
      }

      const batchId = `pull-${new Date().toISOString()}`;
      const result = this.processBatch(batchId, response.items);

      // Update checkpoint only if items were processed
      if (result.processed_items > 0) {
        this.setCheckpoint(response.checkpoint);
      }

      return result;
    } catch (error) {
      this.logger.error(`Pull batch sync failed: ${(error as Error).message}`);
      return null;
    }
  }

  private getCheckpoint(): string {
    const row = this.dbService
      .getDb()
      .prepare(`SELECT value FROM sync_checkpoints WHERE key = 'hcm_batch_checkpoint'`)
      .get() as any;
    return row?.value || '1970-01-01T00:00:00Z';
  }

  private setCheckpoint(value: string): void {
    this.dbService
      .getDb()
      .prepare(
        `INSERT OR REPLACE INTO sync_checkpoints (key, value, updated_at) VALUES ('hcm_batch_checkpoint', ?, ?)`,
      )
      .run(value, new Date().toISOString());
  }
}

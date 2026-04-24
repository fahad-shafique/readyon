import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.service';
import { BalanceRepository } from '../../balance/balance.repository';
import { RequestRepository } from '../../request/request.repository';
import { HoldRepository } from '../../hold/hold.repository';
import { AuditService } from '../../audit/audit.service';
import { HCM_ADAPTER_PORT } from '../hcm/hcm-adapter.port';
import type { HcmAdapterPort } from '../hcm/hcm-adapter.port';
import { EntityType, ActorType, RequestStatus } from '../../common/types';
import { generateId } from '../../common/utils';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private lastReconciledEmployeeId = '';
  private readonly batchSize = parseInt(process.env.RECONCILIATION_BATCH_SIZE || '50', 10);
  private readonly autoRepairThreshold = parseFloat(process.env.RECONCILIATION_AUTO_REPAIR_THRESHOLD_HOURS || '8');

  constructor(
    private readonly dbService: DatabaseService,
    private readonly balanceRepo: BalanceRepository,
    private readonly requestRepo: RequestRepository,
    private readonly holdRepo: HoldRepository,
    private readonly auditService: AuditService,
    @Inject(HCM_ADAPTER_PORT) private readonly hcmAdapter: HcmAdapterPort,
  ) {}

  @Cron('*/30 * * * *') // Every 30 minutes
  async runReconciliation(): Promise<void> {
    this.logger.log('Starting reconciliation run');

    const projections = this.balanceRepo.findAllProjections(
      this.lastReconciledEmployeeId || undefined,
      this.batchSize,
    );

    if (projections.length === 0) {
      // Wrap around
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
        } else if (result === 'FLAGGED') {
          driftsFound++;
          flagged++;
        }
      } catch (error) {
        this.logger.error(
          `Reconciliation failed for ${projection.employee_id}/${projection.leave_type}: ${(error as Error).message}`,
        );
      }

      this.lastReconciledEmployeeId = projection.employee_id;
    }

    this.logger.log(
      `Reconciliation run complete: checked=${checked}, drifts=${driftsFound}, repaired=${repaired}, flagged=${flagged}`,
    );
  }

  async reconcileOne(employeeId: string, leaveType: string, location: string): Promise<'OK' | 'REPAIRED' | 'FLAGGED'> {
    // Fetch from HCM
    const hcmBalance = await this.hcmAdapter.getBalance({
      employee_id: employeeId,
      leave_type: leaveType,
      correlation_id: generateId(),
    });

    // Load local
    const local = this.balanceRepo.findByEmployeeAndType(employeeId, leaveType, location);
    if (!local) {
      this.logger.warn(`No local projection for ${employeeId}/${leaveType} during reconciliation`);
      return 'OK';
    }

    // Calculate drift, accounting for pending deductions
    const pendingHours = this.requestRepo.getPendingDeductionHours(employeeId, leaveType);
    const totalDrift = Math.abs(hcmBalance.total_balance - local.total_balance);
    const adjustedUsedDrift = Math.abs(hcmBalance.used_balance - (local.used_balance + pendingHours));
    const effectiveDrift = Math.max(totalDrift, adjustedUsedDrift);

    if (effectiveDrift === 0) {
      // No drift — update hcm_version if newer
      if (hcmBalance.hcm_version > local.hcm_version) {
        this.dbService.runInTransaction(() => {
          this.balanceRepo.updateFromHcm(
            employeeId, leaveType, location,
            hcmBalance.total_balance, hcmBalance.used_balance,
            hcmBalance.hcm_version, local.version,
          );
        });
      }
      return 'OK';
    }

    this.logger.warn(
      `Drift detected for ${employeeId}/${leaveType}: effective_drift=${effectiveDrift}h ` +
        `(total: HCM=${hcmBalance.total_balance} vs local=${local.total_balance}, ` +
        `used: HCM=${hcmBalance.used_balance} vs local=${local.used_balance}+pending=${pendingHours})`,
    );

    if (effectiveDrift <= this.autoRepairThreshold) {
      // Auto-repair
      this.dbService.runInTransaction(() => {
        const current = this.balanceRepo.findByEmployeeAndType(employeeId, leaveType, location);
        if (!current) return;

        const beforeState = { ...current };
        this.balanceRepo.updateFromHcm(
          employeeId, leaveType, location,
          hcmBalance.total_balance, hcmBalance.used_balance,
          hcmBalance.hcm_version, current.version,
        );

        // Revalidate holds after repair
        const newProjected = hcmBalance.total_balance - hcmBalance.used_balance;
        const totalHeld = this.balanceRepo.getActiveHoldsTotal(employeeId, leaveType, location);
        if (newProjected - totalHeld < 0) {
          this.flagActiveHoldsForReconciliation(employeeId, leaveType, location);
        }

        this.auditService.logInTransaction({
          entityType: EntityType.BALANCE,
          entityId: `${employeeId}/${leaveType}`,
          action: 'RECONCILIATION_AUTO_REPAIR',
          actorType: ActorType.SYSTEM,
          actorId: 'reconciliation',
          beforeState,
          afterState: { ...hcmBalance },
          metadata: { drift: effectiveDrift, pending_hours: pendingHours },
        });
      });

      return 'REPAIRED';
    }

    // Flag for manual review
    this.dbService.runInTransaction(() => {
      this.flagActiveHoldsForReconciliation(employeeId, leaveType, location);

      this.auditService.logInTransaction({
        entityType: EntityType.BALANCE,
        entityId: `${employeeId}/${leaveType}`,
        action: 'RECONCILIATION_FLAGGED',
        actorType: ActorType.SYSTEM,
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

  private flagActiveHoldsForReconciliation(employeeId: string, leaveType: string, location: string): void {
    const activeHolds = this.holdRepo.findActiveByEmployeeAndType(employeeId, leaveType, location);
    for (const hold of activeHolds) {
      const request = this.requestRepo.findById(hold.request_id);
      if (request && request.status !== RequestStatus.RECONCILIATION_REQUIRED) {
        try {
          this.requestRepo.updateStatus(hold.request_id, RequestStatus.RECONCILIATION_REQUIRED, request.version);
        } catch {
          // Version conflict — skip
        }
      }
    }
  }
}

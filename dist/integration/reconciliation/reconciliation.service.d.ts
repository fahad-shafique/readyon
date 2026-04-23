import { DatabaseService } from '../../database/database.service';
import { BalanceRepository } from '../../balance/balance.repository';
import { RequestRepository } from '../../request/request.repository';
import { HoldRepository } from '../../hold/hold.repository';
import { AuditService } from '../../audit/audit.service';
import type { HcmAdapterPort } from '../hcm/hcm-adapter.port';
export declare class ReconciliationService {
    private readonly dbService;
    private readonly balanceRepo;
    private readonly requestRepo;
    private readonly holdRepo;
    private readonly auditService;
    private readonly hcmAdapter;
    private readonly logger;
    private lastReconciledEmployeeId;
    private readonly batchSize;
    private readonly autoRepairThreshold;
    constructor(dbService: DatabaseService, balanceRepo: BalanceRepository, requestRepo: RequestRepository, holdRepo: HoldRepository, auditService: AuditService, hcmAdapter: HcmAdapterPort);
    runReconciliation(): Promise<void>;
    reconcileOne(employeeId: string, leaveType: string): Promise<'OK' | 'REPAIRED' | 'FLAGGED'>;
    private flagActiveHoldsForReconciliation;
}

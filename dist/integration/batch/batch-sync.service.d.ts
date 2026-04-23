import { DatabaseService } from '../../database/database.service';
import { BalanceRepository } from '../../balance/balance.repository';
import { HoldRepository } from '../../hold/hold.repository';
import { RequestRepository } from '../../request/request.repository';
import { BatchRepository } from './batch.repository';
import { AuditService } from '../../audit/audit.service';
import type { HcmAdapterPort } from '../hcm/hcm-adapter.port';
export interface BatchSyncItem {
    employee_id: string;
    leave_type: string;
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
    results: Array<{
        employee_id: string;
        leave_type: string;
        result: string;
    }>;
}
export declare class BatchSyncService {
    private readonly dbService;
    private readonly balanceRepo;
    private readonly holdRepo;
    private readonly requestRepo;
    private readonly batchRepo;
    private readonly auditService;
    private readonly hcmAdapter;
    private readonly logger;
    constructor(dbService: DatabaseService, balanceRepo: BalanceRepository, holdRepo: HoldRepository, requestRepo: RequestRepository, batchRepo: BatchRepository, auditService: AuditService, hcmAdapter: HcmAdapterPort);
    processBatch(batchId: string, items: BatchSyncItem[]): BatchSyncResult;
    private processItem;
    pullFromHcm(): Promise<BatchSyncResult | null>;
    private getCheckpoint;
    private setCheckpoint;
}

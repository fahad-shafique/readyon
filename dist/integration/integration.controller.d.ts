import { BatchSyncService } from './batch/batch-sync.service';
import { BalanceRepository } from '../balance/balance.repository';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { DatabaseService } from '../database/database.service';
import { BatchSyncRequestDto, SingleBalanceUpdateDto } from './dto';
import type { HcmAdapterPort } from './hcm/hcm-adapter.port';
export declare class IntegrationController {
    private readonly batchSyncService;
    private readonly balanceRepo;
    private readonly auditService;
    private readonly idempotencyService;
    private readonly dbService;
    private readonly hcmAdapter;
    constructor(batchSyncService: BatchSyncService, balanceRepo: BalanceRepository, auditService: AuditService, idempotencyService: IdempotencyService, dbService: DatabaseService, hcmAdapter: HcmAdapterPort);
    mockFailures(dto: any): {
        status: string;
        reason: string;
        config?: undefined;
    } | {
        status: string;
        reason?: undefined;
        config?: undefined;
    } | {
        status: string;
        config: any;
        reason?: undefined;
    };
    batchSync(req: any, dto: BatchSyncRequestDto): {
        data: import("./batch/batch-sync.service").BatchSyncResult;
    };
    singleBalanceUpdate(req: any, dto: SingleBalanceUpdateDto): unknown;
}

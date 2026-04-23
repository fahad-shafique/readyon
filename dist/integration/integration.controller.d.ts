import { BatchSyncService } from './batch/batch-sync.service';
import { BalanceRepository } from '../balance/balance.repository';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { DatabaseService } from '../database/database.service';
import { BatchSyncRequestDto, SingleBalanceUpdateDto } from './dto';
export declare class IntegrationController {
    private readonly batchSyncService;
    private readonly balanceRepo;
    private readonly auditService;
    private readonly idempotencyService;
    private readonly dbService;
    constructor(batchSyncService: BatchSyncService, balanceRepo: BalanceRepository, auditService: AuditService, idempotencyService: IdempotencyService, dbService: DatabaseService);
    batchSync(req: any, dto: BatchSyncRequestDto): {
        data: import("./batch/batch-sync.service").BatchSyncResult;
    };
    singleBalanceUpdate(req: any, dto: SingleBalanceUpdateDto): unknown;
}

import { DatabaseService } from '../../database/database.service';
import { OutboxRepository } from './outbox.repository';
import { RequestRepository } from '../../request/request.repository';
import { BalanceRepository } from '../../balance/balance.repository';
import { HoldRepository } from '../../hold/hold.repository';
import { AuditService } from '../../audit/audit.service';
import type { HcmAdapterPort } from '../hcm/hcm-adapter.port';
export declare class OutboxProcessor {
    private readonly dbService;
    private readonly outboxRepo;
    private readonly requestRepo;
    private readonly balanceRepo;
    private readonly holdRepo;
    private readonly auditService;
    private readonly hcmAdapter;
    private readonly logger;
    private processing;
    constructor(dbService: DatabaseService, outboxRepo: OutboxRepository, requestRepo: RequestRepository, balanceRepo: BalanceRepository, holdRepo: HoldRepository, auditService: AuditService, hcmAdapter: HcmAdapterPort);
    processOutbox(): Promise<void>;
    sweep(): Promise<number>;
    private handlePermanentFailure;
}

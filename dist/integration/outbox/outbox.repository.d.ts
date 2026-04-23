import { DatabaseService } from '../../database/database.service';
import { IntegrationOutboxRow, OutboxAction, HcmErrorCategory } from '../../common/types';
export declare class OutboxRepository {
    private readonly dbService;
    private readonly logger;
    constructor(dbService: DatabaseService);
    create(params: {
        requestId: string;
        action: OutboxAction;
        idempotencyKey: string;
        payload: string;
        maxRetries?: number;
    }): IntegrationOutboxRow;
    findById(id: string): IntegrationOutboxRow | null;
    claimPendingEntries(limit?: number): IntegrationOutboxRow[];
    markCompleted(id: string): void;
    markForRetry(id: string, error: string, retryCount: number): void;
    markFailed(id: string, error: string, category: HcmErrorCategory): void;
    cancelByRequestId(requestId: string): void;
    getOutboxDepth(): number;
}

import { DatabaseService } from '../database/database.service';
import { OutboxRepository } from '../integration/outbox/outbox.repository';
import { BatchRepository } from '../integration/batch/batch.repository';
export declare class HealthController {
    private readonly dbService;
    private readonly outboxRepo;
    private readonly batchRepo;
    private readonly startTime;
    constructor(dbService: DatabaseService, outboxRepo: OutboxRepository, batchRepo: BatchRepository);
    check(): {
        status: string;
        checks: {
            database: string;
            outbox_depth: number;
            last_batch_sync: string | null;
        };
        uptime_seconds: number;
        version: string;
    };
}

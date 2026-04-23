import { DatabaseService } from '../../database/database.service';
import { IntegrationBatchRow } from '../../common/types';
export declare class BatchRepository {
    private readonly dbService;
    private readonly logger;
    constructor(dbService: DatabaseService);
    create(batchId: string, totalItems: number): IntegrationBatchRow;
    findById(id: string): IntegrationBatchRow | null;
    findByBatchId(batchId: string): IntegrationBatchRow | null;
    updateCounts(id: string, processed: number, skipped: number, failed: number, errors: string[]): void;
    getLastBatchTime(): string | null;
}

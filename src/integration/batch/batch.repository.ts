import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { IntegrationBatchRow, BatchStatus } from '../../common/types';
import { generateId, nowISO } from '../../common/utils';

@Injectable()
export class BatchRepository {
  private readonly logger = new Logger(BatchRepository.name);

  constructor(private readonly dbService: DatabaseService) {}

  create(batchId: string, totalItems: number): IntegrationBatchRow {
    const id = generateId();
    this.dbService
      .getDb()
      .prepare(
        `INSERT INTO integration_batches (id, batch_id, status, total_items)
         VALUES (?, ?, 'PROCESSING', ?)`,
      )
      .run(id, batchId, totalItems);
    return this.findById(id)!;
  }

  findById(id: string): IntegrationBatchRow | null {
    return (
      (this.dbService.getDb().prepare('SELECT * FROM integration_batches WHERE id = ?').get(id) as IntegrationBatchRow) || null
    );
  }

  findByBatchId(batchId: string): IntegrationBatchRow | null {
    return (
      (this.dbService
        .getDb()
        .prepare('SELECT * FROM integration_batches WHERE batch_id = ?')
        .get(batchId) as IntegrationBatchRow) || null
    );
  }

  updateCounts(
    id: string,
    processed: number,
    skipped: number,
    failed: number,
    errors: string[],
  ): void {
    const status: BatchStatus =
      failed > 0 && processed === 0 ? BatchStatus.FAILED : failed > 0 ? BatchStatus.PARTIAL : BatchStatus.COMPLETED;

    this.dbService
      .getDb()
      .prepare(
        `UPDATE integration_batches
         SET status = ?, processed_items = ?, skipped_items = ?, failed_items = ?,
             error_summary = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, processed, skipped, failed, errors.length > 0 ? JSON.stringify(errors) : null, nowISO(), nowISO(), id);
  }

  getLastBatchTime(): string | null {
    const row = this.dbService
      .getDb()
      .prepare(`SELECT MAX(completed_at) as last_time FROM integration_batches WHERE status IN ('COMPLETED', 'PARTIAL')`)
      .get() as any;
    return row?.last_time || null;
  }
}

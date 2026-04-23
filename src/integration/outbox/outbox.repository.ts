import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { IntegrationOutboxRow, OutboxStatus, OutboxAction, HcmErrorCategory } from '../../common/types';
import { generateId, nowISO, calculateExponentialBackoff } from '../../common/utils';

@Injectable()
export class OutboxRepository {
  private readonly logger = new Logger(OutboxRepository.name);

  constructor(private readonly dbService: DatabaseService) {}

  create(params: {
    requestId: string;
    action: OutboxAction;
    idempotencyKey: string;
    payload: string;
    maxRetries?: number;
  }): IntegrationOutboxRow {
    const id = generateId();
    this.dbService
      .getDb()
      .prepare(
        `INSERT INTO integration_outbox (id, request_id, action, idempotency_key, payload, status, max_retries)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      )
      .run(id, params.requestId, params.action, params.idempotencyKey, params.payload, params.maxRetries || 5);

    return this.findById(id)!;
  }

  findById(id: string): IntegrationOutboxRow | null {
    return (
      (this.dbService.getDb().prepare('SELECT * FROM integration_outbox WHERE id = ?').get(id) as IntegrationOutboxRow) || null
    );
  }

  /**
   * Claim pending entries for processing. Atomically marks them PROCESSING.
   */
  claimPendingEntries(limit = 10): IntegrationOutboxRow[] {
    const now = nowISO();
    // Select and update in one go via a subquery
    const entries = this.dbService
      .getDb()
      .prepare(
        `SELECT * FROM integration_outbox
         WHERE status = 'PENDING'
           AND (next_retry_at IS NULL OR next_retry_at <= ?)
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(now, limit) as IntegrationOutboxRow[];

    if (entries.length === 0) return [];

    const ids = entries.map((e) => e.id);
    const placeholders = ids.map(() => '?').join(',');

    this.dbService
      .getDb()
      .prepare(
        `UPDATE integration_outbox SET status = 'PROCESSING', updated_at = ?
         WHERE id IN (${placeholders}) AND status = 'PENDING'`,
      )
      .run(now, ...ids);

    return entries;
  }

  markCompleted(id: string): void {
    this.dbService
      .getDb()
      .prepare(
        `UPDATE integration_outbox SET status = 'COMPLETED', completed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(nowISO(), nowISO(), id);
  }

  markForRetry(id: string, error: string, retryCount: number): void {
    const nextRetry = calculateExponentialBackoff(retryCount);
    this.dbService
      .getDb()
      .prepare(
        `UPDATE integration_outbox
         SET status = 'PENDING', retry_count = ?, next_retry_at = ?,
             last_error = ?, error_category = 'TRANSIENT', updated_at = ?
         WHERE id = ?`,
      )
      .run(retryCount, nextRetry.toISOString(), error, nowISO(), id);
  }

  markFailed(id: string, error: string, category: HcmErrorCategory): void {
    this.dbService
      .getDb()
      .prepare(
        `UPDATE integration_outbox
         SET status = 'FAILED', last_error = ?, error_category = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(error, category, nowISO(), id);
  }

  cancelByRequestId(requestId: string): void {
    this.dbService
      .getDb()
      .prepare(
        `UPDATE integration_outbox
         SET status = 'FAILED', error_category = 'PERMANENT',
             last_error = 'Request cancelled by employee', updated_at = ?
         WHERE request_id = ? AND status IN ('PENDING', 'PROCESSING')`,
      )
      .run(nowISO(), requestId);
  }

  getOutboxDepth(): number {
    const row = this.dbService
      .getDb()
      .prepare(`SELECT COUNT(*) as count FROM integration_outbox WHERE status IN ('PENDING', 'PROCESSING')`)
      .get() as any;
    return row.count;
  }
}

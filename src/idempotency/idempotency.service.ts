import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { generateId } from '../common/utils';
import * as crypto from 'crypto';

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly dbService: DatabaseService) {}

  /**
   * Hash the request payload for duplicate detection with different payloads.
   */
  hashPayload(payload: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  /**
   * Check if an idempotency key has already been used.
   * Returns the stored response if found and not expired, null otherwise.
   */
  check(key: string): { response: unknown; statusCode: number; payloadHash: string } | null {
    const row = this.dbService
      .getDb()
      .prepare('SELECT * FROM idempotency_keys WHERE key = ? AND expires_at > ?')
      .get(key, new Date().toISOString()) as any;

    if (!row) return null;

    return {
      response: JSON.parse(row.response),
      statusCode: row.status_code,
      payloadHash: row.payload_hash,
    };
  }

  /**
   * Store the result of an idempotent operation. Must be called after the operation succeeds.
   */
  store(key: string, payloadHash: string, response: unknown, statusCode: number): void {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    this.dbService
      .getDb()
      .prepare(
        `INSERT OR IGNORE INTO idempotency_keys (key, payload_hash, response, status_code, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(key, payloadHash, JSON.stringify(response), statusCode, expiresAt);
  }

  /**
   * Clean up expired idempotency keys.
   */
  cleanup(): number {
    const result = this.dbService
      .getDb()
      .prepare('DELETE FROM idempotency_keys WHERE expires_at <= ?')
      .run(new Date().toISOString());
    if (result.changes > 0) {
      this.logger.log(`Cleaned up ${result.changes} expired idempotency keys`);
    }
    return result.changes;
  }
}

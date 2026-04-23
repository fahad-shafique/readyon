import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BalanceHoldRow, HoldStatus } from '../common/types';
import { VersionConflictException } from '../common/exceptions';
import { generateId, nowISO } from '../common/utils';

@Injectable()
export class HoldRepository {
  private readonly logger = new Logger(HoldRepository.name);

  constructor(private readonly dbService: DatabaseService) {}

  create(params: {
    requestId: string;
    employeeId: string;
    leaveType: string;
    holdAmount: number;
  }): BalanceHoldRow {
    const id = generateId();
    this.dbService
      .getDb()
      .prepare(
        `INSERT INTO balance_holds (id, request_id, employee_id, leave_type, hold_amount, status)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE')`,
      )
      .run(id, params.requestId, params.employeeId, params.leaveType, params.holdAmount);

    return this.findById(id)!;
  }

  findById(id: string): BalanceHoldRow | null {
    return (this.dbService.getDb().prepare('SELECT * FROM balance_holds WHERE id = ?').get(id) as BalanceHoldRow) || null;
  }

  findByRequestId(requestId: string): BalanceHoldRow | null {
    return (
      (this.dbService
        .getDb()
        .prepare('SELECT * FROM balance_holds WHERE request_id = ?')
        .get(requestId) as BalanceHoldRow) || null
    );
  }

  findActiveByEmployeeAndType(employeeId: string, leaveType: string): BalanceHoldRow[] {
    return this.dbService
      .getDb()
      .prepare(
        `SELECT * FROM balance_holds
         WHERE employee_id = ? AND leave_type = ? AND status = 'ACTIVE'`,
      )
      .all(employeeId, leaveType) as BalanceHoldRow[];
  }

  /**
   * Release a hold (return balance to available pool).
   */
  release(requestId: string): void {
    const result = this.dbService
      .getDb()
      .prepare(
        `UPDATE balance_holds
         SET status = 'RELEASED', released_at = ?, version = version + 1, updated_at = ?
         WHERE request_id = ? AND status = 'ACTIVE'`,
      )
      .run(nowISO(), nowISO(), requestId);

    if (result.changes === 0) {
      this.logger.warn(`No active hold found to release for request ${requestId}`);
    }
  }

  /**
   * Convert a hold to a permanent deduction (HCM confirmed).
   */
  convert(requestId: string): void {
    const result = this.dbService
      .getDb()
      .prepare(
        `UPDATE balance_holds
         SET status = 'CONVERTED', released_at = ?, version = version + 1, updated_at = ?
         WHERE request_id = ? AND status = 'ACTIVE'`,
      )
      .run(nowISO(), nowISO(), requestId);

    if (result.changes === 0) {
      this.logger.warn(`No active hold found to convert for request ${requestId}`);
    }
  }
}

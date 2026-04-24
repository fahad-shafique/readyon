import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { BalanceProjectionRow } from '../common/types';
import { VersionConflictException } from '../common/exceptions';
import { generateId, nowISO } from '../common/utils';

@Injectable()
export class BalanceRepository {
  private readonly logger = new Logger(BalanceRepository.name);

  constructor(private readonly dbService: DatabaseService) {}

  findByEmployeeAndType(employeeId: string, leaveType: string, location: string): BalanceProjectionRow | null {
    return (
      (this.dbService
        .getDb()
        .prepare('SELECT * FROM balance_projections WHERE employee_id = ? AND leave_type = ? AND location = ?')
        .get(employeeId, leaveType, location) as BalanceProjectionRow) || null
    );
  }

  findByEmployee(employeeId: string): BalanceProjectionRow[] {
    return this.dbService
      .getDb()
      .prepare('SELECT * FROM balance_projections WHERE employee_id = ? ORDER BY leave_type')
      .all(employeeId) as BalanceProjectionRow[];
  }

  /**
   * Calculate the sum of active holds for an employee and leave type.
   */
  getActiveHoldsTotal(employeeId: string, leaveType: string, location: string, excludeRequestId?: string): number {
    let sql = `SELECT COALESCE(SUM(hold_amount), 0) as total
               FROM balance_holds
               WHERE employee_id = ? AND leave_type = ? AND location = ? AND status = 'ACTIVE'`;
    const params: unknown[] = [employeeId, leaveType, location];

    if (excludeRequestId) {
      sql += ' AND request_id != ?';
      params.push(excludeRequestId);
    }

    const row = this.dbService.getDb().prepare(sql).get(...params) as any;
    return row.total;
  }

  /**
   * Get effective available balance (projected - active holds).
   */
  getEffectiveAvailable(employeeId: string, leaveType: string, location: string, excludeRequestId?: string): number {
    const projection = this.findByEmployeeAndType(employeeId, leaveType, location);
    if (!projection) return 0;

    const held = this.getActiveHoldsTotal(employeeId, leaveType, location, excludeRequestId);
    return projection.projected_available - held;
  }

  /**
   * Create a new balance projection.
   */
  create(params: {
    employeeId: string;
    leaveType: string;
    location: string;
    totalBalance: number;
    usedBalance: number;
    hcmVersion: string;
  }): BalanceProjectionRow {
    const id = generateId();
    const projectedAvailable = params.totalBalance - params.usedBalance;

    this.dbService
      .getDb()
      .prepare(
        `INSERT INTO balance_projections (id, employee_id, leave_type, location, total_balance, used_balance, projected_available, hcm_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, params.employeeId, params.leaveType, params.location, params.totalBalance, params.usedBalance, projectedAvailable, params.hcmVersion);

    return this.findByEmployeeAndType(params.employeeId, params.leaveType, params.location)!;
  }

  /**
   * Update balance after HCM confirms deduction (outbox success).
   * Increases used_balance and decreases projected_available.
   */
  applyDeduction(employeeId: string, leaveType: string, location: string, hours: number, expectedVersion: number): BalanceProjectionRow {
    const result = this.dbService
      .getDb()
      .prepare(
        `UPDATE balance_projections
         SET used_balance = used_balance + ?,
             projected_available = projected_available - ?,
             version = version + 1,
             updated_at = ?
         WHERE employee_id = ? AND leave_type = ? AND location = ? AND version = ?`,
      )
      .run(hours, hours, nowISO(), employeeId, leaveType, location, expectedVersion);

    if (result.changes === 0) {
      throw new VersionConflictException('balance_projection', `${employeeId}/${leaveType}/${location}`);
    }

    return this.findByEmployeeAndType(employeeId, leaveType, location)!;
  }

  /**
   * Update balance from HCM batch sync or reconciliation.
   */
  updateFromHcm(
    employeeId: string,
    leaveType: string,
    location: string,
    totalBalance: number,
    usedBalance: number,
    hcmVersion: string,
    expectedVersion: number,
  ): BalanceProjectionRow {
    const projectedAvailable = totalBalance - usedBalance;

    const result = this.dbService
      .getDb()
      .prepare(
        `UPDATE balance_projections
         SET total_balance = ?, used_balance = ?, projected_available = ?,
             hcm_version = ?, version = version + 1, updated_at = ?
         WHERE employee_id = ? AND leave_type = ? AND location = ? AND version = ?`,
      )
      .run(totalBalance, usedBalance, projectedAvailable, hcmVersion, nowISO(), employeeId, leaveType, location, expectedVersion);

    if (result.changes === 0) {
      throw new VersionConflictException('balance_projection', `${employeeId}/${leaveType}/${location}`);
    }

    return this.findByEmployeeAndType(employeeId, leaveType, location)!;
  }

  /**
   * Get all distinct employee+leaveType pairs for reconciliation.
   */
  findAllProjections(afterEmployeeId?: string, limit = 50): BalanceProjectionRow[] {
    if (afterEmployeeId) {
      return this.dbService
        .getDb()
        .prepare('SELECT * FROM balance_projections WHERE employee_id > ? ORDER BY employee_id LIMIT ?')
        .all(afterEmployeeId, limit) as BalanceProjectionRow[];
    }
    return this.dbService
      .getDb()
      .prepare('SELECT * FROM balance_projections ORDER BY employee_id LIMIT ?')
      .all(limit) as BalanceProjectionRow[];
  }
}

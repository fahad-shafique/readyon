import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TimeOffRequestRow, RequestStatus } from '../common/types';
import { VersionConflictException } from '../common/exceptions';
import { generateId, nowISO } from '../common/utils';

@Injectable()
export class RequestRepository {
  private readonly logger = new Logger(RequestRepository.name);

  constructor(private readonly dbService: DatabaseService) {}

  create(params: {
    employeeId: string;
    managerId?: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    hoursRequested: number;
    reason?: string;
  }): TimeOffRequestRow {
    const id = generateId();
    this.dbService
      .getDb()
      .prepare(
        `INSERT INTO time_off_requests
         (id, employee_id, manager_id, leave_type, start_date, end_date, hours_requested, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL')`,
      )
      .run(
        id,
        params.employeeId,
        params.managerId || null,
        params.leaveType,
        params.startDate,
        params.endDate,
        params.hoursRequested,
        params.reason || '',
      );

    return this.findById(id)!;
  }

  findById(id: string): TimeOffRequestRow | null {
    return (
      (this.dbService.getDb().prepare('SELECT * FROM time_off_requests WHERE id = ?').get(id) as TimeOffRequestRow) ||
      null
    );
  }

  findByEmployeeId(
    employeeId: string,
    filters?: { status?: string; leaveType?: string; startDateFrom?: string; startDateTo?: string },
    cursor?: string,
    limit = 20,
  ): TimeOffRequestRow[] {
    let sql = 'SELECT * FROM time_off_requests WHERE employee_id = ?';
    const params: unknown[] = [employeeId];

    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.leaveType) {
      sql += ' AND leave_type = ?';
      params.push(filters.leaveType);
    }
    if (filters?.startDateFrom) {
      sql += ' AND start_date >= ?';
      params.push(filters.startDateFrom);
    }
    if (filters?.startDateTo) {
      sql += ' AND start_date <= ?';
      params.push(filters.startDateTo);
    }
    if (cursor) {
      sql += ' AND id > ?';
      params.push(cursor);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit + 1); // fetch one extra for has_more

    return this.dbService.getDb().prepare(sql).all(...params) as TimeOffRequestRow[];
  }

  findPendingByManager(managerId: string, cursor?: string, limit = 20): TimeOffRequestRow[] {
    let sql = `SELECT * FROM time_off_requests WHERE manager_id = ? AND status = 'PENDING_APPROVAL'`;
    const params: unknown[] = [managerId];

    if (cursor) {
      sql += ' AND id > ?';
      params.push(cursor);
    }

    sql += ' ORDER BY created_at ASC LIMIT ?';
    params.push(limit + 1);

    return this.dbService.getDb().prepare(sql).all(...params) as TimeOffRequestRow[];
  }

  /**
   * Check for overlapping requests.
   */
  hasOverlap(employeeId: string, leaveType: string, startDate: string, endDate: string): boolean {
    const row = this.dbService
      .getDb()
      .prepare(
        `SELECT COUNT(*) as count FROM time_off_requests
         WHERE employee_id = ? AND leave_type = ?
           AND status IN ('PENDING_APPROVAL', 'APPROVED_PENDING_HCM', 'APPROVED')
           AND start_date <= ? AND end_date >= ?`,
      )
      .get(employeeId, leaveType, endDate, startDate) as any;

    return row.count > 0;
  }

  /**
   * Update request status with optimistic lock.
   */
  updateStatus(
    id: string,
    newStatus: RequestStatus,
    expectedVersion: number,
    extra?: { rejectionReason?: string; hcmReferenceId?: string },
  ): TimeOffRequestRow {
    let sql = `UPDATE time_off_requests SET status = ?, version = version + 1, updated_at = ?`;
    const params: unknown[] = [newStatus, nowISO()];

    if (extra?.rejectionReason !== undefined) {
      sql += ', rejection_reason = ?';
      params.push(extra.rejectionReason);
    }
    if (extra?.hcmReferenceId !== undefined) {
      sql += ', hcm_reference_id = ?';
      params.push(extra.hcmReferenceId);
    }

    sql += ' WHERE id = ? AND version = ?';
    params.push(id, expectedVersion);

    const result = this.dbService.getDb().prepare(sql).run(...params);
    if (result.changes === 0) {
      throw new VersionConflictException('time_off_request', id);
    }

    return this.findById(id)!;
  }

  /**
   * Find requests by status (for reconciliation).
   */
  findByStatus(status: RequestStatus): TimeOffRequestRow[] {
    return this.dbService
      .getDb()
      .prepare('SELECT * FROM time_off_requests WHERE status = ?')
      .all(status) as TimeOffRequestRow[];
  }

  /**
   * Get pending deduction hours for an employee+leaveType (APPROVED_PENDING_HCM).
   */
  getPendingDeductionHours(employeeId: string, leaveType: string): number {
    const row = this.dbService
      .getDb()
      .prepare(
        `SELECT COALESCE(SUM(hours_requested), 0) as total
         FROM time_off_requests
         WHERE employee_id = ? AND leave_type = ? AND status = 'APPROVED_PENDING_HCM'`,
      )
      .get(employeeId, leaveType) as any;
    return row.total;
  }
}

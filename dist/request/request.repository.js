"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var RequestRepository_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestRepository = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const exceptions_1 = require("../common/exceptions");
const utils_1 = require("../common/utils");
let RequestRepository = RequestRepository_1 = class RequestRepository {
    dbService;
    logger = new common_1.Logger(RequestRepository_1.name);
    constructor(dbService) {
        this.dbService = dbService;
    }
    create(params) {
        const id = (0, utils_1.generateId)();
        this.dbService
            .getDb()
            .prepare(`INSERT INTO time_off_requests
         (id, employee_id, manager_id, leave_type, location, start_date, end_date, hours_requested, reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL')`)
            .run(id, params.employeeId, params.managerId || null, params.leaveType, params.location, params.startDate, params.endDate, params.hoursRequested, params.reason || '');
        return this.findById(id);
    }
    findById(id) {
        return (this.dbService.getDb().prepare('SELECT * FROM time_off_requests WHERE id = ?').get(id) ||
            null);
    }
    findByEmployeeId(employeeId, filters, cursor, limit = 20) {
        let sql = 'SELECT * FROM time_off_requests WHERE employee_id = ?';
        const params = [employeeId];
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
        params.push(limit + 1);
        return this.dbService.getDb().prepare(sql).all(...params);
    }
    findPendingByManager(managerId, cursor, limit = 20) {
        let sql = `SELECT * FROM time_off_requests WHERE manager_id = ? AND status = 'PENDING_APPROVAL'`;
        const params = [managerId];
        if (cursor) {
            sql += ' AND id > ?';
            params.push(cursor);
        }
        sql += ' ORDER BY created_at ASC LIMIT ?';
        params.push(limit + 1);
        return this.dbService.getDb().prepare(sql).all(...params);
    }
    hasOverlap(employeeId, leaveType, startDate, endDate) {
        const row = this.dbService
            .getDb()
            .prepare(`SELECT COUNT(*) as count FROM time_off_requests
         WHERE employee_id = ? AND leave_type = ?
           AND status IN ('PENDING_APPROVAL', 'APPROVED_PENDING_HCM', 'APPROVED')
           AND start_date <= ? AND end_date >= ?`)
            .get(employeeId, leaveType, endDate, startDate);
        return row.count > 0;
    }
    updateStatus(id, newStatus, expectedVersion, extra) {
        let sql = `UPDATE time_off_requests SET status = ?, version = version + 1, updated_at = ?`;
        const params = [newStatus, (0, utils_1.nowISO)()];
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
            throw new exceptions_1.VersionConflictException('time_off_request', id);
        }
        return this.findById(id);
    }
    findByStatus(status) {
        return this.dbService
            .getDb()
            .prepare('SELECT * FROM time_off_requests WHERE status = ?')
            .all(status);
    }
    getPendingDeductionHours(employeeId, leaveType) {
        const row = this.dbService
            .getDb()
            .prepare(`SELECT COALESCE(SUM(hours_requested), 0) as total
         FROM time_off_requests
         WHERE employee_id = ? AND leave_type = ? AND status = 'APPROVED_PENDING_HCM'`)
            .get(employeeId, leaveType);
        return row.total;
    }
};
exports.RequestRepository = RequestRepository;
exports.RequestRepository = RequestRepository = RequestRepository_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], RequestRepository);
//# sourceMappingURL=request.repository.js.map
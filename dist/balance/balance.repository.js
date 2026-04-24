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
var BalanceRepository_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BalanceRepository = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const exceptions_1 = require("../common/exceptions");
const utils_1 = require("../common/utils");
let BalanceRepository = BalanceRepository_1 = class BalanceRepository {
    dbService;
    logger = new common_1.Logger(BalanceRepository_1.name);
    constructor(dbService) {
        this.dbService = dbService;
    }
    findByEmployeeAndType(employeeId, leaveType, location) {
        return (this.dbService
            .getDb()
            .prepare('SELECT * FROM balance_projections WHERE employee_id = ? AND leave_type = ? AND location = ?')
            .get(employeeId, leaveType, location) || null);
    }
    findByEmployee(employeeId) {
        return this.dbService
            .getDb()
            .prepare('SELECT * FROM balance_projections WHERE employee_id = ? ORDER BY leave_type')
            .all(employeeId);
    }
    getActiveHoldsTotal(employeeId, leaveType, location, excludeRequestId) {
        let sql = `SELECT COALESCE(SUM(hold_amount), 0) as total
               FROM balance_holds
               WHERE employee_id = ? AND leave_type = ? AND location = ? AND status = 'ACTIVE'`;
        const params = [employeeId, leaveType, location];
        if (excludeRequestId) {
            sql += ' AND request_id != ?';
            params.push(excludeRequestId);
        }
        const row = this.dbService.getDb().prepare(sql).get(...params);
        return row.total;
    }
    getEffectiveAvailable(employeeId, leaveType, location, excludeRequestId) {
        const projection = this.findByEmployeeAndType(employeeId, leaveType, location);
        if (!projection)
            return 0;
        const held = this.getActiveHoldsTotal(employeeId, leaveType, location, excludeRequestId);
        return projection.projected_available - held;
    }
    create(params) {
        const id = (0, utils_1.generateId)();
        const projectedAvailable = params.totalBalance - params.usedBalance;
        this.dbService
            .getDb()
            .prepare(`INSERT INTO balance_projections (id, employee_id, leave_type, location, total_balance, used_balance, projected_available, hcm_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, params.employeeId, params.leaveType, params.location, params.totalBalance, params.usedBalance, projectedAvailable, params.hcmVersion);
        return this.findByEmployeeAndType(params.employeeId, params.leaveType, params.location);
    }
    applyDeduction(employeeId, leaveType, location, hours, expectedVersion) {
        const result = this.dbService
            .getDb()
            .prepare(`UPDATE balance_projections
         SET used_balance = used_balance + ?,
             projected_available = projected_available - ?,
             version = version + 1,
             updated_at = ?
         WHERE employee_id = ? AND leave_type = ? AND location = ? AND version = ?`)
            .run(hours, hours, (0, utils_1.nowISO)(), employeeId, leaveType, location, expectedVersion);
        if (result.changes === 0) {
            throw new exceptions_1.VersionConflictException('balance_projection', `${employeeId}/${leaveType}/${location}`);
        }
        return this.findByEmployeeAndType(employeeId, leaveType, location);
    }
    updateFromHcm(employeeId, leaveType, location, totalBalance, usedBalance, hcmVersion, expectedVersion) {
        const projectedAvailable = totalBalance - usedBalance;
        const result = this.dbService
            .getDb()
            .prepare(`UPDATE balance_projections
         SET total_balance = ?, used_balance = ?, projected_available = ?,
             hcm_version = ?, version = version + 1, updated_at = ?
         WHERE employee_id = ? AND leave_type = ? AND location = ? AND version = ?`)
            .run(totalBalance, usedBalance, projectedAvailable, hcmVersion, (0, utils_1.nowISO)(), employeeId, leaveType, location, expectedVersion);
        if (result.changes === 0) {
            throw new exceptions_1.VersionConflictException('balance_projection', `${employeeId}/${leaveType}/${location}`);
        }
        return this.findByEmployeeAndType(employeeId, leaveType, location);
    }
    findAllProjections(afterEmployeeId, limit = 50) {
        if (afterEmployeeId) {
            return this.dbService
                .getDb()
                .prepare('SELECT * FROM balance_projections WHERE employee_id > ? ORDER BY employee_id LIMIT ?')
                .all(afterEmployeeId, limit);
        }
        return this.dbService
            .getDb()
            .prepare('SELECT * FROM balance_projections ORDER BY employee_id LIMIT ?')
            .all(limit);
    }
};
exports.BalanceRepository = BalanceRepository;
exports.BalanceRepository = BalanceRepository = BalanceRepository_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], BalanceRepository);
//# sourceMappingURL=balance.repository.js.map
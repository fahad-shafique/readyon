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
var HoldRepository_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.HoldRepository = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const utils_1 = require("../common/utils");
let HoldRepository = HoldRepository_1 = class HoldRepository {
    dbService;
    logger = new common_1.Logger(HoldRepository_1.name);
    constructor(dbService) {
        this.dbService = dbService;
    }
    create(params) {
        const id = (0, utils_1.generateId)();
        this.dbService
            .getDb()
            .prepare(`INSERT INTO balance_holds (id, request_id, employee_id, leave_type, location, hold_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`)
            .run(id, params.requestId, params.employeeId, params.leaveType, params.location, params.holdAmount);
        return this.findById(id);
    }
    findById(id) {
        return this.dbService.getDb().prepare('SELECT * FROM balance_holds WHERE id = ?').get(id) || null;
    }
    findByRequestId(requestId) {
        return (this.dbService
            .getDb()
            .prepare('SELECT * FROM balance_holds WHERE request_id = ?')
            .get(requestId) || null);
    }
    findActiveByEmployeeAndType(employeeId, leaveType, location) {
        return this.dbService
            .getDb()
            .prepare(`SELECT * FROM balance_holds
         WHERE employee_id = ? AND leave_type = ? AND location = ? AND status = 'ACTIVE'`)
            .all(employeeId, leaveType, location);
    }
    release(requestId) {
        const result = this.dbService
            .getDb()
            .prepare(`UPDATE balance_holds
         SET status = 'RELEASED', released_at = ?, version = version + 1, updated_at = ?
         WHERE request_id = ? AND status = 'ACTIVE'`)
            .run((0, utils_1.nowISO)(), (0, utils_1.nowISO)(), requestId);
        if (result.changes === 0) {
            this.logger.warn(`No active hold found to release for request ${requestId}`);
        }
    }
    convert(requestId) {
        const result = this.dbService
            .getDb()
            .prepare(`UPDATE balance_holds
         SET status = 'CONVERTED', released_at = ?, version = version + 1, updated_at = ?
         WHERE request_id = ? AND status = 'ACTIVE'`)
            .run((0, utils_1.nowISO)(), (0, utils_1.nowISO)(), requestId);
        if (result.changes === 0) {
            this.logger.warn(`No active hold found to convert for request ${requestId}`);
        }
    }
};
exports.HoldRepository = HoldRepository;
exports.HoldRepository = HoldRepository = HoldRepository_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], HoldRepository);
//# sourceMappingURL=hold.repository.js.map
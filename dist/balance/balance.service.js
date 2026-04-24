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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BalanceService = void 0;
const common_1 = require("@nestjs/common");
const balance_repository_1 = require("./balance.repository");
let BalanceService = class BalanceService {
    balanceRepo;
    constructor(balanceRepo) {
        this.balanceRepo = balanceRepo;
    }
    getBalances(employeeId) {
        const projections = this.balanceRepo.findByEmployee(employeeId);
        return projections.map((p) => {
            const loc = p.location || 'HQ';
            const held = this.balanceRepo.getActiveHoldsTotal(p.employee_id, p.leave_type, loc);
            return {
                employee_id: p.employee_id,
                leave_type: p.leave_type,
                location: loc,
                total_balance: p.total_balance,
                used_balance: p.used_balance,
                held_balance: held,
                effective_available: p.projected_available - held,
                hcm_version: p.hcm_version,
                last_synced_at: p.updated_at,
            };
        });
    }
    getBalanceByType(employeeId, leaveType, location = 'HQ') {
        const p = this.balanceRepo.findByEmployeeAndType(employeeId, leaveType, location);
        if (!p)
            return null;
        const loc = p.location || 'HQ';
        const held = this.balanceRepo.getActiveHoldsTotal(p.employee_id, p.leave_type, loc);
        return {
            employee_id: p.employee_id,
            leave_type: p.leave_type,
            location: loc,
            total_balance: p.total_balance,
            used_balance: p.used_balance,
            held_balance: held,
            effective_available: p.projected_available - held,
            hcm_version: p.hcm_version,
            last_synced_at: p.updated_at,
        };
    }
};
exports.BalanceService = BalanceService;
exports.BalanceService = BalanceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [balance_repository_1.BalanceRepository])
], BalanceService);
//# sourceMappingURL=balance.service.js.map
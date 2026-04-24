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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BalanceController = void 0;
const common_1 = require("@nestjs/common");
const balance_service_1 = require("./balance.service");
const exceptions_1 = require("../common/exceptions");
let BalanceController = class BalanceController {
    balanceService;
    constructor(balanceService) {
        this.balanceService = balanceService;
    }
    getBalances(req, leaveType, location) {
        const employeeId = req.headers['x-employee-id'];
        if (leaveType) {
            const loc = location || 'HQ';
            const balance = this.balanceService.getBalanceByType(employeeId, leaveType, loc);
            if (!balance) {
                throw new exceptions_1.NotFoundException('balance', `${employeeId}/${leaveType}/${loc}`);
            }
            return { data: [balance] };
        }
        const balances = this.balanceService.getBalances(employeeId);
        if (balances.length === 0) {
            throw new exceptions_1.NotFoundException('balances', employeeId);
        }
        return { data: balances };
    }
};
exports.BalanceController = BalanceController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('leave_type')),
    __param(2, (0, common_1.Query)('location')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], BalanceController.prototype, "getBalances", null);
exports.BalanceController = BalanceController = __decorate([
    (0, common_1.Controller)('api/v1/employees/me/balances'),
    __metadata("design:paramtypes", [balance_service_1.BalanceService])
], BalanceController);
//# sourceMappingURL=balance.controller.js.map
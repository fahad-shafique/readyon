"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestModule = void 0;
const common_1 = require("@nestjs/common");
const employee_request_controller_1 = require("./employee-request.controller");
const manager_request_controller_1 = require("./manager-request.controller");
const request_service_1 = require("./request.service");
const request_repository_1 = require("./request.repository");
const hold_repository_1 = require("../hold/hold.repository");
const balance_module_1 = require("../balance/balance.module");
const audit_module_1 = require("../audit/audit.module");
const idempotency_module_1 = require("../idempotency/idempotency.module");
const integration_module_1 = require("../integration/integration.module");
let RequestModule = class RequestModule {
};
exports.RequestModule = RequestModule;
exports.RequestModule = RequestModule = __decorate([
    (0, common_1.Module)({
        imports: [balance_module_1.BalanceModule, audit_module_1.AuditModule, idempotency_module_1.IdempotencyModule, (0, common_1.forwardRef)(() => integration_module_1.IntegrationModule)],
        controllers: [employee_request_controller_1.EmployeeRequestController, manager_request_controller_1.ManagerRequestController],
        providers: [request_service_1.RequestService, request_repository_1.RequestRepository, hold_repository_1.HoldRepository],
        exports: [request_service_1.RequestService, request_repository_1.RequestRepository, hold_repository_1.HoldRepository],
    })
], RequestModule);
//# sourceMappingURL=request.module.js.map
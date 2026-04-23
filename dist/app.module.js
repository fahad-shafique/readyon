"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const database_module_1 = require("./database/database.module");
const balance_module_1 = require("./balance/balance.module");
const request_module_1 = require("./request/request.module");
const integration_module_1 = require("./integration/integration.module");
const hcm_module_1 = require("./integration/hcm/hcm.module");
const audit_module_1 = require("./audit/audit.module");
const idempotency_module_1 = require("./idempotency/idempotency.module");
const health_controller_1 = require("./health/health.controller");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            schedule_1.ScheduleModule.forRoot(),
            database_module_1.DatabaseModule,
            hcm_module_1.HcmModule,
            balance_module_1.BalanceModule,
            request_module_1.RequestModule,
            integration_module_1.IntegrationModule,
            audit_module_1.AuditModule,
            idempotency_module_1.IdempotencyModule,
        ],
        controllers: [health_controller_1.HealthController],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map
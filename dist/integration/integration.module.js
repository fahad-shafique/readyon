"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationModule = void 0;
const common_1 = require("@nestjs/common");
const integration_controller_1 = require("./integration.controller");
const outbox_repository_1 = require("./outbox/outbox.repository");
const outbox_processor_1 = require("./outbox/outbox.processor");
const batch_repository_1 = require("./batch/batch.repository");
const batch_sync_service_1 = require("./batch/batch-sync.service");
const reconciliation_service_1 = require("./reconciliation/reconciliation.service");
const balance_module_1 = require("../balance/balance.module");
const audit_module_1 = require("../audit/audit.module");
const idempotency_module_1 = require("../idempotency/idempotency.module");
const request_module_1 = require("../request/request.module");
let IntegrationModule = class IntegrationModule {
};
exports.IntegrationModule = IntegrationModule;
exports.IntegrationModule = IntegrationModule = __decorate([
    (0, common_1.Module)({
        imports: [balance_module_1.BalanceModule, audit_module_1.AuditModule, idempotency_module_1.IdempotencyModule, (0, common_1.forwardRef)(() => request_module_1.RequestModule)],
        controllers: [integration_controller_1.IntegrationController],
        providers: [
            outbox_repository_1.OutboxRepository,
            outbox_processor_1.OutboxProcessor,
            batch_repository_1.BatchRepository,
            batch_sync_service_1.BatchSyncService,
            reconciliation_service_1.ReconciliationService,
        ],
        exports: [outbox_repository_1.OutboxRepository, batch_sync_service_1.BatchSyncService, batch_repository_1.BatchRepository],
    })
], IntegrationModule);
//# sourceMappingURL=integration.module.js.map
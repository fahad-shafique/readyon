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
exports.HealthController = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const outbox_repository_1 = require("../integration/outbox/outbox.repository");
const batch_repository_1 = require("../integration/batch/batch.repository");
let HealthController = class HealthController {
    dbService;
    outboxRepo;
    batchRepo;
    startTime = Date.now();
    constructor(dbService, outboxRepo, batchRepo) {
        this.dbService = dbService;
        this.outboxRepo = outboxRepo;
        this.batchRepo = batchRepo;
    }
    check() {
        let dbStatus = 'connected';
        try {
            this.dbService.getDb().prepare('SELECT 1').get();
        }
        catch {
            dbStatus = 'disconnected';
        }
        return {
            status: dbStatus === 'connected' ? 'healthy' : 'unhealthy',
            checks: {
                database: dbStatus,
                outbox_depth: this.outboxRepo.getOutboxDepth(),
                last_batch_sync: this.batchRepo.getLastBatchTime(),
            },
            uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
            version: '1.0.0',
        };
    }
};
exports.HealthController = HealthController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.HttpCode)(200),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], HealthController.prototype, "check", null);
exports.HealthController = HealthController = __decorate([
    (0, common_1.Controller)('api/v1/health'),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        outbox_repository_1.OutboxRepository,
        batch_repository_1.BatchRepository])
], HealthController);
//# sourceMappingURL=health.controller.js.map
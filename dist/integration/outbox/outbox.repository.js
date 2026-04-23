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
var OutboxRepository_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboxRepository = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../../database/database.service");
const utils_1 = require("../../common/utils");
let OutboxRepository = OutboxRepository_1 = class OutboxRepository {
    dbService;
    logger = new common_1.Logger(OutboxRepository_1.name);
    constructor(dbService) {
        this.dbService = dbService;
    }
    create(params) {
        const id = (0, utils_1.generateId)();
        this.dbService
            .getDb()
            .prepare(`INSERT INTO integration_outbox (id, request_id, action, idempotency_key, payload, status, max_retries)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`)
            .run(id, params.requestId, params.action, params.idempotencyKey, params.payload, params.maxRetries || 5);
        return this.findById(id);
    }
    findById(id) {
        return (this.dbService.getDb().prepare('SELECT * FROM integration_outbox WHERE id = ?').get(id) || null);
    }
    claimPendingEntries(limit = 10) {
        const now = (0, utils_1.nowISO)();
        const entries = this.dbService
            .getDb()
            .prepare(`SELECT * FROM integration_outbox
         WHERE status = 'PENDING'
           AND (next_retry_at IS NULL OR next_retry_at <= ?)
         ORDER BY created_at ASC
         LIMIT ?`)
            .all(now, limit);
        if (entries.length === 0)
            return [];
        const ids = entries.map((e) => e.id);
        const placeholders = ids.map(() => '?').join(',');
        this.dbService
            .getDb()
            .prepare(`UPDATE integration_outbox SET status = 'PROCESSING', updated_at = ?
         WHERE id IN (${placeholders}) AND status = 'PENDING'`)
            .run(now, ...ids);
        return entries;
    }
    markCompleted(id) {
        this.dbService
            .getDb()
            .prepare(`UPDATE integration_outbox SET status = 'COMPLETED', completed_at = ?, updated_at = ?
         WHERE id = ?`)
            .run((0, utils_1.nowISO)(), (0, utils_1.nowISO)(), id);
    }
    markForRetry(id, error, retryCount) {
        const nextRetry = (0, utils_1.calculateExponentialBackoff)(retryCount);
        this.dbService
            .getDb()
            .prepare(`UPDATE integration_outbox
         SET status = 'PENDING', retry_count = ?, next_retry_at = ?,
             last_error = ?, error_category = 'TRANSIENT', updated_at = ?
         WHERE id = ?`)
            .run(retryCount, nextRetry.toISOString(), error, (0, utils_1.nowISO)(), id);
    }
    markFailed(id, error, category) {
        this.dbService
            .getDb()
            .prepare(`UPDATE integration_outbox
         SET status = 'FAILED', last_error = ?, error_category = ?, updated_at = ?
         WHERE id = ?`)
            .run(error, category, (0, utils_1.nowISO)(), id);
    }
    cancelByRequestId(requestId) {
        this.dbService
            .getDb()
            .prepare(`UPDATE integration_outbox
         SET status = 'FAILED', error_category = 'PERMANENT',
             last_error = 'Request cancelled by employee', updated_at = ?
         WHERE request_id = ? AND status IN ('PENDING', 'PROCESSING')`)
            .run((0, utils_1.nowISO)(), requestId);
    }
    getOutboxDepth() {
        const row = this.dbService
            .getDb()
            .prepare(`SELECT COUNT(*) as count FROM integration_outbox WHERE status IN ('PENDING', 'PROCESSING')`)
            .get();
        return row.count;
    }
};
exports.OutboxRepository = OutboxRepository;
exports.OutboxRepository = OutboxRepository = OutboxRepository_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], OutboxRepository);
//# sourceMappingURL=outbox.repository.js.map
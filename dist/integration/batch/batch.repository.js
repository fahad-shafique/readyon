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
var BatchRepository_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchRepository = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../../database/database.service");
const types_1 = require("../../common/types");
const utils_1 = require("../../common/utils");
let BatchRepository = BatchRepository_1 = class BatchRepository {
    dbService;
    logger = new common_1.Logger(BatchRepository_1.name);
    constructor(dbService) {
        this.dbService = dbService;
    }
    create(batchId, totalItems) {
        const id = (0, utils_1.generateId)();
        this.dbService
            .getDb()
            .prepare(`INSERT INTO integration_batches (id, batch_id, status, total_items)
         VALUES (?, ?, 'PROCESSING', ?)`)
            .run(id, batchId, totalItems);
        return this.findById(id);
    }
    findById(id) {
        return (this.dbService.getDb().prepare('SELECT * FROM integration_batches WHERE id = ?').get(id) || null);
    }
    findByBatchId(batchId) {
        return (this.dbService
            .getDb()
            .prepare('SELECT * FROM integration_batches WHERE batch_id = ?')
            .get(batchId) || null);
    }
    updateCounts(id, processed, skipped, failed, errors) {
        const status = failed > 0 && processed === 0 ? types_1.BatchStatus.FAILED : failed > 0 ? types_1.BatchStatus.PARTIAL : types_1.BatchStatus.COMPLETED;
        this.dbService
            .getDb()
            .prepare(`UPDATE integration_batches
         SET status = ?, processed_items = ?, skipped_items = ?, failed_items = ?,
             error_summary = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`)
            .run(status, processed, skipped, failed, errors.length > 0 ? JSON.stringify(errors) : null, (0, utils_1.nowISO)(), (0, utils_1.nowISO)(), id);
    }
    getLastBatchTime() {
        const row = this.dbService
            .getDb()
            .prepare(`SELECT MAX(completed_at) as last_time FROM integration_batches WHERE status IN ('COMPLETED', 'PARTIAL')`)
            .get();
        return row?.last_time || null;
    }
};
exports.BatchRepository = BatchRepository;
exports.BatchRepository = BatchRepository = BatchRepository_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], BatchRepository);
//# sourceMappingURL=batch.repository.js.map
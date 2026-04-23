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
exports.AuditService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const utils_1 = require("../common/utils");
let AuditService = class AuditService {
    dbService;
    insertStmt = null;
    constructor(dbService) {
        this.dbService = dbService;
    }
    getInsertStmt() {
        if (!this.insertStmt) {
            this.insertStmt = this.dbService.getDb().prepare(`
        INSERT INTO audit_logs (id, entity_type, entity_id, action, actor_type, actor_id,
          before_state, after_state, metadata, correlation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
        }
        return this.insertStmt;
    }
    log(params) {
        this.getInsertStmt().run((0, utils_1.generateId)(), params.entityType, params.entityId, params.action, params.actorType, params.actorId, params.beforeState ? JSON.stringify(params.beforeState) : null, params.afterState ? JSON.stringify(params.afterState) : null, params.metadata ? JSON.stringify(params.metadata) : null, params.correlationId || null);
    }
    logInTransaction(params) {
        this.log(params);
    }
    findByEntity(entityType, entityId) {
        return this.dbService
            .getDb()
            .prepare('SELECT * FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC')
            .all(entityType, entityId);
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], AuditService);
//# sourceMappingURL=audit.service.js.map
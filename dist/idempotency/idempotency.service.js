"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var IdempotencyService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.IdempotencyService = void 0;
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const crypto = __importStar(require("crypto"));
let IdempotencyService = IdempotencyService_1 = class IdempotencyService {
    dbService;
    logger = new common_1.Logger(IdempotencyService_1.name);
    constructor(dbService) {
        this.dbService = dbService;
    }
    hashPayload(payload) {
        return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    }
    check(key) {
        const row = this.dbService
            .getDb()
            .prepare('SELECT * FROM idempotency_keys WHERE key = ? AND expires_at > ?')
            .get(key, new Date().toISOString());
        if (!row)
            return null;
        return {
            response: JSON.parse(row.response),
            statusCode: row.status_code,
            payloadHash: row.payload_hash,
        };
    }
    store(key, payloadHash, response, statusCode) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        this.dbService
            .getDb()
            .prepare(`INSERT OR IGNORE INTO idempotency_keys (key, payload_hash, response, status_code, expires_at)
         VALUES (?, ?, ?, ?, ?)`)
            .run(key, payloadHash, JSON.stringify(response), statusCode, expiresAt);
    }
    cleanup() {
        const result = this.dbService
            .getDb()
            .prepare('DELETE FROM idempotency_keys WHERE expires_at <= ?')
            .run(new Date().toISOString());
        if (result.changes > 0) {
            this.logger.log(`Cleaned up ${result.changes} expired idempotency keys`);
        }
        return result.changes;
    }
};
exports.IdempotencyService = IdempotencyService;
exports.IdempotencyService = IdempotencyService = IdempotencyService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], IdempotencyService);
//# sourceMappingURL=idempotency.service.js.map
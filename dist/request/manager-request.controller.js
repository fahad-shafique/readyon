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
exports.ManagerRequestController = void 0;
const common_1 = require("@nestjs/common");
const request_service_1 = require("./request.service");
const idempotency_service_1 = require("../idempotency/idempotency.service");
const dto_1 = require("./dto");
const exceptions_1 = require("../common/exceptions");
let ManagerRequestController = class ManagerRequestController {
    requestService;
    idempotencyService;
    constructor(requestService, idempotencyService) {
        this.requestService = requestService;
        this.idempotencyService = idempotencyService;
    }
    listPendingApprovals(req, cursor, limit) {
        const managerId = req.headers['x-manager-id'] || req.headers['x-employee-id'];
        return this.requestService.listPendingApprovals(managerId, cursor, limit ? parseInt(limit, 10) : 20);
    }
    approveRequest(req, requestId, dto) {
        const managerId = req.headers['x-manager-id'] || req.headers['x-employee-id'];
        const idempotencyKey = req.headers['idempotency-key'];
        const correlationId = req.correlationId;
        if (!idempotencyKey) {
            throw new exceptions_1.ValidationException('Idempotency-Key header is required');
        }
        const existing = this.idempotencyService.check(idempotencyKey);
        if (existing) {
            const payloadHash = this.idempotencyService.hashPayload(dto);
            if (existing.payloadHash !== payloadHash) {
                throw new exceptions_1.DuplicateRequestException(idempotencyKey);
            }
            return existing.response;
        }
        const result = this.requestService.approveRequest(requestId, managerId, dto, correlationId);
        const response = { data: result };
        this.idempotencyService.store(idempotencyKey, this.idempotencyService.hashPayload(dto), response, 200);
        return response;
    }
    rejectRequest(req, requestId, dto) {
        const managerId = req.headers['x-manager-id'] || req.headers['x-employee-id'];
        const idempotencyKey = req.headers['idempotency-key'];
        const correlationId = req.correlationId;
        if (!idempotencyKey) {
            throw new exceptions_1.ValidationException('Idempotency-Key header is required');
        }
        const existing = this.idempotencyService.check(idempotencyKey);
        if (existing) {
            const payloadHash = this.idempotencyService.hashPayload(dto);
            if (existing.payloadHash !== payloadHash) {
                throw new exceptions_1.DuplicateRequestException(idempotencyKey);
            }
            return existing.response;
        }
        const result = this.requestService.rejectRequest(requestId, managerId, dto, correlationId);
        const response = { data: result };
        this.idempotencyService.store(idempotencyKey, this.idempotencyService.hashPayload(dto), response, 200);
        return response;
    }
};
exports.ManagerRequestController = ManagerRequestController;
__decorate([
    (0, common_1.Get)('pending-approvals'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('cursor')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ManagerRequestController.prototype, "listPendingApprovals", null);
__decorate([
    (0, common_1.Post)('requests/:requestId/approve'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('requestId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, dto_1.ApproveRequestDto]),
    __metadata("design:returntype", void 0)
], ManagerRequestController.prototype, "approveRequest", null);
__decorate([
    (0, common_1.Post)('requests/:requestId/reject'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('requestId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, dto_1.RejectRequestDto]),
    __metadata("design:returntype", void 0)
], ManagerRequestController.prototype, "rejectRequest", null);
exports.ManagerRequestController = ManagerRequestController = __decorate([
    (0, common_1.Controller)('api/v1/managers/me'),
    __metadata("design:paramtypes", [request_service_1.RequestService,
        idempotency_service_1.IdempotencyService])
], ManagerRequestController);
//# sourceMappingURL=manager-request.controller.js.map
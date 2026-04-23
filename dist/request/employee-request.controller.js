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
exports.EmployeeRequestController = void 0;
const common_1 = require("@nestjs/common");
const request_service_1 = require("./request.service");
const idempotency_service_1 = require("../idempotency/idempotency.service");
const dto_1 = require("./dto");
const exceptions_1 = require("../common/exceptions");
let EmployeeRequestController = class EmployeeRequestController {
    requestService;
    idempotencyService;
    constructor(requestService, idempotencyService) {
        this.requestService = requestService;
        this.idempotencyService = idempotencyService;
    }
    createRequest(req, dto) {
        const employeeId = req.headers['x-employee-id'];
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
        const result = this.requestService.createRequest(employeeId, dto, correlationId);
        const response = { data: result };
        this.idempotencyService.store(idempotencyKey, this.idempotencyService.hashPayload(dto), response, 201);
        return response;
    }
    listRequests(req, status, leaveType, startDateFrom, startDateTo, cursor, limit) {
        const employeeId = req.headers['x-employee-id'];
        const result = this.requestService.listRequests(employeeId, { status, leaveType, startDateFrom, startDateTo }, cursor, limit ? parseInt(limit, 10) : 20);
        return result;
    }
    getRequest(req, requestId) {
        const employeeId = req.headers['x-employee-id'];
        const result = this.requestService.getRequest(requestId, employeeId);
        return { data: result };
    }
    cancelRequest(req, requestId, dto) {
        const employeeId = req.headers['x-employee-id'];
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
        const result = this.requestService.cancelRequest(requestId, employeeId, dto, correlationId);
        const response = { data: result };
        this.idempotencyService.store(idempotencyKey, this.idempotencyService.hashPayload(dto), response, 200);
        return response;
    }
};
exports.EmployeeRequestController = EmployeeRequestController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.CreateTimeOffRequestDto]),
    __metadata("design:returntype", void 0)
], EmployeeRequestController.prototype, "createRequest", null);
__decorate([
    (0, common_1.Get)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('status')),
    __param(2, (0, common_1.Query)('leave_type')),
    __param(3, (0, common_1.Query)('start_date_from')),
    __param(4, (0, common_1.Query)('start_date_to')),
    __param(5, (0, common_1.Query)('cursor')),
    __param(6, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], EmployeeRequestController.prototype, "listRequests", null);
__decorate([
    (0, common_1.Get)(':requestId'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('requestId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], EmployeeRequestController.prototype, "getRequest", null);
__decorate([
    (0, common_1.Post)(':requestId/cancel'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('requestId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, dto_1.CancelRequestDto]),
    __metadata("design:returntype", void 0)
], EmployeeRequestController.prototype, "cancelRequest", null);
exports.EmployeeRequestController = EmployeeRequestController = __decorate([
    (0, common_1.Controller)('api/v1/employees/me/requests'),
    __metadata("design:paramtypes", [request_service_1.RequestService,
        idempotency_service_1.IdempotencyService])
], EmployeeRequestController);
//# sourceMappingURL=employee-request.controller.js.map
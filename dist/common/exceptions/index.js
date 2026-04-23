"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaleBatchException = exports.DuplicateRequestException = exports.InvalidStateTransitionException = exports.VersionConflictException = exports.OverlappingRequestException = exports.InsufficientBalanceException = exports.ForbiddenException = exports.NotFoundException = exports.ValidationException = exports.AppException = void 0;
const common_1 = require("@nestjs/common");
const types_1 = require("../types");
class AppException extends common_1.HttpException {
    errorCode;
    details;
    constructor(errorCode, message, statusCode, details) {
        super({
            statusCode,
            error: errorCode,
            message,
            details: details || {},
            timestamp: new Date().toISOString(),
        }, statusCode);
        this.errorCode = errorCode;
        this.details = details;
    }
}
exports.AppException = AppException;
class ValidationException extends AppException {
    constructor(message, details) {
        super(types_1.ErrorCode.VALIDATION_ERROR, message, common_1.HttpStatus.BAD_REQUEST, details);
    }
}
exports.ValidationException = ValidationException;
class NotFoundException extends AppException {
    constructor(resource, id) {
        super(types_1.ErrorCode.NOT_FOUND, `${resource} not found: ${id}`, common_1.HttpStatus.NOT_FOUND, { resource, id });
    }
}
exports.NotFoundException = NotFoundException;
class ForbiddenException extends AppException {
    constructor(message, details) {
        super(types_1.ErrorCode.FORBIDDEN, message, common_1.HttpStatus.FORBIDDEN, details);
    }
}
exports.ForbiddenException = ForbiddenException;
class InsufficientBalanceException extends AppException {
    constructor(available, requested, leaveType) {
        super(types_1.ErrorCode.INSUFFICIENT_BALANCE, `Available balance (${available}h) is less than requested (${requested}h)`, common_1.HttpStatus.CONFLICT, { available, requested, leave_type: leaveType });
    }
}
exports.InsufficientBalanceException = InsufficientBalanceException;
class OverlappingRequestException extends AppException {
    constructor(employeeId, startDate, endDate) {
        super(types_1.ErrorCode.OVERLAPPING_REQUEST, `Overlapping time-off request exists for period ${startDate} to ${endDate}`, common_1.HttpStatus.CONFLICT, { employee_id: employeeId, start_date: startDate, end_date: endDate });
    }
}
exports.OverlappingRequestException = OverlappingRequestException;
class VersionConflictException extends AppException {
    constructor(resource, id) {
        super(types_1.ErrorCode.VERSION_CONFLICT, `${resource} was modified concurrently. Please retry with the latest version.`, common_1.HttpStatus.CONFLICT, { resource, id });
    }
}
exports.VersionConflictException = VersionConflictException;
class InvalidStateTransitionException extends AppException {
    constructor(currentStatus, attemptedStatus, requestId) {
        super(types_1.ErrorCode.INVALID_STATE_TRANSITION, `Cannot transition from ${currentStatus} to ${attemptedStatus}`, common_1.HttpStatus.BAD_REQUEST, { current_status: currentStatus, attempted_status: attemptedStatus, request_id: requestId });
    }
}
exports.InvalidStateTransitionException = InvalidStateTransitionException;
class DuplicateRequestException extends AppException {
    constructor(idempotencyKey) {
        super(types_1.ErrorCode.DUPLICATE_REQUEST, `Request with idempotency key already processed`, common_1.HttpStatus.CONFLICT, { idempotency_key: idempotencyKey });
    }
}
exports.DuplicateRequestException = DuplicateRequestException;
class StaleBatchException extends AppException {
    constructor(employeeId, leaveType) {
        super(types_1.ErrorCode.STALE_BATCH, `Batch update is stale for ${employeeId}/${leaveType}`, common_1.HttpStatus.UNPROCESSABLE_ENTITY, { employee_id: employeeId, leave_type: leaveType });
    }
}
exports.StaleBatchException = StaleBatchException;
//# sourceMappingURL=index.js.map
import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../types';
interface ErrorDetails {
    [key: string]: unknown;
}
export declare class AppException extends HttpException {
    readonly errorCode: ErrorCode;
    readonly details?: ErrorDetails | undefined;
    constructor(errorCode: ErrorCode, message: string, statusCode: HttpStatus, details?: ErrorDetails | undefined);
}
export declare class ValidationException extends AppException {
    constructor(message: string, details?: ErrorDetails);
}
export declare class NotFoundException extends AppException {
    constructor(resource: string, id: string);
}
export declare class ForbiddenException extends AppException {
    constructor(message: string, details?: ErrorDetails);
}
export declare class InsufficientBalanceException extends AppException {
    constructor(available: number, requested: number, leaveType: string);
}
export declare class OverlappingRequestException extends AppException {
    constructor(employeeId: string, startDate: string, endDate: string);
}
export declare class VersionConflictException extends AppException {
    constructor(resource: string, id: string);
}
export declare class InvalidStateTransitionException extends AppException {
    constructor(currentStatus: string, attemptedStatus: string, requestId?: string);
}
export declare class DuplicateRequestException extends AppException {
    constructor(idempotencyKey: string);
}
export declare class StaleBatchException extends AppException {
    constructor(employeeId: string, leaveType: string);
}
export {};

import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../types';

interface ErrorDetails {
  [key: string]: unknown;
}

export class AppException extends HttpException {
  constructor(
    public readonly errorCode: ErrorCode,
    message: string,
    statusCode: HttpStatus,
    public readonly details?: ErrorDetails,
  ) {
    super(
      {
        statusCode,
        error: errorCode,
        message,
        details: details || {},
        timestamp: new Date().toISOString(),
      },
      statusCode,
    );
  }
}

export class ValidationException extends AppException {
  constructor(message: string, details?: ErrorDetails) {
    super(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST, details);
  }
}

export class NotFoundException extends AppException {
  constructor(resource: string, id: string) {
    super(ErrorCode.NOT_FOUND, `${resource} not found: ${id}`, HttpStatus.NOT_FOUND, { resource, id });
  }
}

export class ForbiddenException extends AppException {
  constructor(message: string, details?: ErrorDetails) {
    super(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN, details);
  }
}

export class InsufficientBalanceException extends AppException {
  constructor(available: number, requested: number, leaveType: string) {
    super(
      ErrorCode.INSUFFICIENT_BALANCE,
      `Available balance (${available}h) is less than requested (${requested}h)`,
      HttpStatus.CONFLICT,
      { available, requested, leave_type: leaveType },
    );
  }
}

export class OverlappingRequestException extends AppException {
  constructor(employeeId: string, startDate: string, endDate: string) {
    super(
      ErrorCode.OVERLAPPING_REQUEST,
      `Overlapping time-off request exists for period ${startDate} to ${endDate}`,
      HttpStatus.CONFLICT,
      { employee_id: employeeId, start_date: startDate, end_date: endDate },
    );
  }
}

export class VersionConflictException extends AppException {
  constructor(resource: string, id: string) {
    super(
      ErrorCode.VERSION_CONFLICT,
      `${resource} was modified concurrently. Please retry with the latest version.`,
      HttpStatus.CONFLICT,
      { resource, id },
    );
  }
}

export class InvalidStateTransitionException extends AppException {
  constructor(currentStatus: string, attemptedStatus: string, requestId?: string) {
    super(
      ErrorCode.INVALID_STATE_TRANSITION,
      `Cannot transition from ${currentStatus} to ${attemptedStatus}`,
      HttpStatus.BAD_REQUEST,
      { current_status: currentStatus, attempted_status: attemptedStatus, request_id: requestId },
    );
  }
}

export class DuplicateRequestException extends AppException {
  constructor(idempotencyKey: string) {
    super(
      ErrorCode.DUPLICATE_REQUEST,
      `Request with idempotency key already processed`,
      HttpStatus.CONFLICT,
      { idempotency_key: idempotencyKey },
    );
  }
}

export class StaleBatchException extends AppException {
  constructor(employeeId: string, leaveType: string) {
    super(
      ErrorCode.STALE_BATCH,
      `Batch update is stale for ${employeeId}/${leaveType}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { employee_id: employeeId, leave_type: leaveType },
    );
  }
}

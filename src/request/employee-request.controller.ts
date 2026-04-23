import { Controller, Get, Post, Body, Param, Query, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { RequestService } from './request.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { CreateTimeOffRequestDto, CancelRequestDto } from './dto';
import { ValidationException, DuplicateRequestException } from '../common/exceptions';

@Controller('api/v1/employees/me/requests')
export class EmployeeRequestController {
  constructor(
    private readonly requestService: RequestService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createRequest(@Req() req: any, @Body() dto: CreateTimeOffRequestDto) {
    const employeeId = req.headers['x-employee-id'];
    const idempotencyKey = req.headers['idempotency-key'];
    const correlationId = req.correlationId;

    if (!idempotencyKey) {
      throw new ValidationException('Idempotency-Key header is required');
    }

    // Idempotency check
    const existing = this.idempotencyService.check(idempotencyKey);
    if (existing) {
      const payloadHash = this.idempotencyService.hashPayload(dto);
      if (existing.payloadHash !== payloadHash) {
        throw new DuplicateRequestException(idempotencyKey);
      }
      return existing.response;
    }

    const result = this.requestService.createRequest(employeeId, dto, correlationId);
    const response = { data: result };

    // Store for idempotency
    this.idempotencyService.store(idempotencyKey, this.idempotencyService.hashPayload(dto), response, 201);

    return response;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  listRequests(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('leave_type') leaveType?: string,
    @Query('start_date_from') startDateFrom?: string,
    @Query('start_date_to') startDateTo?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const employeeId = req.headers['x-employee-id'];
    const result = this.requestService.listRequests(
      employeeId,
      { status, leaveType, startDateFrom, startDateTo },
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
    return result;
  }

  @Get(':requestId')
  @HttpCode(HttpStatus.OK)
  getRequest(@Req() req: any, @Param('requestId') requestId: string) {
    const employeeId = req.headers['x-employee-id'];
    const result = this.requestService.getRequest(requestId, employeeId);
    return { data: result };
  }

  @Post(':requestId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelRequest(@Req() req: any, @Param('requestId') requestId: string, @Body() dto: CancelRequestDto) {
    const employeeId = req.headers['x-employee-id'];
    const idempotencyKey = req.headers['idempotency-key'];
    const correlationId = req.correlationId;

    if (!idempotencyKey) {
      throw new ValidationException('Idempotency-Key header is required');
    }

    const existing = this.idempotencyService.check(idempotencyKey);
    if (existing) {
      const payloadHash = this.idempotencyService.hashPayload(dto);
      if (existing.payloadHash !== payloadHash) {
        throw new DuplicateRequestException(idempotencyKey);
      }
      return existing.response;
    }

    const result = this.requestService.cancelRequest(requestId, employeeId, dto, correlationId);
    const response = { data: result };

    this.idempotencyService.store(idempotencyKey, this.idempotencyService.hashPayload(dto), response, 200);

    return response;
  }
}

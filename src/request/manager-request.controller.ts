import { Controller, Get, Post, Body, Param, Query, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { RequestService } from './request.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { ApproveRequestDto, RejectRequestDto } from './dto';
import { ValidationException, DuplicateRequestException } from '../common/exceptions';

@Controller('api/v1/managers/me')
export class ManagerRequestController {
  constructor(
    private readonly requestService: RequestService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  @Get('pending-approvals')
  @HttpCode(HttpStatus.OK)
  listPendingApprovals(@Req() req: any, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const managerId = req.headers['x-manager-id'] || req.headers['x-employee-id'];
    return this.requestService.listPendingApprovals(managerId, cursor, limit ? parseInt(limit, 10) : 20);
  }

  @Post('requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  approveRequest(@Req() req: any, @Param('requestId') requestId: string, @Body() dto: ApproveRequestDto) {
    const managerId = req.headers['x-manager-id'] || req.headers['x-employee-id'];
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

    const result = this.requestService.approveRequest(requestId, managerId, dto, correlationId);
    const response = { data: result };

    this.idempotencyService.store(idempotencyKey, this.idempotencyService.hashPayload(dto), response, 200);

    return response;
  }

  @Post('requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  rejectRequest(@Req() req: any, @Param('requestId') requestId: string, @Body() dto: RejectRequestDto) {
    const managerId = req.headers['x-manager-id'] || req.headers['x-employee-id'];
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

    const result = this.requestService.rejectRequest(requestId, managerId, dto, correlationId);
    const response = { data: result };

    this.idempotencyService.store(idempotencyKey, this.idempotencyService.hashPayload(dto), response, 200);

    return response;
  }
}

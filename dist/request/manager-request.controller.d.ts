import { RequestService } from './request.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { ApproveRequestDto, RejectRequestDto } from './dto';
export declare class ManagerRequestController {
    private readonly requestService;
    private readonly idempotencyService;
    constructor(requestService: RequestService, idempotencyService: IdempotencyService);
    listPendingApprovals(req: any, cursor?: string, limit?: string): {
        data: import("../common/types").TimeOffRequestRow[];
        pagination: {
            next_cursor: string | null;
            has_more: boolean;
            limit: number;
        };
    };
    approveRequest(req: any, requestId: string, dto: ApproveRequestDto): unknown;
    rejectRequest(req: any, requestId: string, dto: RejectRequestDto): unknown;
}

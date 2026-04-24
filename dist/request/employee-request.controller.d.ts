import { RequestService } from './request.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { CreateTimeOffRequestDto, CancelRequestDto } from './dto';
export declare class EmployeeRequestController {
    private readonly requestService;
    private readonly idempotencyService;
    constructor(requestService: RequestService, idempotencyService: IdempotencyService);
    createRequest(req: any, dto: CreateTimeOffRequestDto): unknown;
    listRequests(req: any, status?: string, leaveType?: string, startDateFrom?: string, startDateTo?: string, cursor?: string, limit?: string): {
        data: import("../common/types").TimeOffRequestRow[];
        pagination: {
            next_cursor: string | null;
            has_more: boolean;
            limit: number;
        };
    };
    getRequest(req: any, requestId: string): {
        data: {
            hold: {
                id: string;
                hold_amount: number;
                status: import("../common/types").HoldStatus;
            } | null;
            id: string;
            employee_id: string;
            manager_id: string | null;
            leave_type: string;
            location: string | null;
            start_date: string;
            end_date: string;
            hours_requested: number;
            reason: string;
            status: import("../common/types").RequestStatus;
            rejection_reason: string | null;
            hcm_reference_id: string | null;
            version: number;
            created_at: string;
            updated_at: string;
        };
    };
    cancelRequest(req: any, requestId: string, dto: CancelRequestDto): unknown;
}

import { DatabaseService } from '../database/database.service';
import { RequestRepository } from './request.repository';
import { BalanceRepository } from '../balance/balance.repository';
import { HoldRepository } from '../hold/hold.repository';
import { OutboxRepository } from '../integration/outbox/outbox.repository';
import { AuditService } from '../audit/audit.service';
import { RequestStatus } from '../common/types';
import { CreateTimeOffRequestDto, CancelRequestDto, ApproveRequestDto, RejectRequestDto } from './dto';
export declare class RequestService {
    private readonly dbService;
    private readonly requestRepo;
    private readonly balanceRepo;
    private readonly holdRepo;
    private readonly outboxRepo;
    private readonly auditService;
    private readonly logger;
    constructor(dbService: DatabaseService, requestRepo: RequestRepository, balanceRepo: BalanceRepository, holdRepo: HoldRepository, outboxRepo: OutboxRepository, auditService: AuditService);
    createRequest(employeeId: string, dto: CreateTimeOffRequestDto, correlationId?: string): {
        id: string;
        employee_id: string;
        leave_type: string;
        start_date: string;
        end_date: string;
        hours_requested: number;
        reason: string;
        status: RequestStatus;
        hold_id: string;
        version: number;
        created_at: string;
    };
    getRequest(requestId: string, employeeId: string): {
        hold: {
            id: string;
            hold_amount: number;
            status: import("../common/types").HoldStatus;
        } | null;
        id: string;
        employee_id: string;
        manager_id: string | null;
        leave_type: string;
        start_date: string;
        end_date: string;
        hours_requested: number;
        reason: string;
        status: RequestStatus;
        rejection_reason: string | null;
        hcm_reference_id: string | null;
        version: number;
        created_at: string;
        updated_at: string;
    };
    listRequests(employeeId: string, filters?: {
        status?: string;
        leaveType?: string;
        startDateFrom?: string;
        startDateTo?: string;
    }, cursor?: string, limit?: number): {
        data: import("../common/types").TimeOffRequestRow[];
        pagination: {
            next_cursor: string | null;
            has_more: boolean;
            limit: number;
        };
    };
    cancelRequest(requestId: string, employeeId: string, dto: CancelRequestDto, correlationId?: string): {
        id: string;
        status: RequestStatus;
        hold_status: string;
        version: number;
        updated_at: string;
    };
    approveRequest(requestId: string, managerId: string, dto: ApproveRequestDto, correlationId?: string): {
        id: string;
        status: RequestStatus;
        version: number;
        outbox_id: string;
        updated_at: string;
    };
    rejectRequest(requestId: string, managerId: string, dto: RejectRequestDto, correlationId?: string): {
        id: string;
        status: RequestStatus;
        rejection_reason: string | null;
        hold_status: string;
        version: number;
        updated_at: string;
    };
    listPendingApprovals(managerId: string, cursor?: string, limit?: number): {
        data: import("../common/types").TimeOffRequestRow[];
        pagination: {
            next_cursor: string | null;
            has_more: boolean;
            limit: number;
        };
    };
}

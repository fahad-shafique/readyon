import { DatabaseService } from '../database/database.service';
import { TimeOffRequestRow, RequestStatus } from '../common/types';
export declare class RequestRepository {
    private readonly dbService;
    private readonly logger;
    constructor(dbService: DatabaseService);
    create(params: {
        employeeId: string;
        managerId?: string;
        leaveType: string;
        startDate: string;
        endDate: string;
        hoursRequested: number;
        reason?: string;
    }): TimeOffRequestRow;
    findById(id: string): TimeOffRequestRow | null;
    findByEmployeeId(employeeId: string, filters?: {
        status?: string;
        leaveType?: string;
        startDateFrom?: string;
        startDateTo?: string;
    }, cursor?: string, limit?: number): TimeOffRequestRow[];
    findPendingByManager(managerId: string, cursor?: string, limit?: number): TimeOffRequestRow[];
    hasOverlap(employeeId: string, leaveType: string, startDate: string, endDate: string): boolean;
    updateStatus(id: string, newStatus: RequestStatus, expectedVersion: number, extra?: {
        rejectionReason?: string;
        hcmReferenceId?: string;
    }): TimeOffRequestRow;
    findByStatus(status: RequestStatus): TimeOffRequestRow[];
    getPendingDeductionHours(employeeId: string, leaveType: string): number;
}

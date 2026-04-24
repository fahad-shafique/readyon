import { DatabaseService } from '../database/database.service';
import { BalanceProjectionRow } from '../common/types';
export declare class BalanceRepository {
    private readonly dbService;
    private readonly logger;
    constructor(dbService: DatabaseService);
    findByEmployeeAndType(employeeId: string, leaveType: string, location: string): BalanceProjectionRow | null;
    findByEmployee(employeeId: string): BalanceProjectionRow[];
    getActiveHoldsTotal(employeeId: string, leaveType: string, location: string, excludeRequestId?: string): number;
    getEffectiveAvailable(employeeId: string, leaveType: string, location: string, excludeRequestId?: string): number;
    create(params: {
        employeeId: string;
        leaveType: string;
        location: string;
        totalBalance: number;
        usedBalance: number;
        hcmVersion: string;
    }): BalanceProjectionRow;
    applyDeduction(employeeId: string, leaveType: string, location: string, hours: number, expectedVersion: number): BalanceProjectionRow;
    updateFromHcm(employeeId: string, leaveType: string, location: string, totalBalance: number, usedBalance: number, hcmVersion: string, expectedVersion: number): BalanceProjectionRow;
    findAllProjections(afterEmployeeId?: string, limit?: number): BalanceProjectionRow[];
}

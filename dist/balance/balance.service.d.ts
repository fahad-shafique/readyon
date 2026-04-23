import { BalanceRepository } from './balance.repository';
export declare class BalanceService {
    private readonly balanceRepo;
    constructor(balanceRepo: BalanceRepository);
    getBalances(employeeId: string): {
        employee_id: string;
        leave_type: string;
        total_balance: number;
        used_balance: number;
        held_balance: number;
        effective_available: number;
        hcm_version: string;
        last_synced_at: string;
    }[];
    getBalanceByType(employeeId: string, leaveType: string): {
        employee_id: string;
        leave_type: string;
        total_balance: number;
        used_balance: number;
        held_balance: number;
        effective_available: number;
        hcm_version: string;
        last_synced_at: string;
    } | null;
}

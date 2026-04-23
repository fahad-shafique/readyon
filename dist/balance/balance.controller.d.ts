import { BalanceService } from './balance.service';
export declare class BalanceController {
    private readonly balanceService;
    constructor(balanceService: BalanceService);
    getBalances(req: any, leaveType?: string): {
        data: {
            employee_id: string;
            leave_type: string;
            total_balance: number;
            used_balance: number;
            held_balance: number;
            effective_available: number;
            hcm_version: string;
            last_synced_at: string;
        }[];
    };
}

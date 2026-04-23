import { DatabaseService } from '../database/database.service';
import { BalanceHoldRow } from '../common/types';
export declare class HoldRepository {
    private readonly dbService;
    private readonly logger;
    constructor(dbService: DatabaseService);
    create(params: {
        requestId: string;
        employeeId: string;
        leaveType: string;
        holdAmount: number;
    }): BalanceHoldRow;
    findById(id: string): BalanceHoldRow | null;
    findByRequestId(requestId: string): BalanceHoldRow | null;
    findActiveByEmployeeAndType(employeeId: string, leaveType: string): BalanceHoldRow[];
    release(requestId: string): void;
    convert(requestId: string): void;
}

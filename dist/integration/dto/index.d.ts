export declare class BatchSyncItemDto {
    employee_id: string;
    leave_type: string;
    total_balance: number;
    used_balance: number;
    hcm_version: string;
}
export declare class BatchSyncRequestDto {
    batch_id: string;
    items: BatchSyncItemDto[];
}
export declare class SingleBalanceUpdateDto {
    employee_id: string;
    leave_type: string;
    total_balance: number;
    used_balance: number;
    hcm_version: string;
}

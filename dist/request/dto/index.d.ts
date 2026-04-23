export declare class CreateTimeOffRequestDto {
    leave_type: string;
    start_date: string;
    end_date: string;
    hours_requested: number;
    reason?: string;
}
export declare class CancelRequestDto {
    version: number;
    reason?: string;
}
export declare class ApproveRequestDto {
    version: number;
}
export declare class RejectRequestDto {
    version: number;
    rejection_reason: string;
}

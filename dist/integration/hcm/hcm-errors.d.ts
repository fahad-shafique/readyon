import { HcmErrorCategory } from '../../common/types';
export declare abstract class HcmError extends Error {
    readonly correlationId: string;
    abstract readonly category: HcmErrorCategory;
    abstract readonly hcmErrorCode: string;
    constructor(message: string, correlationId: string);
}
export declare class HcmTransientError extends HcmError {
    readonly hcmErrorCode: string;
    readonly category = HcmErrorCategory.TRANSIENT;
    constructor(hcmErrorCode: string, message: string, correlationId: string);
}
export declare class HcmPermanentError extends HcmError {
    readonly hcmErrorCode: string;
    readonly category = HcmErrorCategory.PERMANENT;
    constructor(hcmErrorCode: string, message: string, correlationId: string);
}

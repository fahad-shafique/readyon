import { RequestStatus } from '../types';
export declare function isValidTransition(from: RequestStatus, to: RequestStatus): boolean;
export declare function assertValidTransition(from: RequestStatus, to: RequestStatus, requestId?: string): void;
export declare function isTerminalStatus(status: RequestStatus): boolean;
export declare function isHoldActiveStatus(status: RequestStatus): boolean;

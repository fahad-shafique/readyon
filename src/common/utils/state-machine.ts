import { RequestStatus } from '../types';
import { InvalidStateTransitionException } from '../exceptions';

const VALID_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.PENDING_APPROVAL]: [
    RequestStatus.APPROVED_PENDING_HCM,
    RequestStatus.REJECTED,
    RequestStatus.CANCELLED,
  ],
  [RequestStatus.APPROVED_PENDING_HCM]: [
    RequestStatus.APPROVED,
    RequestStatus.FAILED_HCM,
    RequestStatus.CANCELLED,
  ],
  [RequestStatus.APPROVED]: [RequestStatus.RECONCILIATION_REQUIRED, RequestStatus.CANCELLED],
  [RequestStatus.REJECTED]: [],
  [RequestStatus.CANCELLED]: [],
  [RequestStatus.FAILED_HCM]: [RequestStatus.RECONCILIATION_REQUIRED],
  [RequestStatus.RECONCILIATION_REQUIRED]: [RequestStatus.APPROVED, RequestStatus.CANCELLED],
};

export function isValidTransition(from: RequestStatus, to: RequestStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidTransition(from: RequestStatus, to: RequestStatus, requestId?: string): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidStateTransitionException(from, to, requestId);
  }
}

export function isTerminalStatus(status: RequestStatus): boolean {
  return [RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED].includes(status);
}

export function isHoldActiveStatus(status: RequestStatus): boolean {
  return [RequestStatus.PENDING_APPROVAL, RequestStatus.APPROVED_PENDING_HCM].includes(status);
}

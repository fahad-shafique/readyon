import { RequestStatus } from '../types';
import { isValidTransition, assertValidTransition, isTerminalStatus, isHoldActiveStatus } from './state-machine';
import { InvalidStateTransitionException } from '../exceptions';

describe('State Machine', () => {
  describe('isValidTransition', () => {
    // ─── Valid Transitions ────────────────────────────────────────
    const validTransitions: [RequestStatus, RequestStatus][] = [
      [RequestStatus.PENDING_APPROVAL, RequestStatus.APPROVED_PENDING_HCM],
      [RequestStatus.PENDING_APPROVAL, RequestStatus.REJECTED],
      [RequestStatus.PENDING_APPROVAL, RequestStatus.CANCELLED],
      [RequestStatus.APPROVED_PENDING_HCM, RequestStatus.APPROVED],
      [RequestStatus.APPROVED_PENDING_HCM, RequestStatus.FAILED_HCM],
      [RequestStatus.APPROVED_PENDING_HCM, RequestStatus.CANCELLED],
      [RequestStatus.APPROVED, RequestStatus.RECONCILIATION_REQUIRED],
      [RequestStatus.FAILED_HCM, RequestStatus.RECONCILIATION_REQUIRED],
      [RequestStatus.RECONCILIATION_REQUIRED, RequestStatus.APPROVED],
      [RequestStatus.RECONCILIATION_REQUIRED, RequestStatus.CANCELLED],
    ];

    it.each(validTransitions)('should allow %s → %s', (from, to) => {
      expect(isValidTransition(from, to)).toBe(true);
    });

    // ─── Invalid Transitions ──────────────────────────────────────
    const invalidTransitions: [RequestStatus, RequestStatus][] = [
      // Terminal states cannot transition (except APPROVED→RECONCILIATION)
      [RequestStatus.REJECTED, RequestStatus.PENDING_APPROVAL],
      [RequestStatus.REJECTED, RequestStatus.CANCELLED],
      [RequestStatus.CANCELLED, RequestStatus.PENDING_APPROVAL],
      [RequestStatus.CANCELLED, RequestStatus.APPROVED],
      // No backward transitions
      [RequestStatus.APPROVED_PENDING_HCM, RequestStatus.PENDING_APPROVAL],
      [RequestStatus.APPROVED, RequestStatus.APPROVED_PENDING_HCM],
      [RequestStatus.APPROVED, RequestStatus.PENDING_APPROVAL],
      // No skip transitions
      [RequestStatus.PENDING_APPROVAL, RequestStatus.APPROVED],
      [RequestStatus.PENDING_APPROVAL, RequestStatus.FAILED_HCM],
      // Self-transitions
      [RequestStatus.PENDING_APPROVAL, RequestStatus.PENDING_APPROVAL],
      [RequestStatus.APPROVED, RequestStatus.APPROVED],
    ];

    it.each(invalidTransitions)('should reject %s → %s', (from, to) => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  });

  describe('assertValidTransition', () => {
    it('should not throw for valid transitions', () => {
      expect(() =>
        assertValidTransition(RequestStatus.PENDING_APPROVAL, RequestStatus.APPROVED_PENDING_HCM),
      ).not.toThrow();
    });

    it('should throw InvalidStateTransitionException for invalid transitions', () => {
      expect(() =>
        assertValidTransition(RequestStatus.REJECTED, RequestStatus.APPROVED, 'req-123'),
      ).toThrow(InvalidStateTransitionException);
    });

    it('should include request ID in exception', () => {
      try {
        assertValidTransition(RequestStatus.REJECTED, RequestStatus.APPROVED, 'req-123');
        fail('Should have thrown');
      } catch (e: any) {
        expect(e.details.request_id).toBe('req-123');
        expect(e.details.current_status).toBe('REJECTED');
        expect(e.details.attempted_status).toBe('APPROVED');
      }
    });
  });

  describe('isTerminalStatus', () => {
    it('should return true for terminal states', () => {
      expect(isTerminalStatus(RequestStatus.APPROVED)).toBe(true);
      expect(isTerminalStatus(RequestStatus.REJECTED)).toBe(true);
      expect(isTerminalStatus(RequestStatus.CANCELLED)).toBe(true);
    });

    it('should return false for non-terminal states', () => {
      expect(isTerminalStatus(RequestStatus.PENDING_APPROVAL)).toBe(false);
      expect(isTerminalStatus(RequestStatus.APPROVED_PENDING_HCM)).toBe(false);
      expect(isTerminalStatus(RequestStatus.FAILED_HCM)).toBe(false);
      expect(isTerminalStatus(RequestStatus.RECONCILIATION_REQUIRED)).toBe(false);
    });
  });

  describe('isHoldActiveStatus', () => {
    it('should return true for hold-active states', () => {
      expect(isHoldActiveStatus(RequestStatus.PENDING_APPROVAL)).toBe(true);
      expect(isHoldActiveStatus(RequestStatus.APPROVED_PENDING_HCM)).toBe(true);
    });

    it('should return false for non-hold-active states', () => {
      expect(isHoldActiveStatus(RequestStatus.APPROVED)).toBe(false);
      expect(isHoldActiveStatus(RequestStatus.REJECTED)).toBe(false);
      expect(isHoldActiveStatus(RequestStatus.CANCELLED)).toBe(false);
    });
  });
});

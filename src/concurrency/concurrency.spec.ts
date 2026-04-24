import { createTestContext, cleanupTestContext, TestContext } from '../test-utils/test-helper';
import { RequestStatus, HoldStatus } from '../common/types';

describe('Concurrency & Balance Invariant Tests', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  // ─── Balance Invariant: effective_available never goes negative ────

  describe('Balance Invariant: No Overbooking', () => {
    it('should prevent overbooking with multiple simultaneous requests', () => {
      // Setup: employee with exactly 40h available
      ctx.balanceRepo.create({
        employeeId: 'conc-001',
        leaveType: 'PTO',
        location: 'HQ',
        totalBalance: 40,
        usedBalance: 0,
        hcmVersion: '2026-01-01T00:00:00Z',
      });

      ctx.mockHcm.setBalance('conc-001', 'PTO', {
        total_balance: 40,
        used_balance: 0,
        hcm_version: '2026-01-01T00:00:00Z',
      });

      // Create first request for 24h — should succeed
      const req1 = ctx.requestService.createRequest('conc-001', {
        leave_type: 'PTO',
        start_date: '2027-06-01',
        end_date: '2027-06-03',
        hours_requested: 24,
      });
      expect(req1.status).toBe(RequestStatus.PENDING_APPROVAL);

      // Create second request for 16h — should succeed (24 + 16 = 40 = total)
      const req2 = ctx.requestService.createRequest('conc-001', {
        leave_type: 'PTO',
        start_date: '2027-07-01',
        end_date: '2027-07-02',
        hours_requested: 16,
      });
      expect(req2.status).toBe(RequestStatus.PENDING_APPROVAL);

      // Create third request for 1h — should FAIL (would exceed 40h)
      expect(() =>
        ctx.requestService.createRequest('conc-001', {
          leave_type: 'PTO',
          start_date: '2027-08-01',
          end_date: '2027-08-01',
          hours_requested: 1,
        }),
      ).toThrow();

      // Verify effective available is exactly 0
      const effective = ctx.balanceRepo.getEffectiveAvailable('conc-001', 'PTO', 'HQ');
      expect(effective).toBe(0);
    });

    it('should restore balance when requests are cancelled', () => {
      ctx.balanceRepo.create({
        employeeId: 'conc-002',
        leaveType: 'PTO',
        location: 'HQ',
        totalBalance: 40,
        usedBalance: 0,
        hcmVersion: '2026-01-01T00:00:00Z',
      });

      // Create and cancel a request
      const req = ctx.requestService.createRequest('conc-002', {
        leave_type: 'PTO',
        start_date: '2027-06-10',
        end_date: '2027-06-12',
        hours_requested: 24,
      });

      expect(ctx.balanceRepo.getEffectiveAvailable('conc-002', 'PTO', 'HQ')).toBe(16);

      ctx.requestService.cancelRequest(req.id, 'conc-002', {
        version: req.version,
      });

      // Balance should be fully restored
      expect(ctx.balanceRepo.getEffectiveAvailable('conc-002', 'PTO', 'HQ')).toBe(40);
    });
  });

  // ─── Optimistic Locking ─────────────────────────────────────────────

  describe('Optimistic Locking', () => {
    it('should reject stale version on cancel', () => {
      ctx.balanceRepo.create({
        employeeId: 'conc-003',
        leaveType: 'PTO',
        location: 'HQ',
        totalBalance: 80,
        usedBalance: 0,
        hcmVersion: '2026-01-01T00:00:00Z',
      });

      const req = ctx.requestService.createRequest('conc-003', {
        leave_type: 'PTO',
        start_date: '2027-06-15',
        end_date: '2027-06-15',
        hours_requested: 8,
      });

      // Cancel with correct version
      ctx.requestService.cancelRequest(req.id, 'conc-003', {
        version: req.version,
      });

      // Try to cancel again with old version — should fail (already cancelled)
      expect(() =>
        ctx.requestService.cancelRequest(req.id, 'conc-003', {
          version: req.version, // stale now
        }),
      ).toThrow();
    });

    it('should reject stale version on approve', () => {
      ctx.balanceRepo.create({
        employeeId: 'conc-004',
        leaveType: 'PTO',
        location: 'HQ',
        totalBalance: 80,
        usedBalance: 0,
        hcmVersion: '2026-01-01T00:00:00Z',
      });

      ctx.mockHcm.setBalance('conc-004', 'PTO', {
        total_balance: 80,
        used_balance: 0,
        hcm_version: '2026-01-01T00:00:00Z',
      });

      const req = ctx.requestService.createRequest('conc-004', {
        leave_type: 'PTO',
        start_date: '2027-06-20',
        end_date: '2027-06-20',
        hours_requested: 8,
      });

      // Approve with stale version
      expect(() =>
        ctx.requestService.approveRequest(req.id, 'mgr-001', {
          version: req.version + 99,
        }),
      ).toThrow();
    });
  });

  // ─── Hold Lifecycle ─────────────────────────────────────────────────

  describe('Hold Lifecycle', () => {
    it('should track hold through full lifecycle: ACTIVE → CONVERTED', async () => {
      ctx.balanceRepo.create({
        employeeId: 'hold-001',
        leaveType: 'PTO',
        location: 'HQ',
        totalBalance: 80,
        usedBalance: 0,
        hcmVersion: '2026-01-01T00:00:00Z',
      });

      ctx.mockHcm.setBalance('hold-001', 'PTO', {
        total_balance: 80,
        used_balance: 0,
        hcm_version: '2026-01-01T00:00:00Z',
      });

      // Create → ACTIVE hold
      const req = ctx.requestService.createRequest('hold-001', {
        leave_type: 'PTO',
        start_date: '2027-06-25',
        end_date: '2027-06-25',
        hours_requested: 8,
      });

      let hold = ctx.holdRepo.findByRequestId(req.id);
      expect(hold!.status).toBe(HoldStatus.ACTIVE);

      // Approve → still ACTIVE hold
      ctx.requestService.approveRequest(req.id, 'mgr-001', {
        version: req.version,
      });

      hold = ctx.holdRepo.findByRequestId(req.id);
      expect(hold!.status).toBe(HoldStatus.ACTIVE);

      // Process outbox → CONVERTED hold
      await ctx.outboxProcessor.sweep();

      hold = ctx.holdRepo.findByRequestId(req.id);
      expect(hold!.status).toBe(HoldStatus.CONVERTED);
    });

    it('should track hold through cancel: ACTIVE → RELEASED', () => {
      ctx.balanceRepo.create({
        employeeId: 'hold-002',
        leaveType: 'PTO',
        location: 'HQ',
        totalBalance: 80,
        usedBalance: 0,
        hcmVersion: '2026-01-01T00:00:00Z',
      });

      const req = ctx.requestService.createRequest('hold-002', {
        leave_type: 'PTO',
        start_date: '2027-06-28',
        end_date: '2027-06-28',
        hours_requested: 8,
      });

      let hold = ctx.holdRepo.findByRequestId(req.id);
      expect(hold!.status).toBe(HoldStatus.ACTIVE);

      ctx.requestService.cancelRequest(req.id, 'hold-002', {
        version: req.version,
      });

      hold = ctx.holdRepo.findByRequestId(req.id);
      expect(hold!.status).toBe(HoldStatus.RELEASED);
    });
  });

  // ─── Approval Revalidation ──────────────────────────────────────────

  describe('Approval Revalidation', () => {
    it('should revalidate balance at approval time', () => {
      ctx.balanceRepo.create({
        employeeId: 'reval-001',
        leaveType: 'PTO',
        location: 'HQ',
        totalBalance: 16,
        usedBalance: 0,
        hcmVersion: '2026-01-01T00:00:00Z',
      });

      ctx.mockHcm.setBalance('reval-001', 'PTO', {
        total_balance: 16,
        used_balance: 0,
        hcm_version: '2026-01-01T00:00:00Z',
      });

      // Create two requests that together exhaust balance
      const req1 = ctx.requestService.createRequest('reval-001', {
        leave_type: 'PTO',
        start_date: '2027-07-01',
        end_date: '2027-07-01',
        hours_requested: 8,
      });

      const req2 = ctx.requestService.createRequest('reval-001', {
        leave_type: 'PTO',
        start_date: '2027-07-10',
        end_date: '2027-07-10',
        hours_requested: 8,
      });

      // Approve first — should work
      ctx.requestService.approveRequest(req1.id, 'mgr-001', {
        version: req1.version,
      });

      // Approve second — should also work (each has its own hold, and
      // the revalidation excludes the approving request's own hold)
      ctx.requestService.approveRequest(req2.id, 'mgr-001', {
        version: req2.version,
      });
    });
  });
});

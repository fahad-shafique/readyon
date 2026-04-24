import { createTestContext, seedTestData, cleanupTestContext, TestContext } from '../test-utils/test-helper';
import { RequestStatus, HoldStatus } from '../common/types';

describe('Request Lifecycle (Integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    seedTestData(ctx);
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  // ─── CREATE ─────────────────────────────────────────────────────────

  describe('Create Request', () => {
    it('should create a request and hold', () => {
      const result = ctx.requestService.createRequest('emp-001', {
        leave_type: 'PTO',
        start_date: '2026-12-01',
        end_date: '2026-12-02',
        hours_requested: 16,
        reason: 'Vacation',
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe(RequestStatus.PENDING_APPROVAL);
      expect(result.hold_id).toBeDefined();
      expect(result.hours_requested).toBe(16);

      // Verify hold was created
      const hold = ctx.holdRepo.findByRequestId(result.id);
      expect(hold).toBeDefined();
      expect(hold!.hold_amount).toBe(16);
      expect(hold!.status).toBe(HoldStatus.ACTIVE);

      // Verify effective available decreased
      const effective = ctx.balanceRepo.getEffectiveAvailable('emp-001', 'PTO', 'HQ');
      expect(effective).toBe(120 - 16); // 104
    });

    it('should reject if insufficient balance', () => {
      expect(() =>
        ctx.requestService.createRequest('emp-001', {
          leave_type: 'PTO',
          start_date: '2026-12-10',
          end_date: '2026-12-30',
          hours_requested: 200, // More than available
          location: 'HQ',
        }),
      ).toThrow();
    });

    it('should reject overlapping requests', () => {
      expect(() =>
        ctx.requestService.createRequest('emp-001', {
          leave_type: 'PTO',
          start_date: '2026-12-01', // Overlaps with first request
          end_date: '2026-12-02',
          hours_requested: 8,
        }),
      ).toThrow();
    });

    it('should reject past dates', () => {
      expect(() =>
        ctx.requestService.createRequest('emp-001', {
          leave_type: 'PTO',
          start_date: '2020-01-01',
          end_date: '2020-01-02',
          hours_requested: 8,
        }),
      ).toThrow();
    });

    it('should reject end_date before start_date', () => {
      expect(() =>
        ctx.requestService.createRequest('emp-001', {
          leave_type: 'PTO',
          start_date: '2026-12-05',
          end_date: '2026-12-03',
          hours_requested: 8,
        }),
      ).toThrow();
    });
  });

  // ─── CANCEL ─────────────────────────────────────────────────────────

  describe('Cancel Request', () => {
    it('should cancel a pending request and release hold', () => {
      const created = ctx.requestService.createRequest('emp-001', {
        leave_type: 'SICK',
        start_date: '2026-11-10',
        end_date: '2026-11-10',
        hours_requested: 8,
      });

      const effectiveBefore = ctx.balanceRepo.getEffectiveAvailable('emp-001', 'SICK', 'HQ');

      const result = ctx.requestService.cancelRequest(created.id, 'emp-001', {
        version: created.version,
        reason: 'Changed plans',
      });

      expect(result.status).toBe(RequestStatus.CANCELLED);
      expect(result.hold_status).toBe('RELEASED');

      // Verify hold released
      const hold = ctx.holdRepo.findByRequestId(created.id);
      expect(hold!.status).toBe(HoldStatus.RELEASED);

      // Verify balance restored
      const effectiveAfter = ctx.balanceRepo.getEffectiveAvailable('emp-001', 'SICK', 'HQ');
      expect(effectiveAfter).toBe(effectiveBefore + 8);
    });

    it('should reject cancel for wrong employee', () => {
      const created = ctx.requestService.createRequest('emp-002', {
        leave_type: 'PTO',
        start_date: '2026-11-15',
        end_date: '2026-11-15',
        hours_requested: 8,
      });

      expect(() =>
        ctx.requestService.cancelRequest(created.id, 'emp-001', {
          version: created.version,
        }),
      ).toThrow();
    });

    it('should reject cancel with stale version', () => {
      const created = ctx.requestService.createRequest('emp-001', {
        leave_type: 'PTO',
        start_date: '2026-11-20',
        end_date: '2026-11-20',
        hours_requested: 8,
      });

      expect(() =>
        ctx.requestService.cancelRequest(created.id, 'emp-001', {
          version: created.version + 99,
        }),
      ).toThrow();
    });
  });

  // ─── APPROVE ────────────────────────────────────────────────────────

  describe('Approve Request', () => {
    it('should approve a request and create outbox entry', () => {
      const created = ctx.requestService.createRequest('emp-001', {
        leave_type: 'PTO',
        start_date: '2026-12-15',
        end_date: '2026-12-15',
        hours_requested: 8,
      });

      const result = ctx.requestService.approveRequest(created.id, 'manager-001', {
        version: created.version,
      });

      expect(result.status).toBe(RequestStatus.APPROVED_PENDING_HCM);
      expect(result.outbox_id).toBeDefined();

      // Verify outbox entry created
      const outbox = ctx.outboxRepo.findById(result.outbox_id);
      expect(outbox).toBeDefined();
      expect(outbox!.request_id).toBe(created.id);
      expect(outbox!.action).toBe('POST_TIME_OFF');
      expect(outbox!.status).toBe('PENDING');
    });
  });

  // ─── REJECT ─────────────────────────────────────────────────────────

  describe('Reject Request', () => {
    it('should reject and release hold', () => {
      const created = ctx.requestService.createRequest('emp-001', {
        leave_type: 'PTO',
        start_date: '2026-12-20',
        end_date: '2026-12-20',
        hours_requested: 8,
      });

      const result = ctx.requestService.rejectRequest(created.id, 'manager-001', {
        version: created.version,
        rejection_reason: 'Team coverage issue',
      });

      expect(result.status).toBe(RequestStatus.REJECTED);
      expect(result.hold_status).toBe('RELEASED');
      expect(result.rejection_reason).toBe('Team coverage issue');

      // Verify hold released
      const hold = ctx.holdRepo.findByRequestId(created.id);
      expect(hold!.status).toBe(HoldStatus.RELEASED);
    });

    it('should require rejection reason', () => {
      const created = ctx.requestService.createRequest('emp-001', {
        leave_type: 'PTO',
        start_date: '2026-12-22',
        end_date: '2026-12-22',
        hours_requested: 8,
      });

      expect(() =>
        ctx.requestService.rejectRequest(created.id, 'manager-001', {
          version: created.version,
          rejection_reason: '',
        }),
      ).toThrow();
    });
  });

  // ─── QUERY ──────────────────────────────────────────────────────────

  describe('Query Requests', () => {
    it('should list requests with pagination', () => {
      const result = ctx.requestService.listRequests('emp-001', {}, undefined, 5);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.pagination).toBeDefined();
      expect(result.pagination.limit).toBe(5);
    });

    it('should filter by status', () => {
      const result = ctx.requestService.listRequests('emp-001', {
        status: RequestStatus.CANCELLED,
      });
      for (const req of result.data) {
        expect(req.status).toBe(RequestStatus.CANCELLED);
      }
    });
  });
});

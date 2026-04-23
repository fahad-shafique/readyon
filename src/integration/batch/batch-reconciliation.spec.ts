import { createTestContext, cleanupTestContext, TestContext } from '../../test-utils/test-helper';

describe('Batch Sync & Reconciliation (Integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  // ─── Batch Sync ─────────────────────────────────────────────────────

  describe('Batch Sync', () => {
    it('should create new balance projections for unknown employees', () => {
      const result = ctx.batchSyncService.processBatch('batch-001', [
        {
          employee_id: 'batch-emp-001',
          leave_type: 'PTO',
          total_balance: 120,
          used_balance: 16,
          hcm_version: '2026-06-01T00:00:00Z',
        },
      ]);

      expect(result.status).toBe('COMPLETED');
      expect(result.processed_items).toBe(1);

      const balance = ctx.balanceRepo.findByEmployeeAndType('batch-emp-001', 'PTO');
      expect(balance).toBeDefined();
      expect(balance!.total_balance).toBe(120);
      expect(balance!.used_balance).toBe(16);
    });

    it('should update existing balances when version is newer', () => {
      const result = ctx.batchSyncService.processBatch('batch-002', [
        {
          employee_id: 'batch-emp-001',
          leave_type: 'PTO',
          total_balance: 120,
          used_balance: 24,
          hcm_version: '2026-07-01T00:00:00Z', // newer version
        },
      ]);

      expect(result.processed_items).toBe(1);

      const balance = ctx.balanceRepo.findByEmployeeAndType('batch-emp-001', 'PTO');
      expect(balance!.used_balance).toBe(24);
    });

    it('should skip stale batch items (older version)', () => {
      const result = ctx.batchSyncService.processBatch('batch-003', [
        {
          employee_id: 'batch-emp-001',
          leave_type: 'PTO',
          total_balance: 100,
          used_balance: 0,
          hcm_version: '2025-01-01T00:00:00Z', // older version
        },
      ]);

      expect(result.skipped_items).toBe(1);

      // Balance should NOT have changed
      const balance = ctx.balanceRepo.findByEmployeeAndType('batch-emp-001', 'PTO');
      expect(balance!.used_balance).toBe(24); // unchanged from batch-002
    });

    it('should reject duplicate batch IDs', () => {
      expect(() =>
        ctx.batchSyncService.processBatch('batch-001', [
          {
            employee_id: 'batch-emp-002',
            leave_type: 'PTO',
            total_balance: 80,
            used_balance: 0,
            hcm_version: '2026-06-01T00:00:00Z',
          },
        ]),
      ).toThrow();
    });

    it('should handle mixed results in a batch', () => {
      // First create a known employee
      ctx.balanceRepo.create({
        employeeId: 'batch-emp-003',
        leaveType: 'PTO',
        totalBalance: 80,
        usedBalance: 0,
        hcmVersion: '2026-06-01T00:00:00Z',
      });

      const result = ctx.batchSyncService.processBatch('batch-004', [
        {
          // New employee — CREATED
          employee_id: 'batch-emp-004',
          leave_type: 'PTO',
          total_balance: 60,
          used_balance: 0,
          hcm_version: '2026-06-01T00:00:00Z',
        },
        {
          // Existing with newer version — UPDATED
          employee_id: 'batch-emp-003',
          leave_type: 'PTO',
          total_balance: 80,
          used_balance: 8,
          hcm_version: '2026-07-01T00:00:00Z',
        },
        {
          // Existing with stale version — SKIPPED
          employee_id: 'batch-emp-001',
          leave_type: 'PTO',
          total_balance: 999,
          used_balance: 999,
          hcm_version: '2020-01-01T00:00:00Z',
        },
      ]);

      expect(result.total_items).toBe(3);
      expect(result.processed_items).toBe(2); // created + updated
      expect(result.skipped_items).toBe(1);   // stale
    });
  });

  // ─── Reconciliation ─────────────────────────────────────────────────

  describe('Reconciliation', () => {
    it('should detect no drift when HCM and local match', async () => {
      ctx.balanceRepo.create({
        employeeId: 'recon-001',
        leaveType: 'PTO',
        totalBalance: 100,
        usedBalance: 20,
        hcmVersion: '2026-01-01T00:00:00Z',
      });

      ctx.mockHcm.setBalance('recon-001', 'PTO', {
        total_balance: 100,
        used_balance: 20,
        hcm_version: '2026-02-01T00:00:00Z',
      });

      const result = await ctx.reconciliationService.reconcileOne('recon-001', 'PTO');
      expect(result).toBe('OK');
    });

    it('should auto-repair small drift', async () => {
      ctx.balanceRepo.create({
        employeeId: 'recon-002',
        leaveType: 'PTO',
        totalBalance: 100,
        usedBalance: 20,
        hcmVersion: '2026-01-01T00:00:00Z',
      });

      // HCM has slightly different used_balance (drift of 4h < 8h threshold)
      ctx.mockHcm.setBalance('recon-002', 'PTO', {
        total_balance: 100,
        used_balance: 24,
        hcm_version: '2026-02-01T00:00:00Z',
      });

      const result = await ctx.reconciliationService.reconcileOne('recon-002', 'PTO');
      expect(result).toBe('REPAIRED');

      // Local should now match HCM
      const balance = ctx.balanceRepo.findByEmployeeAndType('recon-002', 'PTO');
      expect(balance!.used_balance).toBe(24);
    });

    it('should flag large drift for manual review', async () => {
      ctx.balanceRepo.create({
        employeeId: 'recon-003',
        leaveType: 'PTO',
        totalBalance: 100,
        usedBalance: 20,
        hcmVersion: '2026-01-01T00:00:00Z',
      });

      // HCM has major drift (40h > 8h threshold)
      ctx.mockHcm.setBalance('recon-003', 'PTO', {
        total_balance: 100,
        used_balance: 60,
        hcm_version: '2026-02-01T00:00:00Z',
      });

      const result = await ctx.reconciliationService.reconcileOne('recon-003', 'PTO');
      expect(result).toBe('FLAGGED');
    });
  });
});

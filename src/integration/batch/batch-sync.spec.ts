import { createTestContext, seedTestData, cleanupTestContext, TestContext } from '../../test-utils/test-helper';
import { RequestStatus } from '../../common/types';

describe('BatchSyncService (Integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    seedTestData(ctx);
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  describe('processBatch', () => {
    it('should update balance and log audit', () => {
      const batchId = 'batch-001';
      const items = [{
        employee_id: 'emp-001',
        leave_type: 'PTO',
        total_balance: 150,
        used_balance: 10,
        hcm_version: '2026-02-01T00:00:00Z',
      }];

      const result = ctx.batchSyncService.processBatch(batchId, items);

      expect(result.processed_items).toBe(1);
      expect(result.status).toBe('COMPLETED');

      const balance = ctx.balanceRepo.findByEmployeeAndType('emp-001', 'PTO', 'HQ');
      expect(balance!.total_balance).toBe(150);
      expect(balance!.hcm_version).toBe('2026-02-01T00:00:00Z');
    });

    it('should flag requests for reconciliation if holds exceed available', () => {
      // 1. Create a request and hold for 100 hours
      const created = ctx.requestService.createRequest('emp-001', {
        leave_type: 'PTO',
        start_date: '2027-01-01',
        end_date: '2027-01-15',
        hours_requested: 100,
      });

      // Current balance is 150 (from previous test). 
      // 2. Process batch that reduces balance to 80.
      // 100 held > 80 available -> should flag RECONCILIATION_REQUIRED
      const result = ctx.batchSyncService.processBatch('batch-overflow', [{
        employee_id: 'emp-001',
        leave_type: 'PTO',
        total_balance: 80,
        used_balance: 0,
        hcm_version: '2026-03-01T00:00:00Z',
      }]);

      expect(result.processed_items).toBe(1);
      
      const request = ctx.requestRepo.findById(created.id);
      expect(request!.status).toBe(RequestStatus.RECONCILIATION_REQUIRED);
    });

    it('should skip stale updates', () => {
      const result = ctx.batchSyncService.processBatch('batch-stale', [{
        employee_id: 'emp-001',
        leave_type: 'PTO',
        total_balance: 500,
        used_balance: 0,
        hcm_version: '2020-01-01T00:00:00Z', // Very old
      }]);

      expect(result.skipped_items).toBe(1);
      expect(result.processed_items).toBe(0);
    });

    it('should reject duplicate batches', () => {
      expect(() => ctx.batchSyncService.processBatch('batch-001', [])).toThrow();
    });
  });

  describe('pullFromHcm', () => {
    it('should pull items and update checkpoint', async () => {
      // Use a past hcm_version so the checkpoint written after this pull
      // will be >= it, guaranteeing the second pull sees an empty feed.
      ctx.mockHcm.setBalance('emp-999', 'PTO', {
        total_balance: 200,
        used_balance: 0,
        hcm_version: '2024-01-01T00:00:00Z',
      });

      const result = await ctx.batchSyncService.pullFromHcm();
      expect(result).not.toBeNull();
      expect(result!.processed_items).toBeGreaterThan(0);

      // Verify checkpoint in DB was advanced beyond the epoch default
      const db = ctx.dbService.getDb();
      const row = db.prepare("SELECT value FROM sync_checkpoints WHERE key = 'hcm_batch_checkpoint'").get() as any;
      expect(row.value).not.toBe('1970-01-01T00:00:00Z');
    });

    it('should handle empty responses', async () => {
      // At this point the checkpoint in the DB is ~now (set by the previous test).
      // All mock HCM balances have hcm_version values older than that checkpoint,
      // so getBatchBalances returns an empty items array → pullFromHcm returns null.
      const result = await ctx.batchSyncService.pullFromHcm();
      expect(result).toBeNull();
    });
  });
});

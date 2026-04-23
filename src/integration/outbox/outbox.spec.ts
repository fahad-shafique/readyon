import { createTestContext, seedTestData, cleanupTestContext, TestContext } from '../../test-utils/test-helper';
import { RequestStatus, HoldStatus } from '../../common/types';

describe('Outbox Processor (Integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    seedTestData(ctx);
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('should process outbox entry and transition to APPROVED', async () => {
    // Create and approve a request
    const created = ctx.requestService.createRequest('emp-001', {
      leave_type: 'PTO',
      start_date: '2027-01-15',
      end_date: '2027-01-15',
      hours_requested: 8,
    });

    const approved = ctx.requestService.approveRequest(created.id, 'manager-001', {
      version: created.version,
    });

    const balanceBefore = ctx.balanceRepo.findByEmployeeAndType('emp-001', 'PTO');

    // Process outbox
    const processed = await ctx.outboxProcessor.sweep();
    expect(processed).toBeGreaterThanOrEqual(1);

    // Verify request is now APPROVED
    const request = ctx.requestRepo.findById(created.id);
    expect(request!.status).toBe(RequestStatus.APPROVED);
    expect(request!.hcm_reference_id).toBeDefined();

    // Verify hold is CONVERTED
    const hold = ctx.holdRepo.findByRequestId(created.id);
    expect(hold!.status).toBe(HoldStatus.CONVERTED);

    // Verify outbox is COMPLETED
    const outbox = ctx.outboxRepo.findById(approved.outbox_id);
    expect(outbox!.status).toBe('COMPLETED');

    // Verify balance deducted
    const balanceAfter = ctx.balanceRepo.findByEmployeeAndType('emp-001', 'PTO');
    expect(balanceAfter!.used_balance).toBe(balanceBefore!.used_balance + 8);

    // Verify mock HCM tracked the deduction
    const deductions = ctx.mockHcm.getDeductions();
    expect(deductions.some((d) => d.employee_id === 'emp-001' && d.hours === 8)).toBe(true);
  });

  it('should handle transient HCM failure and retry', async () => {
    const created = ctx.requestService.createRequest('emp-001', {
      leave_type: 'PTO',
      start_date: '2027-02-01',
      end_date: '2027-02-01',
      hours_requested: 8,
    });

    ctx.requestService.approveRequest(created.id, 'manager-001', {
      version: created.version,
    });

    // Inject transient failure for next call
    ctx.mockHcm.addFailure({
      mode: 'transient',
      countdown: 0,
      failureCount: 1,
      operation: 'postTimeOff',
      employeeId: null,
    });

    // First sweep — should fail, mark for retry
    await ctx.outboxProcessor.sweep();

    // Request should still be APPROVED_PENDING_HCM
    let request = ctx.requestRepo.findById(created.id);
    expect(request!.status).toBe(RequestStatus.APPROVED_PENDING_HCM);

    // Wait briefly, then mark next_retry_at to now for testing
    const outboxEntries = ctx.dbService.getDb()
      .prepare(`SELECT id FROM integration_outbox WHERE request_id = ? AND status = 'PENDING'`)
      .all(created.id) as any[];

    if (outboxEntries.length > 0) {
      ctx.dbService.getDb()
        .prepare(`UPDATE integration_outbox SET next_retry_at = datetime('now', '-1 second') WHERE id = ?`)
        .run(outboxEntries[0].id);
    }

    // Second sweep — should succeed (failure was one-shot)
    await ctx.outboxProcessor.sweep();

    request = ctx.requestRepo.findById(created.id);
    expect(request!.status).toBe(RequestStatus.APPROVED);
  });

  it('should handle permanent HCM failure and transition to FAILED_HCM', async () => {
    const created = ctx.requestService.createRequest('emp-001', {
      leave_type: 'PTO',
      start_date: '2027-03-01',
      end_date: '2027-03-01',
      hours_requested: 8,
    });

    ctx.requestService.approveRequest(created.id, 'manager-001', {
      version: created.version,
    });

    // Inject permanent failure
    ctx.mockHcm.addFailure({
      mode: 'permanent',
      countdown: 0,
      failureCount: 1,
      operation: 'postTimeOff',
      employeeId: null,
    });

    await ctx.outboxProcessor.sweep();

    // Request should be FAILED_HCM
    const request = ctx.requestRepo.findById(created.id);
    expect(request!.status).toBe(RequestStatus.FAILED_HCM);

    // Hold should be RELEASED (not converted)
    const hold = ctx.holdRepo.findByRequestId(created.id);
    expect(hold!.status).toBe(HoldStatus.RELEASED);
  });

  it('should handle idempotent HCM responses', async () => {
    const statsBefore = ctx.mockHcm.getStats();

    const created = ctx.requestService.createRequest('emp-001', {
      leave_type: 'PTO',
      start_date: '2027-04-01',
      end_date: '2027-04-01',
      hours_requested: 8,
    });

    ctx.requestService.approveRequest(created.id, 'manager-001', {
      version: created.version,
    });

    // Process — this creates the HCM record
    await ctx.outboxProcessor.sweep();

    const request = ctx.requestRepo.findById(created.id);
    expect(request!.status).toBe(RequestStatus.APPROVED);

    const statsAfter = ctx.mockHcm.getStats();
    expect(statsAfter.postTimeOffCalls).toBe(statsBefore.postTimeOffCalls + 1);
  });
});

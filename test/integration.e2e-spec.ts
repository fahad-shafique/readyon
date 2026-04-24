import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { DatabaseService } from './../src/database/database.service';
import { HCM_ADAPTER_PORT } from './../src/integration/hcm/hcm-adapter.port';
import { MockHcmAdapter } from './../src/integration/hcm/mock-hcm-adapter';
import { RequestStatus } from './../src/common/types';
import * as path from 'path';
import * as fs from 'fs';
import { OutboxProcessor } from './../src/integration/outbox/outbox.processor';

jest.setTimeout(60000);

describe('Integration Scenarios (e2e)', () => {
  let app: INestApplication;
  let dbService: DatabaseService;
  let hcmAdapter: MockHcmAdapter;
  let outboxProcessor: OutboxProcessor;
  const testDbPath = path.join(__dirname, 'test-readyon.db');

  const EMP = 'emp-1';
  const MANAGER_ID = 'manager-1';
  const LEAVE_TYPE = 'PTO';

  beforeAll(async () => {
    // Ensure fresh DB file for each test suite run
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    process.env.DB_PATH = testDbPath;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    dbService = app.get(DatabaseService);
    hcmAdapter = app.get(HCM_ADAPTER_PORT);
    outboxProcessor = app.get(OutboxProcessor);
  });

  afterAll(async () => {
    await app.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  beforeEach(async () => {
    // Clean state before each test
    dbService.resetDatabase();
    if (hcmAdapter instanceof MockHcmAdapter) {
      hcmAdapter.reset();
    }
  });

  async function seedBalance(empId: string, type: string, total: number, used: number, version = 'v1', location = 'HQ') {
    return request(app.getHttpServer())
      .post('/api/v1/integrations/hcm/balance-update')
      .set('Idempotency-Key', `seed-${empId}-${type}-${Date.now()}`)
      .send({
        employee_id: empId,
        leave_type: type,
        location,
        total_balance: total,
        used_balance: used,
        hcm_version: version,
      });
  }

  async function createRequest(empId: string, type: string, hours: number, date: string, idempotencyKey: string, location = 'HQ') {
    return request(app.getHttpServer())
      .post('/api/v1/employees/me/requests')
      .set('x-employee-id', empId)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        leave_type: type,
        hours_requested: hours,
        start_date: date,
        end_date: date,
        location,
      });
  }

  async function approveRequest(requestId: string, version: number, managerId: string, idempotencyKey: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/managers/me/requests/${requestId}/approve`)
      .set('x-employee-id', managerId)
      .set('Idempotency-Key', idempotencyKey)
      .send({ version });
  }

  describe('PHASE 1: Baseline & Standard Flows', () => {
    it('should complete full cycle: Create -> Approve -> Sync', async () => {
      // 1. Seed balance
      await seedBalance(EMP, LEAVE_TYPE, 40, 0);

      // 2. Create request
      const reqRes = await createRequest(EMP, LEAVE_TYPE, 8, '2027-01-01', 'base-req');
      expect(reqRes.status).toBe(201);
      const requestId = reqRes.body.data.id;

      // 3. Approve
      const appRes = await approveRequest(requestId, reqRes.body.data.version, MANAGER_ID, 'base-app');
      expect(appRes.status).toBe(200);
      expect(appRes.body.data.status).toBe(RequestStatus.APPROVED_PENDING_HCM);

      // 4. Manually trigger outbox sweep
      await outboxProcessor.sweep();

      const finalRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/me/requests/${requestId}`)
        .set('x-employee-id', EMP);
      
      expect(finalRes.body.data.status).toBe(RequestStatus.APPROVED);
    });
  });

  describe('PHASE 2: Edge Cases & Isolation', () => {
    it('should reconcile balance drift correctly', async () => {
      // Initial sync
      await request(app.getHttpServer())
        .post('/api/v1/integrations/hcm/batch-sync')
        .send({
          batch_id: 'drift-1',
          items: [{ employee_id: EMP, leave_type: LEAVE_TYPE, total_balance: 40, used_balance: 0, hcm_version: 'v1' }]
        });

      // Create request (8h hold)
      await createRequest(EMP, LEAVE_TYPE, 8, '2027-01-01', 'drift-req');

      // Second sync with different balance (20h total)
      await request(app.getHttpServer())
        .post('/api/v1/integrations/hcm/batch-sync')
        .send({
          batch_id: 'drift-2',
          items: [{ employee_id: EMP, leave_type: LEAVE_TYPE, total_balance: 20, used_balance: 0, hcm_version: 'v2' }]
        });

      // Effective available should be 20 - 8 = 12
      const balRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/me/balances?leave_type=${LEAVE_TYPE}`)
        .set('x-employee-id', EMP);
      
      expect(balRes.body.data[0].effective_available).toBe(12);
    });

    it('should prevent older batches from overwriting newer ones', async () => {
      // Sync newer version first
      await request(app.getHttpServer())
        .post('/api/v1/integrations/hcm/batch-sync')
        .send({
          batch_id: 'b2',
          items: [{ employee_id: EMP, leave_type: LEAVE_TYPE, total_balance: 50, used_balance: 0, hcm_version: '2027-01-02T00:00:00Z' }]
        });

      // Sync older version
      await request(app.getHttpServer())
        .post('/api/v1/integrations/hcm/batch-sync')
        .send({
          batch_id: 'b1',
          items: [{ employee_id: EMP, leave_type: LEAVE_TYPE, total_balance: 30, used_balance: 0, hcm_version: '2027-01-01T00:00:00Z' }]
        });

      const balRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/me/balances?leave_type=${LEAVE_TYPE}`)
        .set('x-employee-id', EMP);
      
      expect(balRes.body.data[0].total_balance).toBe(50);
    });

    it('should isolate balances by location', async () => {
      // Sync balance for HQ
      await seedBalance(EMP, LEAVE_TYPE, 40, 0, 'v1', 'HQ');

      // Create request for Branch-A (should fail or be separate)
      const reqRes = await createRequest(EMP, LEAVE_TYPE, 8, '2027-01-01', 'loc-req', 'Branch-A');
      
      // In current impl, it should fail with 404 because no balance found for Branch-A
      expect(reqRes.status).toBe(404);
    });

    it('should isolate balances by leave type', async () => {
      await seedBalance(EMP, 'PTO', 40, 0);
      await seedBalance(EMP, 'SICK', 10, 0);

      // Request SICK leave
      await createRequest(EMP, 'SICK', 8, '2027-01-01', 'sick-req');

      // PTO balance should remain 40
      const balRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/me/balances?leave_type=PTO`)
        .set('x-employee-id', EMP);
      
      expect(balRes.body.data[0].effective_available).toBe(40);
    });
  });

  describe('PHASE 3: Failure & Rollback', () => {
    it('should transition to FAILED_HCM and release hold on permanent failure', async () => {
      await seedBalance(EMP, LEAVE_TYPE, 20, 0);

      const reqRes = await createRequest(EMP, LEAVE_TYPE, 8, '2027-02-01', 'fail-req');
      const requestId = reqRes.body.data.id;

      // Inject permanent failure
      await request(app.getHttpServer())
        .post('/api/v1/integrations/hcm/mock-failures')
        .send({ mode: 'permanent', operation: 'postTimeOff' });

      await approveRequest(requestId, reqRes.body.data.version, MANAGER_ID, 'fail-app');

      // Wait for outbox processing
      await outboxProcessor.sweep();

      const finalRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/me/requests/${requestId}`)
        .set('x-employee-id', EMP);
      
      expect(finalRes.body.data.status).toBe(RequestStatus.FAILED_HCM);

      // Verify balance hold was released (effective should be back to 20)
      const balRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/me/balances?leave_type=${LEAVE_TYPE}`)
        .set('x-employee-id', EMP);
      
      expect(balRes.body.data[0].effective_available).toBe(20);
    });

    it('should handle transient failures with retries and eventual success', async () => {
      await seedBalance(EMP, LEAVE_TYPE, 20, 0);
      const reqRes = await createRequest(EMP, LEAVE_TYPE, 4, '2027-02-10', 'retry-req');
      const requestId = reqRes.body.data.id;

      // Inject 2 transient failures (fail 2 times, then succeed)
      await request(app.getHttpServer())
        .post('/api/v1/integrations/hcm/mock-failures')
        .send({ mode: 'transient', countdown: 0, failureCount: 2, operation: 'postTimeOff' });

      await approveRequest(requestId, reqRes.body.data.version, MANAGER_ID, 'retry-app');

      // First sweep -> fails (transient)
      await outboxProcessor.sweep();
      // Bypass backoff delay for test speed
      dbService.getDb().prepare("UPDATE integration_outbox SET next_retry_at = NULL").run();
      
      let check = await request(app.getHttpServer()).get(`/api/v1/employees/me/requests/${requestId}`).set('x-employee-id', EMP);
      expect(check.body.data.status).toBe(RequestStatus.APPROVED_PENDING_HCM);

      // Second sweep -> fails (transient)
      await outboxProcessor.sweep();
      dbService.getDb().prepare("UPDATE integration_outbox SET next_retry_at = NULL").run();
      
      check = await request(app.getHttpServer()).get(`/api/v1/employees/me/requests/${requestId}`).set('x-employee-id', EMP);
      expect(check.body.data.status).toBe(RequestStatus.APPROVED_PENDING_HCM);

      // Third sweep -> succeeds
      await outboxProcessor.sweep();
      check = await request(app.getHttpServer()).get(`/api/v1/employees/me/requests/${requestId}`).set('x-employee-id', EMP);
      expect(check.body.data.status).toBe(RequestStatus.APPROVED);
    });

    it('should prevent HCM sync if local constraints are violated (Silent Failure Defense)', async () => {
      // Seed 10h
      await seedBalance(EMP, LEAVE_TYPE, 10, 0);

      // Attempt to request 20h (should be blocked by BalanceService)
      const reqRes = await createRequest(EMP, LEAVE_TYPE, 20, '2027-02-15', 'silent-req');
      expect(reqRes.status).toBe(409); // Insufficient balance is CONFLICT (409)
    });
  });

  describe('PHASE 4: Concurrency & Idempotency', () => {
    it('should enforce idempotency on request creation', async () => {
      await seedBalance(EMP, LEAVE_TYPE, 40, 0);
      const key = 'idem-key';

      const res1 = await createRequest(EMP, LEAVE_TYPE, 4, '2027-03-01', key);
      const res2 = await createRequest(EMP, LEAVE_TYPE, 4, '2027-03-01', key);

      expect(res1.body.data.id).toBe(res2.body.data.id);
      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
    });

    it('should prevent overbooking via concurrent requests', async () => {
      await seedBalance(EMP, LEAVE_TYPE, 10, 0);

      const agent = request(app.getHttpServer());

      // Fire 7 parallel requests. We use a small delay to avoid overwhelming the test server stack.
      const promises = Array.from({ length: 7 }).map(async (_, i) => {
        await new Promise(resolve => setTimeout(resolve, i * 10)); 
        return agent
          .post('/api/v1/employees/me/requests')
          .set('x-employee-id', EMP)
          .set('Idempotency-Key', `par-req-${i}`)
          .send({
            leave_type: LEAVE_TYPE,
            hours_requested: 2,
            start_date: `2027-06-${10+i}`,
            end_date: `2027-06-${10+i}`,
          });
      });

      const results = await Promise.all(promises);
      const successes = results.filter((r: any) => r.status === 201).length;

      expect(successes).toBe(5);
    });

    it('should handle out-of-order approvals correctly', async () => {
      await seedBalance(EMP, LEAVE_TYPE, 40, 0);

      // Create 2 requests
      const r1 = await createRequest(EMP, LEAVE_TYPE, 20, '2027-05-01', 'ooo-1');
      const r2 = await createRequest(EMP, LEAVE_TYPE, 20, '2027-05-05', 'ooo-2');

      // Approve R2 first
      await approveRequest(r2.body.data.id, r2.body.data.version, MANAGER_ID, 'ooo-app-2');
      
      // Approve R1
      await approveRequest(r1.body.data.id, r1.body.data.version, MANAGER_ID, 'ooo-app-1');

      await outboxProcessor.sweep();

      const balRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/me/balances?leave_type=${LEAVE_TYPE}`)
        .set('x-employee-id', EMP);
      
      // Both should succeed, used balance should be 40
      expect(balRes.body.data[0].used_balance).toBe(40);
    });
  });

  describe('PHASE 5: Lifecycle Edge Cases', () => {
    it('should allow cancellation after approval but before HCM sync', async () => {
      await seedBalance(EMP, LEAVE_TYPE, 40, 0);
      
      const reqRes = await createRequest(EMP, LEAVE_TYPE, 4, '2027-04-01', 'can-req');
      const requestId = reqRes.body.data.id;

      await approveRequest(requestId, reqRes.body.data.version, MANAGER_ID, 'can-app');

      // Cancel immediately
      const cancelRes = await request(app.getHttpServer())
        .post(`/api/v1/employees/me/requests/${requestId}/cancel`)
        .set('x-employee-id', EMP)
        .set('Idempotency-Key', 'can-can')
        .send({ version: reqRes.body.data.version + 1 });
      
      expect(cancelRes.status).toBe(200);
      
      const finalRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/me/requests/${requestId}`)
        .set('x-employee-id', EMP);
      
      expect(finalRes.body.data.status).toBe(RequestStatus.CANCELLED);
    });

    it('should allow cancellation after HCM sync and trigger compensating transaction', async () => {
      await seedBalance(EMP, LEAVE_TYPE, 40, 0);
      
      const reqRes = await createRequest(EMP, LEAVE_TYPE, 4, '2027-04-01', 'can-sync-req');
      expect(reqRes.status).toBe(201);
      const requestId = reqRes.body.data.id;

      await approveRequest(requestId, reqRes.body.data.version, MANAGER_ID, 'can-sync-app');

      // Wait for HCM sync
      await outboxProcessor.sweep();

      const syncRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/me/requests/${requestId}`)
        .set('x-employee-id', EMP);
      
      expect(syncRes.body.data.status).toBe(RequestStatus.APPROVED);

      // Cancel
      const cancelRes = await request(app.getHttpServer())
        .post(`/api/v1/employees/me/requests/${requestId}/cancel`)
        .set('x-employee-id', EMP)
        .set('Idempotency-Key', 'can-sync-can')
        .send({ version: syncRes.body.data.version });
      
      expect(cancelRes.status).toBe(200);

      // Verify status is CANCELLED locally
      const finalRes = await request(app.getHttpServer())
        .get(`/api/v1/employees/me/requests/${requestId}`)
        .set('x-employee-id', EMP);
      
      expect(finalRes.body.data.status).toBe(RequestStatus.CANCELLED);
    });
  });

  describe('PHASE 6: Observability', () => {
    it('should generate audit logs for key lifecycle events', async () => {
      await seedBalance(EMP, LEAVE_TYPE, 40, 0);
      const reqRes = await createRequest(EMP, LEAVE_TYPE, 4, '2027-09-01', 'audit-req');
      const requestId = reqRes.body.data.id;

      // Check audit logs (We don't have an endpoint, but we can check DB directly)
      const logs = dbService.getDb().prepare('SELECT * FROM audit_logs WHERE entity_id = ?').all(requestId);
      expect(logs.length).toBeGreaterThan(0);
      expect((logs[0] as any).action).toBe('CREATED');
    });
  });
});

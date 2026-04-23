import supertest from 'supertest';
import { createTestContext, seedTestData, cleanupTestContext, TestContext } from './test-utils/test-helper';
import { v4 as uuidv4 } from 'uuid';

describe('API E2E Tests', () => {
  let ctx: TestContext;
  let server: any;

  beforeAll(async () => {
    ctx = await createTestContext();
    seedTestData(ctx);
    server = ctx.app.getHttpServer();
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  // ─── Health Check ───────────────────────────────────────────────────

  describe('GET /api/v1/health', () => {
    it('should return healthy status', async () => {
      const res = await supertest(server).get('/api/v1/health').expect(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.checks.database).toBe('connected');
    });
  });

  // ─── Balance Endpoints ──────────────────────────────────────────────

  describe('GET /api/v1/employees/me/balances', () => {
    it('should return balances with effective_available', async () => {
      const res = await supertest(server)
        .get('/api/v1/employees/me/balances')
        .set('x-employee-id', 'emp-001')
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThan(0);

      const ptoBalance = res.body.data.find((b: any) => b.leave_type === 'PTO');
      expect(ptoBalance).toBeDefined();
      expect(ptoBalance.total_balance).toBe(120);
      expect(ptoBalance.effective_available).toBeDefined();
    });

    it('should filter by leave_type', async () => {
      const res = await supertest(server)
        .get('/api/v1/employees/me/balances?leave_type=SICK')
        .set('x-employee-id', 'emp-001')
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].leave_type).toBe('SICK');
    });

    it('should return 404 for unknown employee', async () => {
      await supertest(server)
        .get('/api/v1/employees/me/balances')
        .set('x-employee-id', 'emp-unknown')
        .expect(404);
    });
  });

  // ─── Request CRUD ───────────────────────────────────────────────────

  describe('POST /api/v1/employees/me/requests', () => {
    it('should create request with 201', async () => {
      const res = await supertest(server)
        .post('/api/v1/employees/me/requests')
        .set('x-employee-id', 'emp-001')
        .set('Idempotency-Key', uuidv4())
        .send({
          leave_type: 'PTO',
          start_date: '2027-06-01',
          end_date: '2027-06-02',
          hours_requested: 16,
          reason: 'Summer vacation',
        })
        .expect(201);

      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.status).toBe('PENDING_APPROVAL');
      expect(res.body.data.hold_id).toBeDefined();
    });

    it('should return same response for duplicate idempotency key', async () => {
      const key = uuidv4();

      const res1 = await supertest(server)
        .post('/api/v1/employees/me/requests')
        .set('x-employee-id', 'emp-001')
        .set('Idempotency-Key', key)
        .send({
          leave_type: 'PTO',
          start_date: '2027-07-01',
          end_date: '2027-07-01',
          hours_requested: 8,
        })
        .expect(201);

      const res2 = await supertest(server)
        .post('/api/v1/employees/me/requests')
        .set('x-employee-id', 'emp-001')
        .set('Idempotency-Key', key)
        .send({
          leave_type: 'PTO',
          start_date: '2027-07-01',
          end_date: '2027-07-01',
          hours_requested: 8,
        })
        .expect(201);

      expect(res2.body.data.id).toBe(res1.body.data.id);
    });

    it('should reject request without Idempotency-Key', async () => {
      await supertest(server)
        .post('/api/v1/employees/me/requests')
        .set('x-employee-id', 'emp-001')
        .send({
          leave_type: 'PTO',
          start_date: '2027-08-01',
          end_date: '2027-08-01',
          hours_requested: 8,
        })
        .expect(400);
    });

    it('should include correlation ID in response', async () => {
      const correlationId = 'test-correlation-123';
      const res = await supertest(server)
        .post('/api/v1/employees/me/requests')
        .set('x-employee-id', 'emp-001')
        .set('Idempotency-Key', uuidv4())
        .set('X-Correlation-Id', correlationId)
        .send({
          leave_type: 'PTO',
          start_date: '2027-09-01',
          end_date: '2027-09-01',
          hours_requested: 8,
        })
        .expect(201);

      expect(res.headers['x-correlation-id']).toBe(correlationId);
    });
  });

  describe('GET /api/v1/employees/me/requests', () => {
    it('should list requests with pagination', async () => {
      const res = await supertest(server)
        .get('/api/v1/employees/me/requests?limit=5')
        .set('x-employee-id', 'emp-001')
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.limit).toBe(5);
    });
  });

  describe('GET /api/v1/employees/me/requests/:id', () => {
    it('should return request details', async () => {
      // First create a request
      const createRes = await supertest(server)
        .post('/api/v1/employees/me/requests')
        .set('x-employee-id', 'emp-001')
        .set('Idempotency-Key', uuidv4())
        .send({
          leave_type: 'PTO',
          start_date: '2027-10-01',
          end_date: '2027-10-01',
          hours_requested: 8,
        })
        .expect(201);

      const requestId = createRes.body.data.id;

      const res = await supertest(server)
        .get(`/api/v1/employees/me/requests/${requestId}`)
        .set('x-employee-id', 'emp-001')
        .expect(200);

      expect(res.body.data.id).toBe(requestId);
      expect(res.body.data.hold).toBeDefined();
    });

    it('should return 404 for non-existent request', async () => {
      await supertest(server)
        .get('/api/v1/employees/me/requests/non-existent-id')
        .set('x-employee-id', 'emp-001')
        .expect(404);
    });
  });

  // ─── Manager Endpoints ─────────────────────────────────────────────

  describe('POST /api/v1/managers/me/requests/:id/approve', () => {
    it('should approve a request', async () => {
      const createRes = await supertest(server)
        .post('/api/v1/employees/me/requests')
        .set('x-employee-id', 'emp-001')
        .set('Idempotency-Key', uuidv4())
        .send({
          leave_type: 'PTO',
          start_date: '2027-11-01',
          end_date: '2027-11-01',
          hours_requested: 8,
        })
        .expect(201);

      const approveRes = await supertest(server)
        .post(`/api/v1/managers/me/requests/${createRes.body.data.id}/approve`)
        .set('x-employee-id', 'manager-001')
        .set('Idempotency-Key', uuidv4())
        .send({ version: createRes.body.data.version })
        .expect(200);

      expect(approveRes.body.data.status).toBe('APPROVED_PENDING_HCM');
      expect(approveRes.body.data.outbox_id).toBeDefined();
    });
  });

  describe('POST /api/v1/managers/me/requests/:id/reject', () => {
    it('should reject a request with reason', async () => {
      const createRes = await supertest(server)
        .post('/api/v1/employees/me/requests')
        .set('x-employee-id', 'emp-001')
        .set('Idempotency-Key', uuidv4())
        .send({
          leave_type: 'PTO',
          start_date: '2027-12-01',
          end_date: '2027-12-01',
          hours_requested: 8,
        })
        .expect(201);

      const rejectRes = await supertest(server)
        .post(`/api/v1/managers/me/requests/${createRes.body.data.id}/reject`)
        .set('x-employee-id', 'manager-001')
        .set('Idempotency-Key', uuidv4())
        .send({
          version: createRes.body.data.version,
          rejection_reason: 'Insufficient team coverage',
        })
        .expect(200);

      expect(rejectRes.body.data.status).toBe('REJECTED');
      expect(rejectRes.body.data.rejection_reason).toBe('Insufficient team coverage');
    });
  });

  // ─── Integration Endpoints ─────────────────────────────────────────

  describe('POST /api/v1/integrations/hcm/batch-sync', () => {
    it('should process batch sync', async () => {
      const res = await supertest(server)
        .post('/api/v1/integrations/hcm/batch-sync')
        .send({
          batch_id: `batch-${uuidv4()}`,
          items: [
            {
              employee_id: 'emp-001',
              leave_type: 'PTO',
              total_balance: 120,
              used_balance: 24,
              hcm_version: new Date().toISOString(),
            },
          ],
        })
        .expect(200);

      expect(res.body.data.total_items).toBe(1);
      expect(res.body.data.processed_items).toBeGreaterThanOrEqual(0);
    });
  });

  describe('POST /api/v1/integrations/hcm/balance-update', () => {
    it('should update single balance', async () => {
      const res = await supertest(server)
        .post('/api/v1/integrations/hcm/balance-update')
        .set('Idempotency-Key', uuidv4())
        .send({
          employee_id: 'emp-002',
          leave_type: 'PTO',
          total_balance: 80,
          used_balance: 24,
          hcm_version: new Date().toISOString(),
        })
        .expect(200);

      expect(res.body.data.result).toMatch(/UPDATED|CREATED/);
    });
  });
});

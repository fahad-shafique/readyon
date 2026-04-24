/**
 * Test helper for creating a fully-wired NestJS testing module
 * with an in-memory SQLite database and mock HCM adapter.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';
import { DatabaseService } from '../database/database.service';
import { BalanceModule } from '../balance/balance.module';
import { BalanceRepository } from '../balance/balance.repository';
import { RequestModule } from '../request/request.module';
import { RequestService } from '../request/request.service';
import { RequestRepository } from '../request/request.repository';
import { IntegrationModule } from '../integration/integration.module';
import { HcmModule } from '../integration/hcm/hcm.module';
import { HCM_ADAPTER_PORT } from '../integration/hcm/hcm-adapter.port';
import { MockHcmAdapter } from '../integration/hcm/mock-hcm-adapter';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { HoldRepository } from '../hold/hold.repository';
import { OutboxRepository } from '../integration/outbox/outbox.repository';
import { OutboxProcessor } from '../integration/outbox/outbox.processor';
import { BatchSyncService } from '../integration/batch/batch-sync.service';
import { ReconciliationService } from '../integration/reconciliation/reconciliation.service';
import { HealthController } from '../health/health.controller';
import { CorrelationIdInterceptor } from '../common/interceptors/correlation-id.interceptor';
import { GlobalExceptionFilter } from '../common/filters/http-exception.filter';
import { AppModule } from '../app.module';

export interface TestContext {
  app: INestApplication;
  module: TestingModule;
  dbService: DatabaseService;
  requestService: RequestService;
  requestRepo: RequestRepository;
  balanceRepo: BalanceRepository;
  holdRepo: HoldRepository;
  outboxRepo: OutboxRepository;
  outboxProcessor: OutboxProcessor;
  batchSyncService: BatchSyncService;
  reconciliationService: ReconciliationService;
  auditService: AuditService;
  idempotencyService: IdempotencyService;
  mockHcm: MockHcmAdapter;
}

/**
 * Create a test context with an in-memory SQLite DB.
 */
export async function createTestContext(): Promise<TestContext> {
  // Use a unique in-memory DB for test isolation
  process.env.DB_PATH = ':memory:';

  const module = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(HCM_ADAPTER_PORT)
    .useClass(MockHcmAdapter)
    .compile();

  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  app.useGlobalInterceptors(new CorrelationIdInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.init();

  const mockHcm = module.get<MockHcmAdapter>(HCM_ADAPTER_PORT);

  return {
    app,
    module,
    dbService: module.get(DatabaseService),
    requestService: module.get(RequestService),
    requestRepo: module.get(RequestRepository),
    balanceRepo: module.get(BalanceRepository),
    holdRepo: module.get(HoldRepository),
    outboxRepo: module.get(OutboxRepository),
    outboxProcessor: module.get(OutboxProcessor),
    batchSyncService: module.get(BatchSyncService),
    reconciliationService: module.get(ReconciliationService),
    auditService: module.get(AuditService),
    idempotencyService: module.get(IdempotencyService),
    mockHcm: mockHcm as MockHcmAdapter,
  };
}

/**
 * Seed standard test data: an employee with PTO balance.
 */
export function seedTestData(ctx: TestContext): void {
  // Create balance projection in DB
  ctx.balanceRepo.create({
    employeeId: 'emp-001',
    leaveType: 'PTO',
    location: 'HQ',
    totalBalance: 120,
    usedBalance: 0,
    hcmVersion: '2026-01-01T00:00:00Z',
  });

  ctx.balanceRepo.create({
    employeeId: 'emp-001',
    leaveType: 'SICK',
    location: 'HQ',
    totalBalance: 40,
    usedBalance: 8,
    hcmVersion: '2026-01-01T00:00:00Z',
  });

  ctx.balanceRepo.create({
    employeeId: 'emp-002',
    leaveType: 'PTO',
    location: 'HQ',
    totalBalance: 80,
    usedBalance: 16,
    hcmVersion: '2026-01-01T00:00:00Z',
  });

  // Set matching balances in mock HCM
  ctx.mockHcm.setBalance('emp-001', 'PTO', {
    total_balance: 120,
    used_balance: 0,
    hcm_version: '2026-01-01T00:00:00Z',
  });

  ctx.mockHcm.setBalance('emp-001', 'SICK', {
    total_balance: 40,
    used_balance: 8,
    hcm_version: '2026-01-01T00:00:00Z',
  });

  ctx.mockHcm.setBalance('emp-002', 'PTO', {
    total_balance: 80,
    used_balance: 16,
    hcm_version: '2026-01-01T00:00:00Z',
  });
}

export async function cleanupTestContext(ctx: TestContext): Promise<void> {
  ctx.mockHcm.reset();
  await ctx.app.close();
}

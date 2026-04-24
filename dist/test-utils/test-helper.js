"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestContext = createTestContext;
exports.seedTestData = seedTestData;
exports.cleanupTestContext = cleanupTestContext;
const testing_1 = require("@nestjs/testing");
const common_1 = require("@nestjs/common");
const database_service_1 = require("../database/database.service");
const balance_repository_1 = require("../balance/balance.repository");
const request_service_1 = require("../request/request.service");
const request_repository_1 = require("../request/request.repository");
const hcm_adapter_port_1 = require("../integration/hcm/hcm-adapter.port");
const mock_hcm_adapter_1 = require("../integration/hcm/mock-hcm-adapter");
const audit_service_1 = require("../audit/audit.service");
const idempotency_service_1 = require("../idempotency/idempotency.service");
const hold_repository_1 = require("../hold/hold.repository");
const outbox_repository_1 = require("../integration/outbox/outbox.repository");
const outbox_processor_1 = require("../integration/outbox/outbox.processor");
const batch_sync_service_1 = require("../integration/batch/batch-sync.service");
const reconciliation_service_1 = require("../integration/reconciliation/reconciliation.service");
const correlation_id_interceptor_1 = require("../common/interceptors/correlation-id.interceptor");
const http_exception_filter_1 = require("../common/filters/http-exception.filter");
const app_module_1 = require("../app.module");
async function createTestContext() {
    process.env.DB_PATH = ':memory:';
    const module = await testing_1.Test.createTestingModule({
        imports: [app_module_1.AppModule],
    })
        .overrideProvider(hcm_adapter_port_1.HCM_ADAPTER_PORT)
        .useClass(mock_hcm_adapter_1.MockHcmAdapter)
        .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
    }));
    app.useGlobalInterceptors(new correlation_id_interceptor_1.CorrelationIdInterceptor());
    app.useGlobalFilters(new http_exception_filter_1.GlobalExceptionFilter());
    await app.init();
    const mockHcm = module.get(hcm_adapter_port_1.HCM_ADAPTER_PORT);
    return {
        app,
        module,
        dbService: module.get(database_service_1.DatabaseService),
        requestService: module.get(request_service_1.RequestService),
        requestRepo: module.get(request_repository_1.RequestRepository),
        balanceRepo: module.get(balance_repository_1.BalanceRepository),
        holdRepo: module.get(hold_repository_1.HoldRepository),
        outboxRepo: module.get(outbox_repository_1.OutboxRepository),
        outboxProcessor: module.get(outbox_processor_1.OutboxProcessor),
        batchSyncService: module.get(batch_sync_service_1.BatchSyncService),
        reconciliationService: module.get(reconciliation_service_1.ReconciliationService),
        auditService: module.get(audit_service_1.AuditService),
        idempotencyService: module.get(idempotency_service_1.IdempotencyService),
        mockHcm: mockHcm,
    };
}
function seedTestData(ctx) {
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
async function cleanupTestContext(ctx) {
    ctx.mockHcm.reset();
    await ctx.app.close();
}
//# sourceMappingURL=test-helper.js.map
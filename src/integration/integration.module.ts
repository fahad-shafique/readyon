import { Module, forwardRef } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { OutboxRepository } from './outbox/outbox.repository';
import { OutboxProcessor } from './outbox/outbox.processor';
import { BatchRepository } from './batch/batch.repository';
import { BatchSyncService } from './batch/batch-sync.service';
import { ReconciliationService } from './reconciliation/reconciliation.service';
import { BalanceModule } from '../balance/balance.module';
import { AuditModule } from '../audit/audit.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { RequestModule } from '../request/request.module';

@Module({
  imports: [BalanceModule, AuditModule, IdempotencyModule, forwardRef(() => RequestModule)],
  controllers: [IntegrationController],
  providers: [
    OutboxRepository,
    OutboxProcessor,
    BatchRepository,
    BatchSyncService,
    ReconciliationService,
  ],
  exports: [OutboxRepository, BatchSyncService, BatchRepository],
})
export class IntegrationModule {}

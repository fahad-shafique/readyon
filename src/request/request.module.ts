import { Module, forwardRef } from '@nestjs/common';
import { EmployeeRequestController } from './employee-request.controller';
import { ManagerRequestController } from './manager-request.controller';
import { RequestService } from './request.service';
import { RequestRepository } from './request.repository';
import { HoldRepository } from '../hold/hold.repository';
import { BalanceModule } from '../balance/balance.module';
import { AuditModule } from '../audit/audit.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { IntegrationModule } from '../integration/integration.module';

@Module({
  imports: [BalanceModule, AuditModule, IdempotencyModule, forwardRef(() => IntegrationModule)],
  controllers: [EmployeeRequestController, ManagerRequestController],
  providers: [RequestService, RequestRepository, HoldRepository],
  exports: [RequestService, RequestRepository, HoldRepository],
})
export class RequestModule {}

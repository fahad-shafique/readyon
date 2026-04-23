import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { BalanceModule } from './balance/balance.module';
import { RequestModule } from './request/request.module';
import { IntegrationModule } from './integration/integration.module';
import { HcmModule } from './integration/hcm/hcm.module';
import { AuditModule } from './audit/audit.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    HcmModule,       // Global — provides HCM_ADAPTER_PORT everywhere
    BalanceModule,
    RequestModule,
    IntegrationModule,
    AuditModule,
    IdempotencyModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

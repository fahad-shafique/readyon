import { Controller, Get, HttpCode } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OutboxRepository } from '../integration/outbox/outbox.repository';
import { BatchRepository } from '../integration/batch/batch.repository';

@Controller('api/v1/health')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    private readonly dbService: DatabaseService,
    private readonly outboxRepo: OutboxRepository,
    private readonly batchRepo: BatchRepository,
  ) {}

  @Get()
  @HttpCode(200)
  check() {
    let dbStatus = 'connected';
    try {
      this.dbService.getDb().prepare('SELECT 1').get();
    } catch {
      dbStatus = 'disconnected';
    }

    return {
      status: dbStatus === 'connected' ? 'healthy' : 'unhealthy',
      checks: {
        database: dbStatus,
        outbox_depth: this.outboxRepo.getOutboxDepth(),
        last_batch_sync: this.batchRepo.getLastBatchTime(),
      },
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      version: '1.0.0',
    };
  }
}

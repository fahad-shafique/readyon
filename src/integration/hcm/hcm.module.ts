import { Global, Module } from '@nestjs/common';
import { HCM_ADAPTER_PORT } from './hcm-adapter.port';
import { MockHcmAdapter } from './mock-hcm-adapter';
import { CircuitBreaker } from './circuit-breaker';

/**
 * Provides the HCM adapter as a global module so all integration services can inject it.
 */
@Global()
@Module({
  providers: [
    {
      provide: HCM_ADAPTER_PORT,
      useClass: MockHcmAdapter,
    },
    CircuitBreaker,
  ],
  exports: [HCM_ADAPTER_PORT, CircuitBreaker],
})
export class HcmModule { }

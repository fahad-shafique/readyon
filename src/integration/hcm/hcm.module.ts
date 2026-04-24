import { Global, Module } from '@nestjs/common';
import { HCM_ADAPTER_PORT } from './hcm-adapter.port';
import { CircuitBreaker } from './circuit-breaker';
import { HttpHcmAdapter } from './http-hcm-adapter';

/**
 * Provides the HCM adapter as a global module so all integration services can inject it.
 *
 * Production: HttpHcmAdapter (real HTTP calls to the HCM system).
 * Testing:    MockHcmAdapter is injected via `.overrideProvider(HCM_ADAPTER_PORT)` in
 *             `test-utils/test-helper.ts` — the mock MUST NOT be referenced here.
 */
@Global()
@Module({
  providers: [
    {
      provide: HCM_ADAPTER_PORT,
      useClass: HttpHcmAdapter,
    },
    CircuitBreaker,
  ],
  exports: [HCM_ADAPTER_PORT, CircuitBreaker],
})
export class HcmModule { }

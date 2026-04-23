import { Injectable, Logger } from '@nestjs/common';
import { HcmTransientError } from './hcm-errors';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

@Injectable()
export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  private state: CircuitState = CircuitState.CLOSED;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;

  private readonly failureThreshold = parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD || '5', 10);
  private readonly cooldownMs = parseInt(process.env.CIRCUIT_COOLDOWN_MS || '60000', 10);

  ensureClosed(correlationId = ''): void {
    if (this.state === CircuitState.CLOSED) {
      return;
    }

    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.cooldownMs) {
        this.logger.log('Circuit breaker transitioning to HALF_OPEN');
        this.state = CircuitState.HALF_OPEN;
        return; // Allow one request through
      }
      throw new HcmTransientError('CIRCUIT_OPEN', 'Circuit breaker is OPEN — HCM calls temporarily blocked', correlationId);
    }

    // HALF_OPEN: allow the request through
  }

  recordSuccess(): void {
    if (this.state !== CircuitState.CLOSED) {
      this.logger.log('Circuit breaker transitioning to CLOSED');
    }
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.logger.warn('Circuit breaker transitioning to OPEN (half-open test failed)');
      this.state = CircuitState.OPEN;
      return;
    }

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.logger.warn(`Circuit breaker transitioning to OPEN (${this.consecutiveFailures} consecutive failures)`);
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Reset for testing */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
  }
}

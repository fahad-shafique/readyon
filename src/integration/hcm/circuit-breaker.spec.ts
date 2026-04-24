import { CircuitBreaker, CircuitState } from './circuit-breaker';
import { HcmTransientError } from './hcm-errors';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker();
    // Default threshold is 5, cooldown 60s
    process.env.CIRCUIT_FAILURE_THRESHOLD = '3';
    process.env.CIRCUIT_COOLDOWN_MS = '1000';
    cb = new CircuitBreaker(); // Re-instantiate to pick up env vars
  });

  it('should start in CLOSED state', () => {
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('should allow requests when CLOSED', () => {
    expect(() => cb.ensureClosed()).not.toThrow();
  });

  it('should transition to OPEN after reaching failure threshold', () => {
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
    
    cb.recordFailure();
    expect(cb.getState()).toBe(CircuitState.OPEN);
  });

  it('should throw HcmTransientError when OPEN', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    
    expect(() => cb.ensureClosed('test-cor-id')).toThrow(HcmTransientError);
    try {
      cb.ensureClosed('test-cor-id');
    } catch (e: any) {
      expect(e.hcmErrorCode).toBe('CIRCUIT_OPEN');
      expect(e.correlationId).toBe('test-cor-id');
    }
  });

  it('should transition to HALF_OPEN after cooldown', async () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe(CircuitState.OPEN);

    // Wait for cooldown
    await new Promise(resolve => setTimeout(resolve, 1100));

    cb.ensureClosed();
    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
  });

  it('should transition from HALF_OPEN back to CLOSED on success', async () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    await new Promise(resolve => setTimeout(resolve, 1100));
    cb.ensureClosed(); // transitions to HALF_OPEN

    cb.recordSuccess();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('should transition from HALF_OPEN back to OPEN on failure', async () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    await new Promise(resolve => setTimeout(resolve, 1100));
    cb.ensureClosed(); // transitions to HALF_OPEN

    cb.recordFailure();
    expect(cb.getState()).toBe(CircuitState.OPEN);
  });

  it('should reset failure count on success', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('should reset state when requested', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    cb.reset();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
    expect(() => cb.ensureClosed()).not.toThrow();
  });
});

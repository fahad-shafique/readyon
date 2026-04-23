export declare enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN"
}
export declare class CircuitBreaker {
    private readonly logger;
    private state;
    private consecutiveFailures;
    private lastFailureTime;
    private readonly failureThreshold;
    private readonly cooldownMs;
    ensureClosed(correlationId?: string): void;
    recordSuccess(): void;
    recordFailure(): void;
    getState(): CircuitState;
    reset(): void;
}

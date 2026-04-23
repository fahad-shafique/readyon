"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var CircuitBreaker_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreaker = exports.CircuitState = void 0;
const common_1 = require("@nestjs/common");
const hcm_errors_1 = require("./hcm-errors");
var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "CLOSED";
    CircuitState["OPEN"] = "OPEN";
    CircuitState["HALF_OPEN"] = "HALF_OPEN";
})(CircuitState || (exports.CircuitState = CircuitState = {}));
let CircuitBreaker = CircuitBreaker_1 = class CircuitBreaker {
    logger = new common_1.Logger(CircuitBreaker_1.name);
    state = CircuitState.CLOSED;
    consecutiveFailures = 0;
    lastFailureTime = 0;
    failureThreshold = parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD || '5', 10);
    cooldownMs = parseInt(process.env.CIRCUIT_COOLDOWN_MS || '60000', 10);
    ensureClosed(correlationId = '') {
        if (this.state === CircuitState.CLOSED) {
            return;
        }
        if (this.state === CircuitState.OPEN) {
            const elapsed = Date.now() - this.lastFailureTime;
            if (elapsed >= this.cooldownMs) {
                this.logger.log('Circuit breaker transitioning to HALF_OPEN');
                this.state = CircuitState.HALF_OPEN;
                return;
            }
            throw new hcm_errors_1.HcmTransientError('CIRCUIT_OPEN', 'Circuit breaker is OPEN — HCM calls temporarily blocked', correlationId);
        }
    }
    recordSuccess() {
        if (this.state !== CircuitState.CLOSED) {
            this.logger.log('Circuit breaker transitioning to CLOSED');
        }
        this.state = CircuitState.CLOSED;
        this.consecutiveFailures = 0;
    }
    recordFailure() {
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
    getState() {
        return this.state;
    }
    reset() {
        this.state = CircuitState.CLOSED;
        this.consecutiveFailures = 0;
        this.lastFailureTime = 0;
    }
};
exports.CircuitBreaker = CircuitBreaker;
exports.CircuitBreaker = CircuitBreaker = CircuitBreaker_1 = __decorate([
    (0, common_1.Injectable)()
], CircuitBreaker);
//# sourceMappingURL=circuit-breaker.js.map
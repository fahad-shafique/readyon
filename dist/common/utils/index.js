"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateId = generateId;
exports.nowISO = nowISO;
exports.calculateExponentialBackoff = calculateExponentialBackoff;
const uuid_1 = require("uuid");
function generateId() {
    return (0, uuid_1.v4)();
}
function nowISO() {
    return new Date().toISOString().replace('T', 'T').replace('Z', 'Z');
}
function calculateExponentialBackoff(retryCount) {
    const baseDelayMs = 10_000;
    const maxDelayMs = 900_000;
    const jitterMs = Math.random() * 5_000;
    const delayMs = Math.min(baseDelayMs * Math.pow(3, retryCount) + jitterMs, maxDelayMs);
    return new Date(Date.now() + delayMs);
}
//# sourceMappingURL=index.js.map
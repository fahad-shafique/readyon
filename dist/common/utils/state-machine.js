"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidTransition = isValidTransition;
exports.assertValidTransition = assertValidTransition;
exports.isTerminalStatus = isTerminalStatus;
exports.isHoldActiveStatus = isHoldActiveStatus;
const types_1 = require("../types");
const exceptions_1 = require("../exceptions");
const VALID_TRANSITIONS = {
    [types_1.RequestStatus.PENDING_APPROVAL]: [
        types_1.RequestStatus.APPROVED_PENDING_HCM,
        types_1.RequestStatus.REJECTED,
        types_1.RequestStatus.CANCELLED,
    ],
    [types_1.RequestStatus.APPROVED_PENDING_HCM]: [
        types_1.RequestStatus.APPROVED,
        types_1.RequestStatus.FAILED_HCM,
        types_1.RequestStatus.CANCELLED,
    ],
    [types_1.RequestStatus.APPROVED]: [types_1.RequestStatus.RECONCILIATION_REQUIRED, types_1.RequestStatus.CANCELLED],
    [types_1.RequestStatus.REJECTED]: [],
    [types_1.RequestStatus.CANCELLED]: [],
    [types_1.RequestStatus.FAILED_HCM]: [types_1.RequestStatus.RECONCILIATION_REQUIRED],
    [types_1.RequestStatus.RECONCILIATION_REQUIRED]: [types_1.RequestStatus.APPROVED, types_1.RequestStatus.CANCELLED],
};
function isValidTransition(from, to) {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
function assertValidTransition(from, to, requestId) {
    if (!isValidTransition(from, to)) {
        throw new exceptions_1.InvalidStateTransitionException(from, to, requestId);
    }
}
function isTerminalStatus(status) {
    return [types_1.RequestStatus.APPROVED, types_1.RequestStatus.REJECTED, types_1.RequestStatus.CANCELLED].includes(status);
}
function isHoldActiveStatus(status) {
    return [types_1.RequestStatus.PENDING_APPROVAL, types_1.RequestStatus.APPROVED_PENDING_HCM].includes(status);
}
//# sourceMappingURL=state-machine.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HcmPermanentError = exports.HcmTransientError = exports.HcmError = void 0;
const types_1 = require("../../common/types");
class HcmError extends Error {
    correlationId;
    constructor(message, correlationId) {
        super(message);
        this.correlationId = correlationId;
        this.name = this.constructor.name;
    }
}
exports.HcmError = HcmError;
class HcmTransientError extends HcmError {
    hcmErrorCode;
    category = types_1.HcmErrorCategory.TRANSIENT;
    constructor(hcmErrorCode, message, correlationId) {
        super(message, correlationId);
        this.hcmErrorCode = hcmErrorCode;
    }
}
exports.HcmTransientError = HcmTransientError;
class HcmPermanentError extends HcmError {
    hcmErrorCode;
    category = types_1.HcmErrorCategory.PERMANENT;
    constructor(hcmErrorCode, message, correlationId) {
        super(message, correlationId);
        this.hcmErrorCode = hcmErrorCode;
    }
}
exports.HcmPermanentError = HcmPermanentError;
//# sourceMappingURL=hcm-errors.js.map
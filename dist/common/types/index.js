"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HcmErrorCategory = exports.ErrorCode = exports.ActorType = exports.EntityType = exports.BatchStatus = exports.OutboxAction = exports.OutboxStatus = exports.HoldStatus = exports.RequestStatus = void 0;
var RequestStatus;
(function (RequestStatus) {
    RequestStatus["PENDING_APPROVAL"] = "PENDING_APPROVAL";
    RequestStatus["APPROVED_PENDING_HCM"] = "APPROVED_PENDING_HCM";
    RequestStatus["APPROVED"] = "APPROVED";
    RequestStatus["REJECTED"] = "REJECTED";
    RequestStatus["CANCELLED"] = "CANCELLED";
    RequestStatus["FAILED_HCM"] = "FAILED_HCM";
    RequestStatus["RECONCILIATION_REQUIRED"] = "RECONCILIATION_REQUIRED";
})(RequestStatus || (exports.RequestStatus = RequestStatus = {}));
var HoldStatus;
(function (HoldStatus) {
    HoldStatus["ACTIVE"] = "ACTIVE";
    HoldStatus["RELEASED"] = "RELEASED";
    HoldStatus["CONVERTED"] = "CONVERTED";
})(HoldStatus || (exports.HoldStatus = HoldStatus = {}));
var OutboxStatus;
(function (OutboxStatus) {
    OutboxStatus["PENDING"] = "PENDING";
    OutboxStatus["PROCESSING"] = "PROCESSING";
    OutboxStatus["COMPLETED"] = "COMPLETED";
    OutboxStatus["FAILED"] = "FAILED";
})(OutboxStatus || (exports.OutboxStatus = OutboxStatus = {}));
var OutboxAction;
(function (OutboxAction) {
    OutboxAction["POST_TIME_OFF"] = "POST_TIME_OFF";
    OutboxAction["CANCEL_TIME_OFF"] = "CANCEL_TIME_OFF";
})(OutboxAction || (exports.OutboxAction = OutboxAction = {}));
var BatchStatus;
(function (BatchStatus) {
    BatchStatus["PROCESSING"] = "PROCESSING";
    BatchStatus["COMPLETED"] = "COMPLETED";
    BatchStatus["PARTIAL"] = "PARTIAL";
    BatchStatus["FAILED"] = "FAILED";
})(BatchStatus || (exports.BatchStatus = BatchStatus = {}));
var EntityType;
(function (EntityType) {
    EntityType["REQUEST"] = "REQUEST";
    EntityType["BALANCE"] = "BALANCE";
    EntityType["HOLD"] = "HOLD";
    EntityType["OUTBOX"] = "OUTBOX";
    EntityType["BATCH"] = "BATCH";
})(EntityType || (exports.EntityType = EntityType = {}));
var ActorType;
(function (ActorType) {
    ActorType["EMPLOYEE"] = "EMPLOYEE";
    ActorType["MANAGER"] = "MANAGER";
    ActorType["SYSTEM"] = "SYSTEM";
    ActorType["HCM"] = "HCM";
})(ActorType || (exports.ActorType = ActorType = {}));
var ErrorCode;
(function (ErrorCode) {
    ErrorCode["VALIDATION_ERROR"] = "VALIDATION_ERROR";
    ErrorCode["INVALID_STATE_TRANSITION"] = "INVALID_STATE_TRANSITION";
    ErrorCode["NOT_FOUND"] = "NOT_FOUND";
    ErrorCode["FORBIDDEN"] = "FORBIDDEN";
    ErrorCode["INSUFFICIENT_BALANCE"] = "INSUFFICIENT_BALANCE";
    ErrorCode["OVERLAPPING_REQUEST"] = "OVERLAPPING_REQUEST";
    ErrorCode["VERSION_CONFLICT"] = "VERSION_CONFLICT";
    ErrorCode["DUPLICATE_REQUEST"] = "DUPLICATE_REQUEST";
    ErrorCode["STALE_BATCH"] = "STALE_BATCH";
    ErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
var HcmErrorCategory;
(function (HcmErrorCategory) {
    HcmErrorCategory["TRANSIENT"] = "TRANSIENT";
    HcmErrorCategory["PERMANENT"] = "PERMANENT";
})(HcmErrorCategory || (exports.HcmErrorCategory = HcmErrorCategory = {}));
//# sourceMappingURL=index.js.map
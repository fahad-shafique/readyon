"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SingleBalanceUpdateDto = exports.BatchSyncRequestDto = exports.BatchSyncItemDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
class BatchSyncItemDto {
    employee_id;
    leave_type;
    total_balance;
    used_balance;
    hcm_version;
}
exports.BatchSyncItemDto = BatchSyncItemDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BatchSyncItemDto.prototype, "employee_id", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BatchSyncItemDto.prototype, "leave_type", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], BatchSyncItemDto.prototype, "total_balance", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], BatchSyncItemDto.prototype, "used_balance", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BatchSyncItemDto.prototype, "hcm_version", void 0);
class BatchSyncRequestDto {
    batch_id;
    items;
}
exports.BatchSyncRequestDto = BatchSyncRequestDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], BatchSyncRequestDto.prototype, "batch_id", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => BatchSyncItemDto),
    __metadata("design:type", Array)
], BatchSyncRequestDto.prototype, "items", void 0);
class SingleBalanceUpdateDto {
    employee_id;
    leave_type;
    total_balance;
    used_balance;
    hcm_version;
}
exports.SingleBalanceUpdateDto = SingleBalanceUpdateDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SingleBalanceUpdateDto.prototype, "employee_id", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SingleBalanceUpdateDto.prototype, "leave_type", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], SingleBalanceUpdateDto.prototype, "total_balance", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], SingleBalanceUpdateDto.prototype, "used_balance", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SingleBalanceUpdateDto.prototype, "hcm_version", void 0);
//# sourceMappingURL=index.js.map
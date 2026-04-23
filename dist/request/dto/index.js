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
exports.RejectRequestDto = exports.ApproveRequestDto = exports.CancelRequestDto = exports.CreateTimeOffRequestDto = void 0;
const class_validator_1 = require("class-validator");
class CreateTimeOffRequestDto {
    leave_type;
    start_date;
    end_date;
    hours_requested;
    reason;
}
exports.CreateTimeOffRequestDto = CreateTimeOffRequestDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTimeOffRequestDto.prototype, "leave_type", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateTimeOffRequestDto.prototype, "start_date", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateTimeOffRequestDto.prototype, "end_date", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0.01),
    __metadata("design:type", Number)
], CreateTimeOffRequestDto.prototype, "hours_requested", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTimeOffRequestDto.prototype, "reason", void 0);
class CancelRequestDto {
    version;
    reason;
}
exports.CancelRequestDto = CancelRequestDto;
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], CancelRequestDto.prototype, "version", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CancelRequestDto.prototype, "reason", void 0);
class ApproveRequestDto {
    version;
}
exports.ApproveRequestDto = ApproveRequestDto;
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], ApproveRequestDto.prototype, "version", void 0);
class RejectRequestDto {
    version;
    rejection_reason;
}
exports.RejectRequestDto = RejectRequestDto;
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], RejectRequestDto.prototype, "version", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], RejectRequestDto.prototype, "rejection_reason", void 0);
//# sourceMappingURL=index.js.map
"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HcmModule = void 0;
const common_1 = require("@nestjs/common");
const hcm_adapter_port_1 = require("./hcm-adapter.port");
const circuit_breaker_1 = require("./circuit-breaker");
const http_hcm_adapter_1 = require("./http-hcm-adapter");
let HcmModule = class HcmModule {
};
exports.HcmModule = HcmModule;
exports.HcmModule = HcmModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            {
                provide: hcm_adapter_port_1.HCM_ADAPTER_PORT,
                useClass: http_hcm_adapter_1.HttpHcmAdapter,
            },
            circuit_breaker_1.CircuitBreaker,
        ],
        exports: [hcm_adapter_port_1.HCM_ADAPTER_PORT, circuit_breaker_1.CircuitBreaker],
    })
], HcmModule);
//# sourceMappingURL=hcm.module.js.map
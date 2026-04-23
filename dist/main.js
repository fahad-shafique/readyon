"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
const correlation_id_interceptor_1 = require("./common/interceptors/correlation-id.interceptor");
const http_exception_filter_1 = require("./common/filters/http-exception.filter");
async function bootstrap() {
    const logger = new common_1.Logger('Bootstrap');
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
    }));
    app.useGlobalInterceptors(new correlation_id_interceptor_1.CorrelationIdInterceptor());
    app.useGlobalFilters(new http_exception_filter_1.GlobalExceptionFilter());
    const port = process.env.PORT || 3000;
    await app.listen(port);
    logger.log(`ReadyOn Time-Off Microservice running on port ${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map
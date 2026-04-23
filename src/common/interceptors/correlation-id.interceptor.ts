import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { generateId } from '../utils';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const correlationId = request.headers['x-correlation-id'] || generateId();
    request.correlationId = correlationId;

    const response = context.switchToHttp().getResponse();
    response.setHeader('X-Correlation-Id', correlationId);

    return next.handle();
  }
}

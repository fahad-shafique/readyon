import { Injectable, Logger } from '@nestjs/common';
import {
  HcmAdapterPort,
  HcmGetBalanceRequest,
  HcmGetBalanceResponse,
  HcmPostTimeOffRequest,
  HcmPostTimeOffResponse,
  HcmCancelTimeOffRequest,
  HcmCancelTimeOffResponse,
  HcmBatchBalancesRequest,
  HcmBatchBalancesResponse,
} from './hcm-adapter.port';
import { HcmPermanentError, HcmTransientError } from './hcm-errors';

@Injectable()
export class HttpHcmAdapter implements HcmAdapterPort {
  private readonly logger = new Logger(HttpHcmAdapter.name);
  private readonly baseUrl = 'http://localhost:3001/api';

  private async handleResponse<T>(res: Response, correlationId: string): Promise<T> {
    if (!res.ok) {
      let msg = 'Unknown HCM Error';
      try {
        const data = await res.json();
        msg = data.message || data.error || msg;
      } catch (e) {}

      if (res.status >= 500 || res.status === 429) {
        throw new HcmTransientError('HCM_TRANSIENT_ERROR', msg, correlationId);
      } else {
        throw new HcmPermanentError('HCM_PERMANENT_ERROR', msg, correlationId);
      }
    }
    return res.json() as Promise<T>;
  }

  private handleError(error: any, correlationId: string): never {
    throw new HcmTransientError('HCM_NETWORK_ERROR', error.message || 'Network error', correlationId);
  }

  async getBalance(request: HcmGetBalanceRequest): Promise<HcmGetBalanceResponse> {
    try {
      const url = new URL(`${this.baseUrl}/balance`);
      url.searchParams.append('employee_id', request.employee_id);
      url.searchParams.append('leave_type', request.leave_type);
      
      const res = await fetch(url.toString(), {
        headers: { 'x-correlation-id': request.correlation_id }
      });
      return await this.handleResponse(res, request.correlation_id);
    } catch (error: any) {
      if (error instanceof HcmTransientError || error instanceof HcmPermanentError) throw error;
      this.handleError(error, request.correlation_id);
    }
  }

  async postTimeOff(request: HcmPostTimeOffRequest): Promise<HcmPostTimeOffResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/time-off`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-correlation-id': request.correlation_id, 
          'x-idempotency-key': request.idempotency_key 
        },
        body: JSON.stringify({
          employee_id: request.employee_id,
          leave_type: request.leave_type,
          hours: request.hours,
          start_date: request.start_date,
          end_date: request.end_date,
          idempotency_key: request.idempotency_key
        })
      });
      return await this.handleResponse(res, request.correlation_id);
    } catch (error: any) {
      if (error instanceof HcmTransientError || error instanceof HcmPermanentError) throw error;
      this.handleError(error, request.correlation_id);
    }
  }

  async cancelTimeOff(request: HcmCancelTimeOffRequest): Promise<HcmCancelTimeOffResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/time-off/cancel`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-correlation-id': request.correlation_id, 
          'x-idempotency-key': request.idempotency_key 
        },
        body: JSON.stringify({
          hcm_reference_id: request.hcm_reference_id,
          employee_id: request.employee_id,
          idempotency_key: request.idempotency_key
        })
      });
      return await this.handleResponse(res, request.correlation_id);
    } catch (error: any) {
      if (error instanceof HcmTransientError || error instanceof HcmPermanentError) throw error;
      this.handleError(error, request.correlation_id);
    }
  }

  async getBatchBalances(request: HcmBatchBalancesRequest): Promise<HcmBatchBalancesResponse> {
    try {
      const url = new URL(`${this.baseUrl}/batch-balances`);
      if (request.since_checkpoint) {
        url.searchParams.append('since', request.since_checkpoint);
      }
      
      const res = await fetch(url.toString(), {
        headers: { 'x-correlation-id': request.correlation_id }
      });
      return await this.handleResponse(res, request.correlation_id);
    } catch (error: any) {
      if (error instanceof HcmTransientError || error instanceof HcmPermanentError) throw error;
      this.handleError(error, request.correlation_id);
    }
  }
}

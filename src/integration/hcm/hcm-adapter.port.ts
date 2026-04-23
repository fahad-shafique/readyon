// ─── HCM Adapter Port (Interface) ───────────────────────────────────

export const HCM_ADAPTER_PORT = Symbol('HCM_ADAPTER_PORT');

export interface HcmGetBalanceRequest {
  employee_id: string;
  leave_type: string;
  correlation_id: string;
}

export interface HcmGetBalanceResponse {
  employee_id: string;
  leave_type: string;
  total_balance: number;
  used_balance: number;
  hcm_version: string;
}

export interface HcmPostTimeOffRequest {
  idempotency_key: string;
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  hours: number;
  correlation_id: string;
}

export interface HcmPostTimeOffResponse {
  hcm_reference_id: string;
  status: 'ACCEPTED';
  hcm_version: string;
}

export interface HcmCancelTimeOffRequest {
  idempotency_key: string;
  hcm_reference_id: string;
  employee_id: string;
  leave_type: string;
  correlation_id: string;
}

export interface HcmCancelTimeOffResponse {
  status: 'CANCELLED';
  hcm_version: string;
}

export interface HcmBatchBalancesRequest {
  since_checkpoint: string;
  correlation_id: string;
}

export interface HcmBalanceItem {
  employee_id: string;
  leave_type: string;
  total_balance: number;
  used_balance: number;
  hcm_version: string;
}

export interface HcmBatchBalancesResponse {
  checkpoint: string;
  items: HcmBalanceItem[];
}

export interface HcmAdapterPort {
  getBalance(request: HcmGetBalanceRequest): Promise<HcmGetBalanceResponse>;
  postTimeOff(request: HcmPostTimeOffRequest): Promise<HcmPostTimeOffResponse>;
  cancelTimeOff(request: HcmCancelTimeOffRequest): Promise<HcmCancelTimeOffResponse>;
  getBatchBalances(request: HcmBatchBalancesRequest): Promise<HcmBatchBalancesResponse>;
}

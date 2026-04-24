import { HttpHcmAdapter } from './http-hcm-adapter';
import { HcmTransientError, HcmPermanentError } from './hcm-errors';

describe('HttpHcmAdapter', () => {
  let adapter: HttpHcmAdapter;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    adapter = new HttpHcmAdapter();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getBalance', () => {
    it('should return balance on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          employee_id: 'emp-001',
          leave_type: 'PTO',
          total_balance: 100,
          used_balance: 10,
          hcm_version: 'v1',
        }),
      });

      const res = await adapter.getBalance({
        employee_id: 'emp-001',
        leave_type: 'PTO',
        correlation_id: 'corr-123',
      });

      expect(res.total_balance).toBe(100);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('employee_id=emp-001'),
        expect.objectContaining({
          headers: { 'x-correlation-id': 'corr-123' },
        }),
      );
    });

    it('should throw HcmTransientError on 500', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Server Error' }),
      });

      await expect(
        adapter.getBalance({
          employee_id: 'emp-001',
          leave_type: 'PTO',
          correlation_id: 'corr-123',
        }),
      ).rejects.toThrow(HcmTransientError);
    });

    it('should throw HcmPermanentError on 400', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Bad Request' }),
      });

      await expect(
        adapter.getBalance({
          employee_id: 'emp-001',
          leave_type: 'PTO',
          correlation_id: 'corr-123',
        }),
      ).rejects.toThrow(HcmPermanentError);
    });
  });

  describe('postTimeOff', () => {
    it('should post time off successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hcm_reference_id: 'ref-123',
          status: 'ACCEPTED',
          hcm_version: 'v2',
        }),
      });

      const res = await adapter.postTimeOff({
        employee_id: 'emp-001',
        leave_type: 'PTO',
        hours: 8,
        start_date: '2026-01-01',
        end_date: '2026-01-01',
        idempotency_key: 'idem-123',
        correlation_id: 'corr-123',
      });

      expect(res.hcm_reference_id).toBe('ref-123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/time-off'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"hours":8'),
        }),
      );
    });
  });

  describe('cancelTimeOff', () => {
    it('should cancel successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'CANCELLED', hcm_version: 'v3' }),
      });

      const res = await adapter.cancelTimeOff({
        hcm_reference_id: 'ref-123',
        employee_id: 'emp-001',
        idempotency_key: 'idem-456',
        correlation_id: 'corr-789',
      });

      expect(res.status).toBe('CANCELLED');
    });
  });

  describe('getBatchBalances', () => {
    it('should fetch batch with checkpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ checkpoint: 'v4', items: [] }),
      });

      const res = await adapter.getBatchBalances({
        since_checkpoint: 'v2',
        correlation_id: 'corr-000',
      });

      expect(res.checkpoint).toBe('v4');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('since=v2'),
        expect.any(Object),
      );
    });
  });

  describe('error handling', () => {
    it('should handle network errors as transient', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection Failed'));

      await expect(
        adapter.getBalance({
          employee_id: 'emp-001',
          leave_type: 'PTO',
          correlation_id: 'corr-123',
        }),
      ).rejects.toThrow(HcmTransientError);
    });
  });
});

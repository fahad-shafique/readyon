import { generateId, nowISO, calculateExponentialBackoff } from './index';

describe('Utils', () => {
  describe('generateId', () => {
    it('should generate UUID v4 format', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('nowISO', () => {
    it('should return ISO format timestamp', () => {
      const ts = nowISO();
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('calculateExponentialBackoff', () => {
    it('should return increasing delays', () => {
      const d0 = calculateExponentialBackoff(0).getTime() - Date.now();
      const d1 = calculateExponentialBackoff(1).getTime() - Date.now();
      const d2 = calculateExponentialBackoff(2).getTime() - Date.now();

      expect(d1).toBeGreaterThan(d0);
      expect(d2).toBeGreaterThan(d1);
    });

    it('should cap at max delay', () => {
      const d10 = calculateExponentialBackoff(10).getTime() - Date.now();
      // Max is 900,000ms = 15 min
      expect(d10).toBeLessThanOrEqual(910_000); // slight tolerance for jitter
    });

    it('should return future dates', () => {
      for (let i = 0; i < 5; i++) {
        expect(calculateExponentialBackoff(i).getTime()).toBeGreaterThan(Date.now());
      }
    });
  });
});

import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function nowISO(): string {
  return new Date().toISOString().replace('T', 'T').replace('Z', 'Z');
}

export function calculateExponentialBackoff(retryCount: number): Date {
  const baseDelayMs = 10_000;
  const maxDelayMs = 900_000;
  const jitterMs = Math.random() * 5_000;
  const delayMs = Math.min(baseDelayMs * Math.pow(3, retryCount) + jitterMs, maxDelayMs);
  return new Date(Date.now() + delayMs);
}

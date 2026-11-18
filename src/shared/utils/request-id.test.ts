import { describe, it, expect, vi, afterEach } from 'vitest';
import { newRequestId } from './request-id';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newRequestId', () => {
  it('returns a different id on every call', () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });

  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-from-crypto' });
    expect(newRequestId()).toBe('uuid-from-crypto');
  });

  it('falls back to a random hex id without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newRequestId()).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{8}){3}$/);
  });
});

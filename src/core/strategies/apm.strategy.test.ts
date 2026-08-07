import { describe, it, expect } from 'vitest';
import { buildApmPaymentMethod } from './apm.strategy';

describe('buildApmPaymentMethod', () => {
  // The SDK does not re-case the code. Rewriting it made the same value reach
  // Tonder differently through the SDK than server-to-server, and the backend
  // stores it verbatim, so the merchant's webhook echoed a spelling they never
  // typed. Every comparison downstream normalizes on its own side.
  it('passes the code through untouched and omits apm_config when none is given', () => {
    const pm = buildApmPaymentMethod({ apm: 'OXXOPAY' });

    expect(pm).toEqual({ type: 'OXXOPAY' });
    expect('apm_config' in pm).toBe(false);
  });

  it('leaves SafetyPay spelling to the merchant', () => {
    expect(buildApmPaymentMethod({ apm: 'safetypaycash' })).toEqual({
      type: 'safetypaycash',
    });
    expect(buildApmPaymentMethod({ apm: 'safetypayCash' })).toEqual({
      type: 'safetypayCash',
    });
    expect(buildApmPaymentMethod({ apm: 'SAFETYPAYTRANSFER' })).toEqual({
      type: 'SAFETYPAYTRANSFER',
    });
  });

  it('includes apm_config when a non-empty config is given', () => {
    const pm = buildApmPaymentMethod({
      apm: 'SAFETYPAYCASH',
      config: { country: 'MX', channel: 'cash', bank_ids: [1, 2] },
    });

    expect(pm).toEqual({
      type: 'SAFETYPAYCASH',
      apm_config: { country: 'MX', channel: 'cash', bank_ids: [1, 2] },
    });
  });

  it('suppresses apm_config when the config is an empty object', () => {
    const pm = buildApmPaymentMethod({ apm: 'oxxopay', config: {} });

    expect(pm).toEqual({ type: 'oxxopay' });
    expect('apm_config' in pm).toBe(false);
  });
});

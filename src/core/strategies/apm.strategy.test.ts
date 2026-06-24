import { describe, it, expect } from 'vitest';
import { buildApmPaymentMethod } from './apm.strategy';

describe('buildApmPaymentMethod', () => {
  it('normalizes regular payment method codes to lowercase and omits apm_config when no config given', () => {
    const pm = buildApmPaymentMethod({ apm: 'OXXOPAY' });

    expect(pm).toEqual({ type: 'oxxopay' });
    expect('apm_config' in pm).toBe(false);
  });

  it('canonicalizes SafetyPay cash for the downstream APM processor', () => {
    expect(buildApmPaymentMethod({ apm: 'safetypaycash' })).toEqual({
      type: 'safetypayCash',
    });
  });

  it('canonicalizes SafetyPay transfer for the downstream APM processor', () => {
    expect(buildApmPaymentMethod({ apm: 'SAFETYPAYTRANSFER' })).toEqual({
      type: 'safetypayTransfer',
    });
  });

  it('includes apm_config when a non-empty config is given', () => {
    const pm = buildApmPaymentMethod({
      apm: 'SAFETYPAYCASH',
      config: { country: 'MX', channel: 'cash', bank_ids: [1, 2] },
    });

    expect(pm).toEqual({
      type: 'safetypayCash',
      apm_config: { country: 'MX', channel: 'cash', bank_ids: [1, 2] },
    });
  });

  it('suppresses apm_config when the config is an empty object', () => {
    const pm = buildApmPaymentMethod({ apm: 'oxxopay', config: {} });

    expect(pm).toEqual({ type: 'oxxopay' });
    expect('apm_config' in pm).toBe(false);
  });
});

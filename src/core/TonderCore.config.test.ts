/**
 * The identity guarantee, asserted at the only place it can be asserted.
 *
 * Once the facade's instance fields are truly private, `tonder.core` reads as
 * `undefined` from outside the bundle, so there is no reachable call path to
 * `getConfig()` from a merchant, a built-artifact probe, or an end-to-end test.
 * That unreachability is itself part of the guarantee — but it means this file,
 * holding a core object directly, is the one place that can prove the returned
 * config is not the merchant's own object.
 */
import { describe, it, expect } from 'vitest';
import { TonderCore } from './TonderCore';
import type { TonderConfig } from '../shared/types';

function makeConfig(): TonderConfig {
  return {
    api_key: 'pk_test_123',
    environment: 'sandbox',
    session: {
      customer: { email: 'ada@example.com', first_name: 'Ada' },
      secure_token: 'T1',
    },
  };
}

describe('TonderCore config identity', () => {
  it('does not return the object it was constructed with', () => {
    const original = makeConfig();
    const core = new TonderCore(original);

    expect(core.getConfig()).not.toBe(original);
    expect(core.getConfig().session).not.toBe(original.session);
    expect(core.getConfig().session?.customer).not.toBe(
      original.session?.customer,
    );
  });

  it('returns the same object on every call', () => {
    const core = new TonderCore(makeConfig());
    expect(core.getConfig()).toBe(core.getConfig());
  });

  it('is unaffected by later mutation of the constructed-with object', () => {
    const original = makeConfig();
    const core = new TonderCore(original);

    original.session!.customer = { email: 'mallory@example.com' };
    original.session!.secure_token = 'T2';

    expect(core.getConfig().session?.customer?.email).toBe('ada@example.com');
    expect(core.getConfig().session?.secure_token).toBe('T1');
  });
});

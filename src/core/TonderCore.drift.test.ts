/**
 * Config drift detection: turning a silent semantic change into a named line.
 *
 * This change deliberately breaks integrations that work in production today.
 * A merchant who writes `cfg.session.customer.email = x` after construction now
 * gets no error, no failed request, and a payment attributed to the wrong
 * shopper — the first person to notice would otherwise be support.
 *
 * Everything here is observation only. It cannot change a request, a return
 * value, or control flow, and it cannot throw: the config being inspected
 * belongs to the merchant and may be built out of accessors that throw.
 */
import { describe, it, expect, vi } from 'vitest';
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

describe('TonderCore drift detection', () => {
  it('stays silent when nothing was mutated', () => {
    const onDrift = vi.fn();
    const core = new TonderCore(makeConfig(), onDrift);

    core.getConfig();
    core.getConfig();

    expect(onDrift).not.toHaveBeenCalled();
  });

  it('reports a replaced secure_token', () => {
    const onDrift = vi.fn();
    const original = makeConfig();
    const core = new TonderCore(original, onDrift);

    original.session!.secure_token = 'T2';
    core.getConfig();

    expect(onDrift).toHaveBeenCalledWith('session.secure_token');
  });

  it('reports an IN-PLACE customer field change, which reference identity misses', () => {
    const onDrift = vi.fn();
    const original = makeConfig();
    const core = new TonderCore(original, onDrift);

    // Same object, one field rewritten. This is the shape actually reported by
    // QA, and a check comparing only object identity would see nothing.
    original.session!.customer!.email = 'mallory@example.com';
    core.getConfig();

    expect(onDrift).toHaveBeenCalledWith('session.customer');
  });

  it('reports a wholesale customer replacement', () => {
    const onDrift = vi.fn();
    const original = makeConfig();
    const core = new TonderCore(original, onDrift);

    original.session!.customer = { email: 'mallory@example.com' };
    core.getConfig();

    expect(onDrift).toHaveBeenCalledWith('session.customer');
  });

  it('reports at most once per instance, however many calls observe it', () => {
    const onDrift = vi.fn();
    const original = makeConfig();
    const core = new TonderCore(original, onDrift);

    original.session!.secure_token = 'T2';
    original.session!.customer!.email = 'mallory@example.com';
    core.getConfig();
    core.getConfig();
    core.getConfig();

    expect(onDrift).toHaveBeenCalledTimes(1);
  });

  it('still returns the snapshot value when it reports drift', () => {
    const original = makeConfig();
    const core = new TonderCore(original, vi.fn());

    original.session!.secure_token = 'T2';

    expect(core.getConfig().session?.secure_token).toBe('T1');
  });

  it('survives a sink that throws, and does not retry it', () => {
    const onDrift = vi.fn(() => {
      throw new Error('merchant logger blew up');
    });
    const original = makeConfig();
    const core = new TonderCore(original, onDrift);

    original.session!.secure_token = 'T2';

    expect(() => core.getConfig()).not.toThrow();
    expect(() => core.getConfig()).not.toThrow();
    // Latched BEFORE the sink runs, so a throwing sink cannot reopen the gate.
    expect(onDrift).toHaveBeenCalledTimes(1);
  });

  it('survives an original config whose session getter throws', () => {
    const onDrift = vi.fn();
    const original = makeConfig();
    const core = new TonderCore(original, onDrift);

    Object.defineProperty(original, 'session', {
      get: () => {
        throw new Error('merchant getter blew up');
      },
      configurable: true,
    });

    expect(() => core.getConfig()).not.toThrow();
    expect(core.getConfig().session?.secure_token).toBe('T1');
  });

  it('works without a sink at all', () => {
    const original = makeConfig();
    const core = new TonderCore(original);

    original.session!.secure_token = 'T2';

    expect(() => core.getConfig()).not.toThrow();
  });

  it('reports a key skipped because its getter threw at construction', () => {
    const onDrift = vi.fn();
    const original = makeConfig() as TonderConfig & { boom?: unknown };
    Object.defineProperty(original, 'boom', {
      get: () => {
        throw new Error('merchant getter blew up');
      },
      enumerable: true,
    });

    new TonderCore(original, onDrift);

    expect(onDrift).toHaveBeenCalledWith('boom');
  });
});

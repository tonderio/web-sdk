/**
 * Unit tests for the construction-time config snapshot.
 *
 * The clone rule under test: recurse plain objects and arrays ONLY; copy
 * everything else (functions, class instances, Date, Map, URL, DOM nodes) by
 * reference. `structuredClone` is not usable here — it throws on functions,
 * and a merchant callback anywhere in `customization` would turn
 * `createTonder()` into a throw.
 *
 * `events` is the deliberate carve-out: it is excluded from the clone and
 * replaced by an accessor pair onto the merchant's original object, because
 * README documents assigning `config.events.payment` after `createTonder()`.
 */
import { describe, it, expect, vi } from 'vitest';
import { createConfigSnapshot } from './snapshot';
import type { TonderConfig } from '../types';

function baseConfig(): TonderConfig {
  return {
    api_key: 'pk_test_123',
    environment: 'sandbox',
    session: {
      customer: { email: 'ada@example.com', first_name: 'Ada' },
      secure_token: 'T1',
    },
  };
}

/** Attaches an arbitrary extra key, since TonderConfig is a closed interface. */
function withExtra(value: unknown): TonderConfig {
  const config = baseConfig() as TonderConfig & { extra?: unknown };
  config.extra = value;
  return config;
}

function extraOf(snapshot: TonderConfig): unknown {
  return (snapshot as TonderConfig & { extra?: unknown }).extra;
}

describe('createConfigSnapshot — clone semantics', () => {
  it('returns a different object than the one passed in', () => {
    const original = baseConfig();
    const snapshot = createConfigSnapshot(original);
    expect(snapshot).not.toBe(original);
  });

  it('deep-copies plain nested objects so later mutation is inert', () => {
    const original = baseConfig();
    const snapshot = createConfigSnapshot(original);

    expect(snapshot.session).not.toBe(original.session);
    expect(snapshot.session?.customer).not.toBe(original.session?.customer);

    original.session!.customer!.email = 'mallory@example.com';
    original.session!.secure_token = 'T2';

    expect(snapshot.session?.customer?.email).toBe('ada@example.com');
    expect(snapshot.session?.secure_token).toBe('T1');
  });

  it('copies arrays into new arrays and recurses their plain elements', () => {
    const original = withExtra([{ a: 1 }, { b: 2 }]);
    const snapshot = createConfigSnapshot(original);
    const cloned = extraOf(snapshot) as { a?: number }[];
    const source = (original as TonderConfig & { extra: { a?: number }[] })
      .extra;

    expect(cloned).not.toBe(source);
    expect(cloned[0]).not.toBe(source[0]);
    expect(cloned).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('treats a prototype-less object as plain and recurses it', () => {
    const bag = Object.create(null) as Record<string, unknown>;
    bag.nested = { deep: 'value' };
    const original = withExtra(bag);
    const snapshot = createConfigSnapshot(original);
    const cloned = extraOf(snapshot) as Record<string, unknown>;

    expect(cloned).not.toBe(bag);
    expect(cloned.nested).not.toBe(bag.nested);
    expect((cloned.nested as { deep: string }).deep).toBe('value');
  });

  it('copies class instances by reference — Date, Map, URL, and a merchant class', () => {
    class Merchant {
      constructor(public id = 'm1') {}
    }
    const date = new Date(0);
    const map = new Map([['k', 'v']]);
    const url = new URL('https://acme.test');
    const instance = new Merchant();
    const original = withExtra({ date, map, url, instance });
    const snapshot = createConfigSnapshot(original);
    const cloned = extraOf(snapshot) as Record<string, unknown>;

    expect(cloned.date).toBe(date);
    expect(cloned.map).toBe(map);
    expect(cloned.url).toBe(url);
    expect(cloned.instance).toBe(instance);
  });

  it('copies an array of class instances into a new array holding the same references', () => {
    const first = new Date(0);
    const second = new Date(1000);
    const original = withExtra([first, second]);
    const snapshot = createConfigSnapshot(original);
    const cloned = extraOf(snapshot) as Date[];
    const source = (original as TonderConfig & { extra: Date[] }).extra;

    expect(cloned).not.toBe(source);
    expect(cloned[0]).toBe(first);
    expect(cloned[1]).toBe(second);
  });

  it('copies function values by reference', () => {
    const callback = (): string => 'called';
    const original = withExtra({ callback });
    const snapshot = createConfigSnapshot(original);

    expect((extraOf(snapshot) as { callback: unknown }).callback).toBe(
      callback,
    );
  });

  it('copies a DOM node by reference', () => {
    const node = document.createElement('div');
    const original = withExtra({ node });
    const snapshot = createConfigSnapshot(original);

    expect((extraOf(snapshot) as { node: unknown }).node).toBe(node);
  });

  it('copies primitives, null and undefined by value', () => {
    const original = withExtra({
      str: 'x',
      num: 1,
      bool: true,
      nothing: null,
      missing: undefined,
    });
    const snapshot = createConfigSnapshot(original);

    expect(extraOf(snapshot)).toEqual({
      str: 'x',
      num: 1,
      bool: true,
      nothing: null,
      missing: undefined,
    });
  });
});

describe('createConfigSnapshot — getters', () => {
  it('invokes a normally-returning getter exactly once and clones its value', () => {
    const inner = { deep: 'value' };
    const read = vi.fn(() => inner);
    const original = baseConfig() as TonderConfig & { extra?: unknown };
    Object.defineProperty(original, 'extra', { get: read, enumerable: true });

    const snapshot = createConfigSnapshot(original);

    expect(read).toHaveBeenCalledTimes(1);
    expect(extraOf(snapshot)).not.toBe(inner);
    expect(extraOf(snapshot)).toEqual({ deep: 'value' });
  });

  it('skips a throwing getter, keeps cloning other keys, and never throws out', () => {
    const original = baseConfig() as TonderConfig & {
      boom?: unknown;
      safe?: unknown;
    };
    Object.defineProperty(original, 'boom', {
      get: () => {
        throw new Error('merchant getter blew up');
      },
      enumerable: true,
    });
    original.safe = { kept: true };

    const snapshot = createConfigSnapshot(original) as TonderConfig & {
      boom?: unknown;
      safe?: unknown;
    };

    expect('boom' in snapshot).toBe(false);
    expect(snapshot.safe).toEqual({ kept: true });
    expect(snapshot.api_key).toBe('pk_test_123');
  });

  it('reports each skipped key through the optional sink', () => {
    const onSkippedKey = vi.fn();
    const original = baseConfig() as TonderConfig & { boom?: unknown };
    Object.defineProperty(original, 'boom', {
      get: () => {
        throw new Error('merchant getter blew up');
      },
      enumerable: true,
    });

    createConfigSnapshot(original, onSkippedKey);

    expect(onSkippedKey).toHaveBeenCalledTimes(1);
    expect(onSkippedKey).toHaveBeenCalledWith('boom');
  });
});

describe('createConfigSnapshot — depth cap', () => {
  it('copies by reference at and beyond the cap instead of overflowing the stack', () => {
    // 40 levels deep, well past the cap of 8. A cycle-set implementation would
    // keep recursing; the cap must stop and alias instead.
    type Chain = { next?: Chain; marker?: string };
    const root: Chain = {};
    let cursor = root;
    for (let level = 0; level < 40; level += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    cursor.marker = 'leaf';

    const original = withExtra(root);
    const snapshot = createConfigSnapshot(original);

    let clonedCursor = extraOf(snapshot) as Chain;
    let sourceCursor = root;
    let aliasedAt = -1;
    for (let level = 0; level < 40; level += 1) {
      if (clonedCursor === sourceCursor) {
        aliasedAt = level;
        break;
      }
      clonedCursor = clonedCursor.next!;
      sourceCursor = sourceCursor.next!;
    }

    expect(aliasedAt).toBeGreaterThan(0);
    expect(aliasedAt).toBeLessThan(40);
  });

  it('survives a self-referential config without throwing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const original = withExtra(cyclic);

    expect(() => createConfigSnapshot(original)).not.toThrow();
  });
});

describe('createConfigSnapshot — events are captured, not aliased', () => {
  it('ignores a single callback swapped in place afterwards', () => {
    const passed = (): void => undefined;
    const swapped = (): void => undefined;
    const original = baseConfig();
    original.events = { payment: { on_completed: passed } };

    const snapshot = createConfigSnapshot(original);
    original.events.payment!.on_completed = swapped;

    expect(snapshot.events?.payment?.on_completed).toBe(passed);
  });

  it('ignores a wholesale replacement of events', () => {
    const injected = (): void => undefined;
    const original = baseConfig();
    original.events = { payment: {} };

    const snapshot = createConfigSnapshot(original);
    original.events = { payment: { on_completed: injected } };

    expect(snapshot.events?.payment?.on_completed).toBeUndefined();
  });

  it('ignores events assigned when the input had none', () => {
    const injected = (): void => undefined;
    const original = baseConfig();

    const snapshot = createConfigSnapshot(original);
    original.events = { payment: { on_completed: injected } };

    expect(snapshot.events).toBeUndefined();
  });

  it('keeps presentation and payment independent of each other', () => {
    const onOpen = (): void => undefined;
    const original = baseConfig();
    original.events = { presentation: { on_open: onOpen } };

    const snapshot = createConfigSnapshot(original);
    original.events.presentation!.on_open = (): void => undefined;

    expect(snapshot.events?.presentation?.on_open).toBe(onOpen);
    expect(snapshot.events?.payment).toBeUndefined();
  });

  it('survives an events getter that throws, losing only the callbacks', () => {
    const original = baseConfig();
    Object.defineProperty(original, 'events', {
      get: () => {
        throw new Error('hostile getter');
      },
      configurable: true,
      enumerable: true,
    });
    const skipped: string[] = [];

    const snapshot = createConfigSnapshot(original, (key) => skipped.push(key));

    expect(snapshot.api_key).toBe(baseConfig().api_key);
    expect(skipped).toContain('events');
  });

  it('keeps events enumerable on the snapshot', () => {
    const original = baseConfig();
    original.events = { payment: {} };
    const snapshot = createConfigSnapshot(original);

    expect(Object.keys(snapshot)).toContain('events');
  });
});

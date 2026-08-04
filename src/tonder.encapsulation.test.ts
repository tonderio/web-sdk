/**
 * The instance must not hand a merchant its own internals.
 *
 * TypeScript's `private` is erased at build time: every field stayed an own
 * enumerable property at runtime, so `Object.keys(tonder)` listed the transport
 * client, the services and the core state object, and `JSON.stringify(tonder)`
 * dumped the whole graph — API keys and session credentials included — into
 * whatever logger a merchant pointed at it.
 *
 * The compiler cannot verify any of this: `tsconfig.json` excludes test files
 * from `tsc`, so a green typecheck says nothing here. Only the runtime suite
 * proves it.
 *
 * Scope, stated rather than implied: this closes the ENUMERABLE STATE surface.
 * Methods declared `private` in TypeScript are still erased and still reachable
 * on the prototype, so `tonder.runPay` remains callable. That is a separate
 * problem and this file does not claim otherwise.
 */
import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import type { HttpPort } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { TonderConfig } from './shared/types';

function makeConfig(): TonderConfig {
  return {
    api_key: 'pk_test_123',
    environment: 'sandbox',
    session: {
      customer: { email: 'ada@example.com' },
      secure_token: 'T1',
    },
  };
}

function silentHttp(): HttpPort {
  return asHttpPort(() => Promise.resolve({}));
}

function noopTokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    reveal: vi.fn(() => Promise.resolve()),
    collect: vi.fn(() => Promise.resolve({})),
  };
}

function makeTonder() {
  return _createTonderWithDeps({
    config: makeConfig(),
    http: silentHttp(),
    tokenizer: noopTokenizer(),
  });
}

describe('Tonder instance surface', () => {
  it('exposes no own enumerable property', () => {
    expect(Object.keys(makeTonder())).toEqual([]);
  });

  it('serializes to an empty object', () => {
    const serialized = JSON.stringify(makeTonder());

    expect(serialized).toBe('{}');
    // Named explicitly: these are the values that must never reach a log line.
    expect(serialized).not.toContain('pk_test_123');
    expect(serialized).not.toContain('ada@example.com');
    expect(serialized).not.toContain('T1');
  });

  it('yields undefined for the internal collaborators reachable by name today', () => {
    const tonder = makeTonder() as unknown as Record<string, unknown>;

    expect(tonder.core).toBeUndefined();
    expect(tonder.http).toBeUndefined();
    expect(tonder.paymentEvents).toBeUndefined();
  });

  it('leaks nothing through spread or for...in either', () => {
    const tonder = makeTonder();

    expect({ ...tonder }).toEqual({});
    const seen: string[] = [];
    for (const key in tonder) seen.push(key);
    expect(seen.filter((key) => Object.hasOwn(tonder, key))).toEqual([]);
  });
});

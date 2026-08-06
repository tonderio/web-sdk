import type { TonderConfig, TonderEvents } from '../types';

/**
 * How deep the clone recurses before it starts aliasing instead.
 *
 * `TonderConfig`'s deepest real path is three levels, so nothing a merchant can
 * legitimately pass reaches this cap. It exists so a cyclic or absurdly nested
 * object degrades to aliasing instead of overflowing the stack and turning
 * `createTonder()` into a new throw.
 *
 * NOT a seen-set: that would preserve shared references faithfully, and
 * destroying aliasing is the whole point of the snapshot.
 */
const MAX_DEPTH = 8;

/**
 * Notified with the name of a key that could not be read. Reading a property
 * runs the merchant's getter, and a getter that throws must not take
 * `createTonder()` down with it.
 */
export type SkippedKeyReporter = (field: string) => void;

/**
 * Deep-copies plain objects and arrays; returns everything else as-is.
 *
 * The plain test is deliberately strict. A `Date`, a `Map`, a DOM node or a
 * merchant's class instance carries invariants this module cannot reproduce, so
 * copying it incorrectly is worse than aliasing it. Functions likewise.
 *
 * `structuredClone` is not an option: it throws on functions, so a merchant
 * callback under `customization` would become a `TypeError` in a shopper's
 * browser.
 */
function clonePlainDeep<T>(
  value: T,
  depth: number,
  onSkippedKey?: SkippedKeyReporter,
): T {
  if (depth >= MAX_DEPTH) return value;
  if (typeof value !== 'object' || value === null) return value;

  if (Array.isArray(value)) {
    return value.map((item: unknown) =>
      clonePlainDeep(item, depth + 1, onSkippedKey),
    ) as unknown as T;
  }

  const proto = Object.getPrototypeOf(value) as object | null;
  const isPlain = proto === Object.prototype || proto === null;
  if (!isPlain) return value;

  return copyOwnKeys(
    value as unknown as Record<string, unknown>,
    depth,
    onSkippedKey,
  ) as unknown as T;
}

/**
 * Copies own enumerable keys, guarding each read individually.
 *
 * `Object.keys` rather than `for...in`: inherited properties are not part of
 * the config shape. A key whose read throws is omitted, which leaves the SDK
 * seeing it as absent — a state every optional config key already handles.
 */
function copyOwnKeys(
  source: Record<string, unknown>,
  depth: number,
  onSkippedKey?: SkippedKeyReporter,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    let read: unknown;
    try {
      read = source[key];
    } catch {
      onSkippedKey?.(key);
      continue;
    }
    copy[key] = clonePlainDeep(read, depth + 1, onSkippedKey);
  }
  return copy;
}

/**
 * Produces the config the SDK reads for the rest of the instance's lifetime.
 *
 * Every key is copied by value at construction, so a merchant who writes to
 * their own reference afterwards changes nothing the SDK will send. The write
 * is inert, not rejected.
 *
 * `events` is the one documented exception, handled by EXCLUSION rather than by
 * copying: the key is left out of the clone and an accessor pair installed in
 * its place, reading the merchant's original object at the moment each event
 * fires. Excluding it — rather than keeping the sub-object by reference — is
 * what makes "no `events` at construction" work: there is no key to alias, so
 * the merchant's later assignment would otherwise be invisible.
 *
 * The setter exists because an accessor without one throws a `TypeError` on
 * assignment in strict mode, and bundled ESM is always strict.
 */
export function createConfigSnapshot(
  original: TonderConfig,
  onSkippedKey?: SkippedKeyReporter,
): TonderConfig {
  const source = original as unknown as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};

  for (const key of Object.keys(source)) {
    if (key === 'events') continue;
    let read: unknown;
    try {
      read = source[key];
    } catch {
      onSkippedKey?.(key);
      continue;
    }
    snapshot[key] = clonePlainDeep(read, 1, onSkippedKey);
  }

  Object.defineProperty(snapshot, 'events', {
    get: () => original.events,
    set: (next: TonderEvents | undefined) => {
      original.events = next;
    },
    enumerable: true,
    configurable: true,
  });

  return snapshot as unknown as TonderConfig;
}

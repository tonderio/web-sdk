import { describe, it, expect } from 'vitest';
import { resolveEnv, type TonderMode } from './env';

describe('resolveEnv', () => {
  it('keeps production on the legacy CloudFront asset distribution', () => {
    // Merchants run pinned copies of this SDK, and that distribution keeps
    // serving them until they upgrade. Moving it would break installed
    // integrations, so production must stay put.
    expect(resolveEnv('production').assets).toBe(
      'https://d35a75syrgujp0.cloudfront.net',
    );
  });

  it.each<TonderMode>(['stage', 'sandbox'])(
    'serves %s assets from the staging host',
    (mode) => {
      expect(resolveEnv(mode).assets).toBe('https://static.staging.tonder.io');
    },
  );

  it('falls back to the production asset host for an unrecognized mode', () => {
    expect(resolveEnv('nope' as TonderMode).assets).toBe(
      resolveEnv('production').assets,
    );
  });
});

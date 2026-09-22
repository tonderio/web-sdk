// @vitest-environment node
//
// The default jsdom environment rewrites `import.meta.url` to a non-file URL,
// which the server module resolves the repo root from.

import { basename, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot, resolveRequestPath } from './server.mjs';

const fixtureDir = join(repoRoot, 'e2e', 'fixture');

/**
 * The absolute request form (`GET http://host/... HTTP/1.1`), which Node's HTTP
 * parser accepts and passes through as `req.url` scheme and all. `scheme:` and
 * `host` absorb the first two `..`, so the rest climb out of the fixture dir.
 */
function absoluteForm(climbs, tail) {
  return `http://evil.test/${'../'.repeat(climbs + 2)}${tail}`;
}

describe('resolveRequestPath', () => {
  it('serves the fixture page at the root', () => {
    expect(resolveRequestPath('/')).toBe(join(fixtureDir, 'checkout.html'));
  });

  it('serves the built bundle from the repo root', () => {
    expect(resolveRequestPath('/dist/tonder-web-sdk.js')).toBe(
      join(repoRoot, 'dist', 'tonder-web-sdk.js'),
    );
  });

  it('serves a fixture asset and ignores the query string', () => {
    expect(resolveRequestPath('/checkout.html?merchant=42')).toBe(
      join(fixtureDir, 'checkout.html'),
    );
  });

  it('keeps a rooted traversal inside the fixture dir', () => {
    // `normalize` collapses leading `..` against the filesystem root, so this
    // never escapes — it just names a file that does not exist.
    expect(resolveRequestPath('/../../../../etc/passwd')).toBe(
      join(fixtureDir, 'etc', 'passwd'),
    );
  });

  it('rejects a traversal that reaches outside the repo root', () => {
    expect(resolveRequestPath(absoluteForm(4, 'etc/passwd'))).toBeNull();
  });

  it('rejects a sibling directory whose name starts with the repo root', () => {
    // The regression: `<repoRoot>-evil` passes a string-prefix check while
    // sitting outside the root. Three climbs from `e2e/fixture` land beside it.
    const sibling = `${basename(repoRoot)}-evil`;

    const escaped = resolveRequestPath(
      absoluteForm(3, `${sibling}/secret.txt`),
    );

    expect(escaped).toBeNull();
    expect(join(dirname(repoRoot), sibling).startsWith(repoRoot)).toBe(true);
  });

  it('rejects a percent-encoded traversal outside the repo root', () => {
    expect(
      resolveRequestPath(
        absoluteForm(4, '%65tc/passwd').replace(/\.\./g, '%2e%2e'),
      ),
    ).toBeNull();
  });
});

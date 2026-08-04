import { describe, expect, it } from 'vitest';

import {
  findForbiddenVocabulary,
  isScannableSourcePath,
} from './check-dist-vocabulary.mjs';

describe('findForbiddenVocabulary', () => {
  it('is importable', () => {
    expect(typeof findForbiddenVocabulary).toBe('function');
  });

  it('reports the all-caps INTERNAL tag inside a JSDoc block', () => {
    const source =
      '/** Detokenized card payload required by the COF subscription calls. INTERNAL. */';

    const findings = findForbiddenVocabulary(source);

    expect(findings).toHaveLength(1);
    expect(findings[0].termId).toBe('internal-tag');
    expect(findings[0].matched).toBe('INTERNAL');
  });

  it('ignores a forbidden term that appears in code rather than a comment', () => {
    const source = "payflow: 'https://payflow.tonder.io'";

    expect(findForbiddenVocabulary(source)).toEqual([]);
  });

  it('ignores lowercase "internal", which has legitimate English uses', () => {
    const source = '/** the internal controller merges signals */';

    expect(findForbiddenVocabulary(source)).toEqual([]);
  });

  it('ignores a forbidden term that only appears inside a URL', () => {
    const source = '/** see https://payflow.tonder.io for the hosted page */';

    expect(findForbiddenVocabulary(source)).toEqual([]);
  });

  it('still reports a forbidden term used as prose next to no URL', () => {
    const source = '/** the payflow iframe emits completion */';

    const findings = findForbiddenVocabulary(source);

    expect(findings).toHaveLength(1);
    expect(findings[0].termId).toBe('payflow');
  });

  it('ignores a comment sequence that is really inside a string literal', () => {
    const source = 'const s = "/* payflow */";';

    expect(findForbiddenVocabulary(source)).toEqual([]);
  });

  it.each([
    ['usrv-prefix', '/** proxied through usrv-payments */', 'usrv-payments'],
    ['design-decision', '/** own session (DD3). */', 'DD3'],
    ['ticket-id', '/** tracked in DEV-2277 */', 'DEV-2277'],
    ['plan-phase', '/** landed in phase 7 */', 'phase 7'],
    [
      'composition-seam',
      '/** COMPOSITION SEAM (wired in handleRequiresAction) */',
      'COMPOSITION SEAM',
    ],
    [
      'ionic-lite',
      "/** Ported from ionic-lite's Business type */",
      'ionic-lite',
    ],
    ['zplit', '/** routed by zplit */', 'zplit'],
    ['design-label', '/** cannot drift (D3). */', 'D3'],
  ])('reports %s', (termId, source, matched) => {
    const findings = findForbiddenVocabulary(source);

    expect(findings).toHaveLength(1);
    expect(findings[0].termId).toBe(termId);
    expect(findings[0].matched).toBe(matched);
  });

  it.each(['3DS', '3-D Secure', 'the 3D model'])(
    'does not mistake %s for a design label',
    (text) => {
      expect(findForbiddenVocabulary(`/** ${text} */`)).toEqual([]);
    },
  );

  it('counts a DD-prefixed label once, not twice', () => {
    const findings = findForbiddenVocabulary('/** own session (DD3). */');

    expect(findings).toHaveLength(1);
    expect(findings[0].termId).toBe('design-decision');
  });

  it('reports the 1-based line of the leak, not the line of the comment start', () => {
    const source = [
      '/**',
      ' * A harmless first line.',
      ' *',
      ' * Leaked by phase 7.',
      ' */',
    ].join('\n');

    const findings = findForbiddenVocabulary(source);

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(4);
  });

  it('reports the real dist/index.d.ts leaks verbatim', () => {
    const source = [
      '/**',
      " * Build an `'apple_pay_button'` component handle.",
      ' *',
      ' * `dispose` and `checkout` are CLOSURE variables, so every component owns its',
      " * own session (DD3). With one service per `Tonder`, a second button's",
      " * `unmount()` would abort the first button's live sheet.",
      ' */',
      'declare const a: number;',
      '/**',
      " * - `'embedded'`: present the redirect URL in the SDK-owned NON-closable modal",
      ' *   (`host.open(url, { closable: false })`), wait for the PRIMARY',
      ' *   `messenger.waitForCompletion` signal from the payflow iframe, then run a',
      ' *   short authoritative reconciliation poll via `getTransaction`.',
      ' */',
      'declare const b: number;',
      '/**',
      ' * COMPOSITION SEAM (payflow CheckoutMessenger — wired in',
      ' * `handleRequiresAction`): the embedded messenger is the PRIMARY completion',
      ' * signal, and this poll runs only after that signal as a short reconciliation',
      ' * loop. This helper merges `options.signal` into its internal controller and',
      ' * is single-resolution + cancelable by design.',
      ' */',
    ].join('\n');

    const findings = findForbiddenVocabulary(source);

    expect(findings.map((finding) => finding.termId)).toEqual([
      'design-decision',
      'payflow',
      'composition-seam',
      'payflow',
    ]);
  });
});

describe('line comments', () => {
  // The published bundles carry no leak-bearing line comment, and the spec
  // pins the default to block comments only. Source is different: `//` is
  // idiomatic there, and the clearest delete in this change
  // (`// phase 1 extracted component.ts.`) was a line comment.
  const source = '// phase 1 extracted `component.ts`.';

  it('ignores a line comment by default', () => {
    expect(findForbiddenVocabulary(source)).toEqual([]);
  });

  it('reports a line comment when the caller opts in', () => {
    const findings = findForbiddenVocabulary(source, {
      includeLineComments: true,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].termId).toBe('plan-phase');
    expect(findings[0].matched).toBe('phase 1');
  });

  it('still ignores a term in code when line comments are enabled', () => {
    const findings = findForbiddenVocabulary(
      "payflow: 'https://payflow.tonder.io',",
      { includeLineComments: true },
    );

    expect(findings).toEqual([]);
  });
});

describe('template literals do not blind the scanner', () => {
  // A standalone scanner needs `reScanTemplateToken` driven by hand. Without
  // it, the first `${...}` desynchronises tokenization and every later comment
  // becomes invisible — the guard then reports zero and looks healthy.
  it('finds a comment that follows a substitution template', () => {
    const source = [
      'const id = `update:${request.card_id}`;',
      '/** routed by zplit */',
    ].join('\n');

    const findings = findForbiddenVocabulary(source);

    expect(findings).toHaveLength(1);
    expect(findings[0].termId).toBe('zplit');
  });

  it('finds a comment after a template containing a nested object literal', () => {
    const source = [
      'const a = `x${ { k: `${inner}` } }y`;',
      '/** proxied through usrv-payments */',
    ].join('\n');

    expect(findForbiddenVocabulary(source)).toHaveLength(1);
  });

  it('still ignores a comment sequence inside a template literal', () => {
    const source = 'const a = `/* payflow */`;';

    expect(findForbiddenVocabulary(source)).toEqual([]);
  });
});

describe('isScannableSourcePath', () => {
  it.each([
    ['src/tonder.ts', true],
    ['src/ports/apple-pay.port.ts', true],
    // Test comments are deliberately out of scope: they are dense with design
    // references and no merchant reads them as integration guidance.
    ['src/tonder.pay.test.ts', false],
    ['src/shared/payment-method-catalog.test.ts', false],
    ['src/types/card.d.ts', false],
    ['src/styles.css', false],
  ])('%s -> %s', (path, expected) => {
    expect(isScannableSourcePath(path)).toBe(expected);
  });
});

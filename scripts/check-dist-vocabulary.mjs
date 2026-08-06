/**
 * Fails the build when internal-only vocabulary reaches a reader outside the
 * team. Two tiers, checked in order:
 *
 *   1. The published npm artifacts, derived from `package.json` `files`.
 *      Block comments only — `index.d.ts` drives every editor tooltip and the
 *      unminified bundles are readable in `node_modules` and on the CDN.
 *   2. Non-test `src/`, because the repository is PUBLIC and the docs portal
 *      links merchants directly to it. Line comments count here: `//` is
 *      idiomatic in source, and the clearest deletion this guard was built for
 *      (`// phase 1 extracted component.ts.`) was a line comment.
 *
 * Runs as npm `postbuild`, so it sees the artifacts rollup just produced —
 * and therefore also runs inside `prepublishOnly` and `pretest:e2e`.
 *
 * The two tiers are NOT equally enforced, and the asymmetry is deliberate: a
 * missing published artifact is a build defect and exits 2, while `src/` is
 * simply scanned as it stands.
 *
 * Scanner note: `ts.createScanner` is normally driven by the parser. Two
 * re-scan hooks matter here. `reScanTemplateToken` is driven explicitly below
 * — without it the first `${...}` desynchronises tokenization and every later
 * comment silently disappears, which once hid 21 real findings behind a green
 * check. `reScanSlashToken` is NOT driven, so a regex literal containing `/*`
 * could still be mis-tokenized; every forbidden term is alphabetic and no such
 * literal exists in either tier today. If this guard ever reports zero on a
 * file you know is dirty, suspect tokenization before trusting the result.
 *
 * Changing `FORBIDDEN_VOCABULARY` is not a local edit. Adding a term requires
 * checking it against the current tree so it does not match a legitimate,
 * non-leaking comment; removing one requires checking that no live leak still
 * depends on it. Nothing automated enforces this — it is reviewer discipline.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

export const FORBIDDEN_VOCABULARY = [
  {
    id: 'payflow',
    pattern: /\bpayflow\b/gi,
    reason:
      'Internal service name. Merchants integrate against the public SDK, not this host.',
  },
  {
    id: 'zplit',
    pattern: /\bzplit\b/gi,
    reason: 'Internal routing service name.',
  },
  {
    id: 'usrv-prefix',
    pattern: /\busrv-[a-z0-9-]+/gi,
    reason: 'Internal microservice naming scheme.',
  },
  {
    id: 'ionic-lite',
    pattern: /\bionic-lite\b/gi,
    reason: 'Predecessor internal codebase name.',
  },
  {
    id: 'composition-seam',
    pattern: /COMPOSITION SEAM/gi,
    reason: 'Internal architecture jargon; meaningless to a merchant.',
  },
  {
    id: 'internal-tag',
    pattern: /\bINTERNAL\b/g,
    reason:
      'All-caps visibility tag. If it is internal, it must not be in a published comment.',
  },
  {
    id: 'design-decision',
    pattern: /\bDD\d+\b/g,
    reason: 'Internal design-decision reference. Merchants cannot read it.',
  },
  {
    // Validated against the tree: matches no legitimate usage. `3DS`, `3-D
    // Secure` and `DD3` are all unaffected, because each lacks a word boundary
    // immediately before the `D`.
    id: 'design-label',
    pattern: /\bD\d+\b/g,
    reason:
      'Internal design-decision label. The document it cites is not in the reader’s hands.',
  },
  {
    id: 'plan-phase',
    pattern: /\bphase \d+\b/gi,
    reason: 'Internal delivery-plan reference.',
  },
  {
    id: 'ticket-id',
    pattern: /\bDEV-\d+\b/gi,
    reason: 'Internal issue tracker ID.',
  },
];

export const ALLOWLIST = [];

const MAX_COMMENT_LENGTH = 200;
const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * Source files a merchant can read on the public repository. Test files are
 * excluded on purpose: nobody reads them as integration guidance, and they are
 * dense with design references that would drown the signal.
 */
export function isScannableSourcePath(path) {
  if (!path.endsWith('.ts') || path.endsWith('.d.ts')) return false;
  return !path.endsWith('.test.ts');
}

function collectComments(source, scriptKind, includeLineComments) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ false,
    scriptKind === ts.ScriptKind.TSX
      ? ts.LanguageVariant.JSX
      : ts.LanguageVariant.Standard,
    source,
  );

  const comments = [];

  // Brace depth of each open template substitution, innermost last. The parser
  // normally tells the scanner when a `}` closes a `${...}` span; standalone we
  // have to track it, or the first substitution desynchronises tokenization and
  // every later comment silently disappears.
  const templateBraceDepths = [];

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.TemplateHead) {
      templateBraceDepths.push(0);
    } else if (templateBraceDepths.length > 0) {
      const depth = templateBraceDepths.length - 1;
      if (token === ts.SyntaxKind.OpenBraceToken) {
        templateBraceDepths[depth] += 1;
      } else if (token === ts.SyntaxKind.CloseBraceToken) {
        if (templateBraceDepths[depth] > 0) {
          templateBraceDepths[depth] -= 1;
        } else {
          token = scanner.reScanTemplateToken(/* isTaggedTemplate */ false);
          if (token === ts.SyntaxKind.TemplateTail) templateBraceDepths.pop();
        }
      }
    }

    const isComment =
      token === ts.SyntaxKind.MultiLineCommentTrivia ||
      (includeLineComments && token === ts.SyntaxKind.SingleLineCommentTrivia);
    if (isComment) {
      comments.push({
        start: scanner.getTokenStart(),
        text: source.slice(scanner.getTokenStart(), scanner.getTokenEnd()),
      });
    }
    token = scanner.scan();
  }

  return comments;
}

function maskUrls(text) {
  return text.replace(URL_PATTERN, (match) => ' '.repeat(match.length));
}

function collapse(text) {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_COMMENT_LENGTH
    ? `${collapsed.slice(0, MAX_COMMENT_LENGTH - 1)}…`
    : collapsed;
}

function positionAt(source, offset) {
  let line = 1;
  let lastLineStart = 0;
  for (let i = 0; i < offset; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
      lastLineStart = i + 1;
    }
  }
  return { line, column: offset - lastLineStart + 1 };
}

export function findForbiddenVocabulary(source, options = {}) {
  const terms = options.terms ?? FORBIDDEN_VOCABULARY;
  const allowlist = options.allowlist ?? ALLOWLIST;
  const scriptKind = options.scriptKind ?? ts.ScriptKind.TS;
  const includeLineComments = options.includeLineComments ?? false;

  const findings = [];

  for (const comment of collectComments(
    source,
    scriptKind,
    includeLineComments,
  )) {
    const collapsed = collapse(comment.text);
    if (allowlist.some((entry) => entry.test(collapsed))) continue;

    const masked = maskUrls(comment.text);

    for (const term of terms) {
      const pattern = new RegExp(term.pattern.source, term.pattern.flags);
      let match;
      while ((match = pattern.exec(masked)) !== null) {
        const offset = comment.start + match.index;
        const { line, column } = positionAt(source, offset);
        findings.push({
          termId: term.id,
          matched: match[0],
          reason: term.reason,
          line,
          column,
          offset,
          comment: collapsed,
        });
      }
    }
  }

  return findings.sort((a, b) => a.offset - b.offset);
}

const SCANNABLE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.d.ts'];

/**
 * Derives the guarded targets from `package.json` `files` rather than a second
 * hardcoded list, so a newly published artifact is guarded automatically.
 */
export function resolveTargets(packageJson) {
  return (packageJson.files ?? []).filter((entry) =>
    SCANNABLE_EXTENSIONS.some((extension) => entry.endsWith(extension)),
  );
}

const SOURCE_DIR = 'src';

/** Every scannable source file under `dir`, relative to `rootDir`. */
function collectSourceFiles(rootDir, dir = SOURCE_DIR) {
  const entries = readdirSync(join(rootDir, dir), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(rootDir, path));
    } else if (isScannableSourcePath(path)) {
      files.push(path);
    }
  }

  return files.sort();
}

function formatFindings(results, targetCount, heading, footer) {
  const lines = [heading, ''];
  let total = 0;

  for (const { target, findings } of results) {
    for (const finding of findings) {
      total += 1;
      lines.push(
        `${target}:${finding.line}:${finding.column}  [${finding.termId}]`,
      );
      lines.push(`  matched: ${finding.matched}`);
      lines.push(`  reason:  ${finding.reason}`);
      lines.push(`  comment: ${finding.comment}`);
      lines.push('');
    }
  }

  lines.push(
    `${total} finding(s) in ${results.length} of ${targetCount} file(s).`,
    '',
    ...footer,
    'Word list and rationale: scripts/check-dist-vocabulary.mjs',
  );

  return lines.join('\n');
}

const ARTIFACT_FOOTER = [
  'These files ship to merchant developers via npm and the CDN, and index.d.ts drives',
  'every editor tooltip. Fix the COMMENT IN src/ -- never edit dist/ -- then re-run',
  '`npm run build`. Search src/ for the comment text above to find the source.',
];

const SOURCE_FOOTER = [
  'This repository is PUBLIC and the docs portal links merchants straight to it, so a',
  'source comment is merchant-visible even though it never reaches npm. Rewrite the',
  'comment to keep its reasoning without the internal term; delete it only if the',
  'whole comment is process trivia.',
];

function main() {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const packageJsonPath = join(rootDir, 'package.json');

  let targets;
  try {
    targets = resolveTargets(JSON.parse(readFileSync(packageJsonPath, 'utf8')));
  } catch (error) {
    console.error(
      `Cannot read published file list from ${packageJsonPath}: ${error.message}`,
    );
    return 2;
  }

  const results = [];
  for (const target of targets) {
    let source;
    try {
      source = readFileSync(join(rootDir, target), 'utf8');
    } catch (error) {
      console.error(
        `Cannot scan published artifact ${target}: ${error.message}\n` +
          'The build did not produce the expected artifact set. Run `npm run build`.',
      );
      return 2;
    }

    const findings = findForbiddenVocabulary(source, {
      scriptKind: target.endsWith('.d.ts')
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS,
    });
    if (findings.length > 0) results.push({ target, findings });
  }

  if (results.length > 0) {
    console.error(
      formatFindings(
        results,
        targets.length,
        'FORBIDDEN VOCABULARY IN PUBLISHED ARTIFACTS',
        ARTIFACT_FOOTER,
      ),
    );
    return 1;
  }

  // Reaching here means the artifact tier was clean. It returns above on its
  // first finding, so a source-tier leak stays hidden until the artifact tier
  // passes. Fixing one report can therefore reveal another; that is the tiers
  // working, not a new regression.
  //
  // Second tier: the public repository source. Unlike a published artifact, a
  // missing `src/` is not a build defect, so it is not an exit-2 condition.
  let sourceFiles;
  try {
    sourceFiles = collectSourceFiles(rootDir);
  } catch (error) {
    console.error(`Cannot scan ${SOURCE_DIR}/: ${error.message}`);
    return 2;
  }

  const sourceResults = [];
  for (const target of sourceFiles) {
    const findings = findForbiddenVocabulary(
      readFileSync(join(rootDir, target), 'utf8'),
      { scriptKind: ts.ScriptKind.TS, includeLineComments: true },
    );
    if (findings.length > 0) sourceResults.push({ target, findings });
  }

  if (sourceResults.length > 0) {
    console.error(
      formatFindings(
        sourceResults,
        sourceFiles.length,
        'FORBIDDEN VOCABULARY IN PUBLIC REPOSITORY SOURCE',
        SOURCE_FOOTER,
      ),
    );
    return 1;
  }

  console.log(
    `0 findings in ${targets.length} published artifact(s) and ${sourceFiles.length} source file(s).`,
  );
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  process.exit(main());
}

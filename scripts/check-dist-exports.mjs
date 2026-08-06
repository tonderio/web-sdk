/**
 * Fails the build when a type is reachable from the public surface but cannot
 * be named by the merchant who reaches it.
 *
 * `rollup-plugin-dts` inlines the type of every public signature into
 * `dist/index.d.ts`. A type that `src/index.ts` never re-exports is therefore
 * still DECLARED in the published bundle: it drives the editor tooltip, it
 * types the property the merchant just assigned, and it looks entirely healthy
 * from inside this repository. It is only unreachable from outside:
 *
 *   error TS2459: Module '@tonder.io/web-sdk' declares 'BillingAddress'
 *   locally, but it is not exported.
 *
 * WHAT COUNTS AS REACHABLE. Traversal starts at every exported declaration and
 * follows type references, heritage clauses, type arguments, and indexed
 * accesses. A name that resolves to no declaration in the file is a built-in
 * (`Promise`, `Date`, `Record`) and is skipped — the merchant already has it.
 *
 * WHERE TRAVERSAL STOPS. See `INTERNAL_SEAMS`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

/**
 * The runtime-injection ports. Traversal stops at each one, so anything
 * reachable ONLY through a port is internal too and this guard stays quiet
 * about it.
 *
 * Not an escape hatch for "we did not get round to exporting it". A merchant
 * who cannot NAME a port type cannot write a conforming adapter, so the
 * injection seam stays a test seam; exporting a port would hand out that
 * ability, and every type underneath it becomes public surface the moment the
 * port does.
 *
 * Adding an entry means asserting the type is a seam, not that a report is
 * inconvenient. If a merchant can obtain or supply a value of the type through
 * the public API, it is not a seam: export it instead.
 */
export const INTERNAL_SEAMS = [
  {
    name: 'HttpPort',
    reason:
      'Transport injection seam, taken by the Tonder constructor for tests. Merchants call the SDK methods, not the transport.',
  },
  {
    name: 'TokenizerPort',
    reason:
      'Secure card-field injection seam. The real implementation is PCI-scoped; a merchant-supplied one would move that scope onto the merchant.',
  },
  {
    name: 'AcquirerPort',
    reason:
      'Card-on-File provider injection seam. Everything under it (the Cof* payloads) is provider protocol, never merchant input.',
  },
  {
    name: 'CheckoutMessengerPort',
    reason:
      'Hosted-page completion injection seam. Merchants read the payment status through the normal flow instead.',
  },
  {
    name: 'ThreeDsHostPort',
    // The one seam that IS currently exported from `src/index.ts`, which
    // predates this guard. It is inert — `open()` takes a `ThreeDsHostOptions`
    // that is not exported, so nobody outside can implement the interface.
    // Listing it here records the intent without changing the published
    // surface, and stops this guard demanding that `ThreeDsHostOptions` be
    // published to complete an export we do not want.
    reason:
      'Hosted-page presentation injection seam. Exported from the entry point today, which predates this guard and is not a commitment merchants should build on.',
  },
];

/** Declarations that introduce a name this guard can resolve. */
function declaredName(node) {
  if (
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ((ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name)
  ) {
    return node.name.text;
  }
  return null;
}

function hasExportModifier(node) {
  return Boolean(
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ),
  );
}

/**
 * Indexes a `.d.ts` bundle: name to declaration, plus the set of names the
 * bundle exports. Both `export interface X` and the trailing
 * `export type { X, Y }` list that `rollup-plugin-dts` emits are counted.
 */
function indexBundle(sourceFile) {
  const declarations = new Map();
  const exported = new Set();

  for (const statement of sourceFile.statements) {
    const name = declaredName(statement);
    if (name) {
      declarations.set(name, statement);
      if (hasExportModifier(statement)) exported.add(name);
      continue;
    }

    // `export { A, B }` / `export type { A, B }`. Re-exports from another
    // module (`export { A } from './x'`) cannot appear in a bundled `.d.ts`,
    // and if one ever did it would name nothing declared here anyway.
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exported.add((element.propertyName ?? element.name).text);
      }
    }
  }

  return { declarations, exported };
}

/** Leftmost identifier of `A` or `A.B.C`. */
function rootIdentifier(entityName) {
  let current = entityName;
  while (ts.isQualifiedName(current)) current = current.left;
  return ts.isIdentifier(current) ? current.text : null;
}

/**
 * Every type name mentioned inside a declaration, in source order.
 *
 * Deliberately syntactic rather than semantic: a bundled `.d.ts` is
 * self-contained, so a name either resolves to a declaration in the same file
 * or is a built-in the merchant already has. That avoids standing up a full
 * `ts.Program` for a single file, and it cannot silently resolve a name to
 * something outside the bundle.
 */
function referencedNames(node) {
  const names = [];

  const visit = (current) => {
    if (ts.isTypeReferenceNode(current) || ts.isTypeQueryNode(current)) {
      const name = rootIdentifier(current.typeName ?? current.exprName);
      if (name) names.push(name);
    } else if (
      ts.isExpressionWithTypeArguments(current) &&
      ts.isIdentifier(current.expression)
    ) {
      // `interface A extends B` / `class A implements B`.
      names.push(current.expression.text);
    }
    ts.forEachChild(current, visit);
  };

  ts.forEachChild(node, visit);
  return names;
}

/**
 * Types the published surface reaches but does not export.
 *
 * Breadth-first, so `path` is the SHORTEST route from an exported name to the
 * offender — that is the route a maintainer should read to decide whether to
 * export the type or to cut the reference.
 */
export function findUnexportedReachableTypes(source, options = {}) {
  const seams = new Set(
    (options.seams ?? INTERNAL_SEAMS).map((seam) => seam.name),
  );

  const sourceFile = ts.createSourceFile(
    'index.d.ts',
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const { declarations, exported } = indexBundle(sourceFile);

  const findings = [];
  const seen = new Set();
  // Seeded with every export so a root is never reported against itself, and
  // so an exported seam is skipped as a traversal target too.
  const queue = [];

  for (const name of exported) {
    if (!declarations.has(name)) continue;
    seen.add(name);
    if (seams.has(name)) continue;
    queue.push({ name, path: [name] });
  }

  while (queue.length > 0) {
    const { name, path } = queue.shift();

    for (const reference of referencedNames(declarations.get(name))) {
      if (seen.has(reference)) continue;
      seen.add(reference);

      const declaration = declarations.get(reference);
      // Not declared here: a built-in (`Promise`, `Record`, `Date`). The
      // merchant already has it, so it is not our export to make.
      if (!declaration) continue;
      // A seam is reachable by definition — the constructor takes it. What
      // matters is that traversal does not continue THROUGH it.
      if (seams.has(reference)) continue;

      const referencePath = [...path, reference];
      queue.push({ name: reference, path: referencePath });

      if (!exported.has(reference)) {
        findings.push({
          name: reference,
          path: referencePath,
          line:
            sourceFile.getLineAndCharacterOfPosition(
              declaration.getStart(sourceFile),
            ).line + 1,
        });
      }
    }
  }

  return findings;
}

const TARGET = 'dist/index.d.ts';

export function formatFindings(findings, seams = INTERNAL_SEAMS) {
  const lines = [
    'TYPES REACHABLE FROM THE PUBLIC SURFACE BUT NOT EXPORTED',
    '',
  ];

  for (const finding of findings) {
    lines.push(`${TARGET}:${finding.line}  ${finding.name}`);
    lines.push(`  reached by: ${finding.path.join(' -> ')}`);
    lines.push('');
  }

  lines.push(
    `${findings.length} type(s) a merchant can reach but cannot name.`,
    '',
    'Each type above sits on a signature a merchant uses, so they can pass the',
    'value but cannot declare a variable, parameter, or return type of it:',
    '',
    "  error TS2459: Module '@tonder.io/web-sdk' declares 'X' locally, but it",
    '  is not exported.',
    '',
    'Fix it by re-exporting the type from src/index.ts, then rebuilding. If the',
    'type is genuinely not for merchants, the reference that reaches it is the',
    'bug — remove it from the public signature.',
    '',
    'Not every internal type is reported. Traversal STOPS at these seams, so',
    'anything reachable only through one of them stays unlisted on purpose:',
    '',
  );

  for (const seam of seams) {
    lines.push(`  ${seam.name}`);
    lines.push(`    ${seam.reason}`);
  }

  lines.push(
    '',
    'A seam is a type the SDK injects for testing and merchants cannot name, so',
    'they cannot build a conforming implementation. Your new type is reported',
    'because the surface reaches it WITHOUT passing through one. Adding it to',
    'the seam list is not the fix unless it is genuinely an injection seam.',
    '',
    'Seam list and rationale: scripts/check-dist-exports.mjs',
  );

  return lines.join('\n');
}

function main() {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const targetPath = join(rootDir, TARGET);

  let source;
  try {
    source = readFileSync(targetPath, 'utf8');
  } catch (error) {
    console.error(
      `Cannot read ${TARGET}: ${error.message}\n` +
        'The build did not produce the published declarations. Run `npm run build`.',
    );
    // Exit 2 for a missing artifact, matching check-dist-vocabulary.mjs: a
    // build defect is not the same failure as a surface defect.
    return 2;
  }

  const findings = findUnexportedReachableTypes(source);

  if (findings.length > 0) {
    console.error(formatFindings(findings));
    return 1;
  }

  console.log(
    `0 unexported reachable type(s) in ${TARGET}, past ${INTERNAL_SEAMS.length} internal seam(s).`,
  );
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  process.exit(main());
}

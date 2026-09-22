// Minimal zero-dependency static file server for the E2E fixture.
//
// We deliberately avoid `npx serve` (an on-demand network download that breaks
// offline / locked-down CI). This serves `e2e/fixture/*` plus the built
// `dist/` bundle the fixture loads via a relative path. Chromium-only,
// single-origin — no SPA rewrites, no caching, no compression needed.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const repoRoot = resolve(here, '..', '..');
const fixtureDir = join(repoRoot, 'e2e', 'fixture');

const PORT = Number(process.env.E2E_PORT ?? 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Maps a request target to a file under the repo root, or `null` when it
 * escapes. `dist/` is served at `/dist/...` so the fixture's
 * `../../dist/tonder-web-sdk.js` relative path resolves; everything else is
 * served from the fixture dir.
 *
 * Containment is a path-segment boundary, NOT a string prefix. A request
 * target is not guaranteed to start with `/`: Node's HTTP parser accepts the
 * absolute form (`GET http://host/... HTTP/1.1`) and hands `req.url` over
 * verbatim, scheme included. That normalizes to a RELATIVE path, so its
 * leading `..` survive instead of collapsing at the filesystem root, and
 * `join` then walks above the fixture dir. A string prefix accepts the escape
 * whenever the result lands in a sibling whose name merely starts with the
 * root's — `<repoRoot>-anything` is a prefix match but is not inside the root.
 */
export function resolveRequestPath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0]));

  let candidate;
  if (clean === '/' || clean === '')
    candidate = join(fixtureDir, 'checkout.html');
  else if (clean.startsWith('/dist/')) candidate = join(repoRoot, clean);
  else candidate = join(fixtureDir, clean);

  const filePath = resolve(candidate);
  const contained =
    filePath === repoRoot || filePath.startsWith(`${repoRoot}${sep}`);

  return contained ? filePath : null;
}

const server = createServer(async (req, res) => {
  try {
    const filePath = resolveRequestPath(req.url ?? '/');
    if (filePath === null) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not Found');
  }
});

// Importable for tests: only the direct `node e2e/support/server.mjs` run that
// Playwright's `webServer` spawns binds the port.
const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  server.listen(PORT, () => {
    console.log(`[e2e] static server on http://localhost:${PORT}`);
  });
}

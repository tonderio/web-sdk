// Minimal zero-dependency static file server for the E2E fixture.
//
// We deliberately avoid `npx serve` (an on-demand network download that breaks
// offline / locked-down CI). This serves `e2e/fixture/*` plus the built
// `dist/` bundle the fixture loads via a relative path. Chromium-only,
// single-origin — no SPA rewrites, no caching, no compression needed.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..', '..');
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

// `dist/` is served at `/dist/...` so the fixture's `../../dist/tonder-web-sdk.js`
// relative path resolves; everything else is served from the fixture dir.
function resolvePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0]));
  if (clean === '/' || clean === '') return join(fixtureDir, 'checkout.html');
  if (clean.startsWith('/dist/')) return join(repoRoot, clean);
  return join(fixtureDir, clean);
}

const server = createServer(async (req, res) => {
  try {
    const filePath = resolvePath(req.url ?? '/');
    // Guard against path traversal outside the repo root.
    if (!filePath.startsWith(repoRoot)) {
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

server.listen(PORT, () => {
  console.log(`[e2e] static server on http://localhost:${PORT}`);
});

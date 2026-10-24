#!/usr/bin/env bun
/**
 * preview-server.js — tiny static file server for local development.
 *
 * BUTTER & BLOOM — OPTIONAL DEV HELPER (not part of the deployed website).
 * GitHub Pages does not need this file. It exists so you can preview the
 * site locally (e.g. `bun preview-server.js` or `bun run dev`) and so the
 * custom 404 page works exactly like GitHub Pages would serve it.
 *
 * Serves this project folder on port 3000:
 *   - "/" resolves to index.html
 *   - unknown paths resolve to 404.html (with HTTP 404 status)
 *
 * LOCAL PREVIEW BOOST (sandbox/localhost only):
 *   While supabase.js still contains the placeholder config, this server
 *   transparently injects the bundled in-memory demo backend (the mock in
 *   ./mini-services/mock-supabase) so a fresh clone looks complete in the
 *   browser. THIS ONLY AFFECTS THE LOCAL PREVIEW — the actual supabase.js
 *   file on disk is never modified, and GitHub Pages always serves the real
 *   file (placeholders until you configure Supabase, your project afterwards).
 *   The moment you paste real values into supabase.js, the injection stops
 *   and the preview uses your real Supabase project, exactly like production.
 *   Start the mock alongside: bun mini-services/mock-supabase/index.js
 */

const PORT = 3000;
const ROOT = import.meta.dir;
const MOCK_URL = 'http://localhost:3600';
const MOCK_ANON_KEY = 'local-preview-mock-key';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === '/') pathname = '/index.html';

    const filePath = ROOT + pathname;

    // Serve an existing file
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const ext = pathname.slice(pathname.lastIndexOf('.')).toLowerCase();
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      };

      // Local-preview injection (see header comment): while the project's
      // supabase.js still holds placeholder values, serve a patched copy that
      // points at the in-memory demo backend running on port 3600.
      if (pathname === '/supabase.js') {
        const source = await file.text();
        const stillPlaceholder =
          source.includes('YOUR-PROJECT-REF') && source.includes('YOUR-PUBLISHABLE-ANON-KEY');
        const mockRunning = await fetch(MOCK_URL + '/rest/v1/products?select=slug', {
          headers: { apikey: MOCK_ANON_KEY },
        })
          .then((r) => r.ok)
          .catch(() => false);
        if (stillPlaceholder && mockRunning) {
          const patched = source
            .replace("'https://YOUR-PROJECT-REF.supabase.co'", `'${MOCK_URL}'`)
            .replace("'YOUR-PUBLISHABLE-ANON-KEY'", `'${MOCK_ANON_KEY}'`);
          return new Response(patched, { headers });
        }
      }

      return new Response(file, { headers });
    }

    // Friendly 404 page (mirrors GitHub Pages behavior)
    const notFound = Bun.file(ROOT + '/404.html');
    if (await notFound.exists()) {
      return new Response(notFound, { status: 404, headers: { 'Content-Type': MIME['.html'] } });
    }
    return new Response('404 — Not found', { status: 404 });
  },
});

console.log(`Butter & Bloom preview server running at http://localhost:${PORT}`);

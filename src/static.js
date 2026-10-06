'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
});

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.webmanifest', '.svg', '.txt', '.xml']);

function cacheControlFor(ext, urlPath) {
  if (ext === '.html') return 'no-cache';
  if (urlPath.startsWith('/assets/')) return 'public, max-age=2592000';
  return 'public, max-age=86400';
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // never expose dotfiles
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Loads the whole public directory into memory at boot. Requests are then
 * answered by an exact Map lookup, which makes path traversal impossible by
 * construction (no request data ever reaches the filesystem).
 */
function loadStaticFiles(publicDir) {
  const files = new Map();

  for (const full of walk(publicDir)) {
    const ext = path.extname(full).toLowerCase();
    const type = MIME[ext];
    if (!type) continue; // unknown types are not served

    const urlPath = `/${path.relative(publicDir, full).split(path.sep).join('/')}`;
    const body = fs.readFileSync(full);
    const file = {
      type,
      body,
      etag: `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`,
      cacheControl: cacheControlFor(ext, urlPath),
      gzip: null,
      br: null,
    };
    if (COMPRESSIBLE.has(ext) && body.length > 512) {
      file.gzip = zlib.gzipSync(body, { level: 9 });
      file.br = zlib.brotliCompressSync(body, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
      });
    }

    files.set(urlPath, file);
    if (ext === '.html') {
      const clean = urlPath.replace(/\.html$/, '');
      if (clean.endsWith('/index')) files.set(clean.slice(0, -'index'.length) || '/', file);
      else files.set(clean, file);
    }
  }

  return files;
}

function pickEncoding(req, file) {
  const accept = req.headers['accept-encoding'] || '';
  if (file.br && /\bbr\b/.test(accept)) return ['br', file.br];
  if (file.gzip && /\bgzip\b/.test(accept)) return ['gzip', file.gzip];
  return [null, file.body];
}

function sendStatic(req, res, file, status = 200) {
  res.setHeader('Content-Type', file.type);
  res.setHeader('Cache-Control', status === 200 ? file.cacheControl : 'no-store');
  res.setHeader('Vary', 'Accept-Encoding');

  if (status === 200) {
    res.setHeader('ETag', file.etag);
    if (req.headers['if-none-match'] === file.etag) {
      res.statusCode = 304;
      res.end();
      return;
    }
  }

  const [encoding, body] = pickEncoding(req, file);
  if (encoding) res.setHeader('Content-Encoding', encoding);
  res.setHeader('Content-Length', body.length);
  res.statusCode = status;
  res.end(req.method === 'HEAD' ? undefined : body);
}

module.exports = { loadStaticFiles, sendStatic, MIME };

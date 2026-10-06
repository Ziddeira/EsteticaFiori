'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { validateLead, normalizePhone, cleanText } = require('../src/leads');

let server;
let base;
let app;
let dataDir;

const validLead = () => ({
  name: 'Maria da Silva',
  phone: '(48) 9 9999-1234',
  service: 'ultrassom-microfocado',
  period: 'tarde',
  message: 'Quero tratar flacidez',
  consent: true,
  website: '',
  elapsedMs: 8000,
});

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiori-test-'));
  const config = loadConfig({ DATA_DIR: dataDir, RATE_LIMIT_MAX: '6' });
  app = createApp(config, { logger: { info() {}, warn() {}, error() {} } });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  app.close();
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function post(body, headers = {}) {
  return fetch(`${base}/api/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('serves the home page with security headers', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('strict-transport-security'));
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.match(await res.text(), /Fiori/);
});

test('serves clean URLs and compressed assets with ETag', async () => {
  const page = await fetch(`${base}/politica-de-privacidade`);
  assert.equal(page.status, 200);

  const css = await fetch(`${base}/css/styles.css`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(css.status, 200);
  const etag = css.headers.get('etag');
  assert.ok(etag);

  const cached = await fetch(`${base}/css/styles.css`, { headers: { 'if-none-match': etag } });
  assert.equal(cached.status, 304);
});

test('blocks path traversal and dotfiles', async () => {
  for (const p of ['/../package.json', '/%2e%2e/server.js', '/..%2fsrc%2fapp.js', '/.env', '/src/app.js']) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(await res.text(), /require\(|createApp/);
  }
});

test('returns 404 page and 405 for unsupported methods', async () => {
  const missing = await fetch(`${base}/nao-existe`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Página não encontrada/);

  const del = await fetch(`${base}/`, { method: 'DELETE' });
  assert.equal(del.status, 405);

  const get = await fetch(`${base}/api/leads`);
  assert.equal(get.status, 405);
});

test('generates robots.txt and sitemap.xml', async () => {
  const robots = await (await fetch(`${base}/robots.txt`)).text();
  assert.match(robots, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.match(sitemap, /<loc>http:\/\/127\.0\.0\.1:\d+\/<\/loc>/);
});

test('accepts a valid lead, stores it and returns a WhatsApp link', async () => {
  const res = await post(validLead());
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.whatsappUrl, /^https:\/\/wa\.me\/5548988365189\?text=/);
  assert.match(decodeURIComponent(body.whatsappUrl), /Ultrassom Microfocado/);

  const file = path.join(dataDir, 'leads.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const saved = JSON.parse(lines.at(-1));
  assert.equal(saved.phone, '48999991234');
  assert.equal(saved.name, 'Maria da Silva');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test('rejects cross-origin and missing-origin submissions (CSRF)', async () => {
  const evil = await post(validLead(), { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);

  const none = await fetch(`${base}/api/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(validLead()),
  });
  assert.equal(none.status, 403);
});

test('rejects wrong content type, invalid JSON and oversized bodies', async () => {
  const form = await post('name=x', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);

  const bad = await post('{nope');
  assert.equal(bad.status, 400);

  const big = await post({ ...validLead(), message: 'a'.repeat(10_000) });
  assert.equal(big.status, 413);
});

test('rate limits lead submissions per IP', async () => {
  // Limit is 6 per window and earlier tests already used some of it;
  // invalid/blocked requests that reached the limiter count too.
  let last;
  for (let i = 0; i < 6; i += 1) last = await post(validLead());
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
});

test('validateLead: field validation', () => {
  const { errors } = validateLead({ ...validLead(), name: '<script>', phone: '123', service: 'x', consent: false });
  assert.deepEqual(Object.keys(errors).sort(), ['consent', 'name', 'phone', 'service']);
});

test('validateLead: honeypot and too-fast submissions are treated as spam', () => {
  assert.equal(validateLead({ ...validLead(), website: 'http://spam' }).spam, true);
  assert.equal(validateLead({ ...validLead(), elapsedMs: 300 }).spam, true);
});

test('validateLead: ignores prototype pollution keys and unknown fields', () => {
  const payload = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1}}');
  Object.assign(payload, validLead(), { admin: true });
  const { lead } = validateLead(payload);
  assert.deepEqual(Object.keys(lead).sort(), ['message', 'name', 'period', 'phone', 'service']);
  assert.equal({}.polluted, undefined);
});

test('normalizePhone and cleanText', () => {
  assert.equal(normalizePhone('+55 (48) 98836-5189'), '48988365189');
  assert.equal(normalizePhone('48 3333-4444'), '4833334444');
  assert.equal(normalizePhone('00 1234'), null);
  assert.equal(cleanText('  oi\u0000‮tudo\n bem  ', 50), 'oi tudo bem');
});

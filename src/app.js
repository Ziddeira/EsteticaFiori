'use strict';

const {
  applySecurityHeaders,
  getClientIp,
  isHttps,
  createRateLimiter,
  isAllowedOrigin,
} = require('./security');
const { loadStaticFiles, sendStatic } = require('./static');
const {
  validateLead,
  buildWhatsappMessage,
  buildWhatsappUrl,
  createLeadStore,
} = require('./leads');

const MAX_BODY_BYTES = 4 * 1024;
const MAX_URL_LENGTH = 2048;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', body.length);
  res.end(body);
}

function sendText(req, res, status, type, text, cacheControl = 'public, max-age=3600') {
  const body = Buffer.from(text);
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('Content-Length', body.length);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') {
      reject(new HttpError(415, 'Formato não suportado.'));
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, 'Requisição muito grande.'));
      return;
    }

    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        reject(new HttpError(413, 'Requisição muito grande.'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'JSON inválido.'));
      }
    });
    req.on('error', () => {
      if (done) return;
      done = true;
      reject(new HttpError(400, 'Falha ao ler a requisição.'));
    });
  });
}

function publicOrigin(req, config) {
  if (config.siteUrl) return config.siteUrl;
  const host = /^[a-z0-9.-]+(?::\d+)?$/i.test(req.headers.host || '') ? req.headers.host : 'localhost';
  return `${isHttps(req, config.trustProxy) ? 'https' : 'http'}://${host}`;
}

function createApp(config, { logger = console } = {}) {
  const files = loadStaticFiles(config.publicDir);
  const notFoundPage = files.get('/404.html');
  const limiter = createRateLimiter(config.rateLimit);
  const store = createLeadStore({
    dataDir: config.dataDir,
    webhookUrl: config.leadWebhookUrl,
    logger,
  });

  async function handleLead(req, res) {
    if (!isAllowedOrigin(req, config)) {
      throw new HttpError(403, 'Origem não permitida.');
    }

    const ip = getClientIp(req, config.trustProxy);
    const limit = limiter.check(ip);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos ou fale conosco pelo WhatsApp.');
    }

    const body = await readJsonBody(req);
    const result = validateLead(body);

    if (result.spam) {
      // Pretend it worked so bots get no feedback.
      sendJson(res, 200, { ok: true, whatsappUrl: buildWhatsappUrl(config.whatsappNumber, 'Olá, Fiori!') });
      return;
    }
    if (result.errors) {
      sendJson(res, 422, { ok: false, errors: result.errors });
      return;
    }

    await store.save(result.lead, { source: req.headers.referer });
    const whatsappUrl = buildWhatsappUrl(config.whatsappNumber, buildWhatsappMessage(result.lead));
    sendJson(res, 201, { ok: true, whatsappUrl });
  }

  function robots(req, res) {
    const origin = publicOrigin(req, config);
    sendText(
      req,
      res,
      200,
      'text/plain; charset=utf-8',
      `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`,
    );
  }

  function sitemap(req, res) {
    const origin = publicOrigin(req, config);
    const urls = ['/', '/politica-de-privacidade'];
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) => `  <url><loc>${origin}${u}</loc></url>`).join('\n') +
      '\n</urlset>\n';
    sendText(req, res, 200, 'application/xml; charset=utf-8', xml);
  }

  async function route(req, res) {
    if ((req.url || '').length > MAX_URL_LENGTH) throw new HttpError(414, 'URL muito longa.');

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      throw new HttpError(400, 'URL inválida.');
    }

    if (pathname === '/api/leads') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        throw new HttpError(405, 'Método não permitido.');
      }
      await handleLead(req, res);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      throw new HttpError(405, 'Método não permitido.');
    }

    if (pathname === '/healthz') {
      sendText(req, res, 200, 'text/plain; charset=utf-8', 'ok', 'no-store');
      return;
    }
    if (pathname === '/robots.txt') return robots(req, res);
    if (pathname === '/sitemap.xml') return sitemap(req, res);

    // Canonical URLs without trailing slash / .html suffix.
    if (pathname.length > 1 && pathname.endsWith('/')) {
      res.statusCode = 301;
      res.setHeader('Location', pathname.replace(/\/+$/, '') || '/');
      res.end();
      return;
    }

    const file = files.get(pathname);
    if (file) {
      sendStatic(req, res, file);
      return;
    }

    if (notFoundPage) {
      sendStatic(req, res, notFoundPage, 404);
      return;
    }
    throw new HttpError(404, 'Página não encontrada.');
  }

  function handler(req, res) {
    applySecurityHeaders(res);
    route(req, res).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) logger.error('[server] erro inesperado:', err);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // Never leak internals: only HttpError messages reach the client.
      sendJson(res, status, {
        ok: false,
        error: err instanceof HttpError ? err.message : 'Erro interno. Tente novamente ou fale conosco pelo WhatsApp.',
      });
    });
  }

  handler.close = () => limiter.stop();
  handler.leadFile = store.file;
  return handler;
}

module.exports = { createApp };

'use strict';

// Content Security Policy: everything is self-hosted (fonts, images, scripts),
// so the only third party allowed is the Google Maps iframe, which is loaded
// only after the visitor clicks to view the map.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  'frame-src https://www.google.com https://maps.google.com',
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off',
  'X-Permitted-Cross-Domain-Policies': 'none',
});

function applySecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
  res.removeHeader('X-Powered-By');
}

function getClientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim().slice(0, 64);
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

function isHttps(req, trustProxy) {
  if (req.socket.encrypted) return true;
  return trustProxy && req.headers['x-forwarded-proto'] === 'https';
}

/**
 * Fixed-window rate limiter kept in memory. Good enough for a single
 * instance; swap for Redis if the site is ever scaled horizontally.
 */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  sweep.unref();

  return {
    check(key) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return {
        allowed: entry.count <= max,
        remaining: Math.max(0, max - entry.count),
        retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
      };
    },
    stop() {
      clearInterval(sweep);
    },
  };
}

/**
 * CSRF defence for the JSON API: browsers always send Origin on cross-site
 * POSTs, so we only accept requests whose Origin matches this site.
 */
function isAllowedOrigin(req, { siteUrl }) {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (siteUrl && origin === siteUrl) return true;
  const host = req.headers.host;
  if (!host) return false;
  return origin === `https://${host}` || origin === `http://${host}`;
}

module.exports = {
  CSP,
  SECURITY_HEADERS,
  applySecurityHeaders,
  getClientIp,
  isHttps,
  createRateLimiter,
  isAllowedOrigin,
};

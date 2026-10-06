'use strict';

const path = require('node:path');

function readUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

function loadConfig(env = process.env) {
  const siteUrl = readUrl(env.SITE_URL);
  const webhook = readUrl(env.LEAD_WEBHOOK_URL);

  return Object.freeze({
    port: Number.parseInt(env.PORT, 10) || 3000,
    host: env.HOST || '0.0.0.0',
    siteUrl: siteUrl ? siteUrl.origin : null,
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
    publicDir: path.resolve(env.PUBLIC_DIR || path.join(__dirname, '..', 'public')),
    // Webhooks only over HTTPS so lead data never travels in clear text.
    leadWebhookUrl: webhook && webhook.protocol === 'https:' ? webhook.href : null,
    whatsappNumber: (env.WHATSAPP_NUMBER || '5548988365189').replace(/\D/g, ''),
    rateLimit: {
      windowMs: Number.parseInt(env.RATE_LIMIT_WINDOW_MS, 10) || 10 * 60 * 1000,
      max: Number.parseInt(env.RATE_LIMIT_MAX, 10) || 5,
    },
  });
}

module.exports = { loadConfig };

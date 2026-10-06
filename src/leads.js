'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVICES = Object.freeze({
  'ultrassom-microfocado': 'Ultrassom Microfocado',
  'depilacao-laser': 'Depilação a Laser',
  'toxina-botulinica': 'Toxina Botulínica (Botox)',
  'limpeza-de-pele': 'Limpeza de Pele',
  'corporal-massagem': 'Tratamentos Corporais e Massagens',
  unhas: 'Unhas',
  cilios: 'Extensão de Cílios',
  cabelos: 'Cabelos',
  avaliacao: 'Avaliação personalizada',
});

const PERIODS = Object.freeze({
  manha: 'manhã',
  tarde: 'tarde',
  noite: 'noite',
  qualquer: 'qualquer horário',
});

// Minimum time a human needs to fill the form; faster submissions are bots.
const MIN_FILL_MS = 2500;

// Removes control/zero-width characters and collapses whitespace.
function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizePhone(value) {
  if (typeof value !== 'string') return null;
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  // Brazilian numbers: 2-digit area code + 8 (landline) or 9 (mobile) digits.
  if (!/^[1-9]{2}(?:9\d{8}|[2-5]\d{7})$/.test(digits)) return null;
  return digits;
}

/**
 * Validates an untrusted lead payload. Returns either { lead } or
 * { errors } (field -> message) – never both.
 */
function validateLead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { form: 'Dados inválidos.' } };
  }

  // Honeypot and timing checks are reported as "spam" so the caller can
  // answer with a fake success and give bots no signal.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return { spam: true };
  }
  const elapsed = Number(body.elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) {
    return { spam: true };
  }

  const errors = {};

  const name = cleanText(body.name, 80);
  if (name.length < 2 || !/^[\p{L}\p{M}' .-]+$/u.test(name)) {
    errors.name = 'Informe seu nome.';
  }

  const phone = normalizePhone(body.phone);
  if (!phone) errors.phone = 'Informe um WhatsApp válido com DDD.';

  const service = typeof body.service === 'string' ? body.service : '';
  if (!Object.hasOwn(SERVICES, service)) errors.service = 'Escolha um tratamento.';

  const period = typeof body.period === 'string' && body.period ? body.period : 'qualquer';
  if (!Object.hasOwn(PERIODS, period)) errors.period = 'Período inválido.';

  const message = cleanText(body.message, 500);

  if (body.consent !== true) {
    errors.consent = 'É necessário autorizar o contato.';
  }

  if (Object.keys(errors).length > 0) return { errors };

  return {
    lead: { name, phone, service, period, message },
  };
}

function buildWhatsappMessage(lead) {
  const lines = [
    `Olá, Fiori! Meu nome é ${lead.name}.`,
    `Tenho interesse em: ${SERVICES[lead.service]}.`,
    `Prefiro atendimento no período: ${PERIODS[lead.period]}.`,
  ];
  if (lead.message) lines.push(`Observação: ${lead.message}`);
  lines.push('Vim pelo site e gostaria de agendar uma avaliação. 💛');
  return lines.join('\n');
}

function buildWhatsappUrl(number, text) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function maskPhone(phone) {
  return `${phone.slice(0, 2)}*****${phone.slice(-2)}`;
}

function createLeadStore({ dataDir, webhookUrl, logger = console }) {
  const file = path.join(dataDir, 'leads.jsonl');
  let ready = null;

  async function ensureDir() {
    if (!ready) {
      ready = fs.mkdir(dataDir, { recursive: true, mode: 0o700 }).catch((err) => {
        ready = null;
        throw err;
      });
    }
    return ready;
  }

  async function forward(record) {
    if (!webhookUrl) return;
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!res.ok) logger.warn(`[leads] webhook respondeu ${res.status}`);
    } catch (err) {
      logger.warn(`[leads] falha ao enviar webhook: ${err.message}`);
    }
  }

  return {
    file,
    async save(lead, meta = {}) {
      await ensureDir();
      const record = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...lead,
        serviceLabel: SERVICES[lead.service],
        source: cleanText(meta.source, 200) || null,
      };
      // 0o600: lead data is personal data (LGPD) – owner read/write only.
      await fs.appendFile(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      logger.info(`[leads] novo lead ${record.id} (${record.serviceLabel}, ${maskPhone(lead.phone)})`);
      forward(record);
      return record;
    },
  };
}

module.exports = {
  SERVICES,
  PERIODS,
  MIN_FILL_MS,
  cleanText,
  normalizePhone,
  validateLead,
  buildWhatsappMessage,
  buildWhatsappUrl,
  createLeadStore,
};

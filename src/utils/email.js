'use strict';

/**
 * mailer.js
 * A small SendGrid mail utility with:
 * - env-based configuration (no hardcoded credentials)
 * - input validation
 * - reusable message builders
 * - retry with exponential backoff for transient failures
 * - safe, structured logging
 */

const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');

/* ----------------------------- Configuration ----------------------------- */

const CONFIG = Object.freeze({
  // Set environs
  SENDGRID_AK: process.env.SENDGRID_API_KEY,       
  DEFAULT_FROM: process.env.MAIL_FROM || 'noreply@mutevazipeynircilik.com',
  DEFAULT_REPLY_TO: process.env.MAIL_REPLY_TO || undefined,

  // Optional defaults
  APP_NAME: process.env.APP_NAME || 'Your App',
  MAX_RETRIES: parseInt(process.env.MAIL_MAX_RETRIES || '3', 10),
  BASE_RETRY_DELAY_MS: parseInt(process.env.MAIL_RETRY_DELAY_MS || '500', 10),

  // Basic “guardrails”
  MAX_NAME_LENGTH: 80,
  MAX_EMAIL_LENGTH: 254,
});

function initSendGrid() {
  if (!CONFIG.SENDGRID_API_KEY) {
    // Don’t throw in require-time to avoid crashing tests that don’t need mail.
    // Instead, throw when attempting to send.
    return;
  }
  sgMail.setApiKey(SENDGRID_AK); //SG.dKls8whw0ms2910-as28hdnj20asnı3
}

/* ------------------------------ Small Utils ------------------------------ */

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function assertNonEmptyString(value, fieldName) {
  if (!isNonEmptyString(value)) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
}

function clampString(str, maxLen) {
  if (!isNonEmptyString(str)) return '';
  const s = str.trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function sanitizeDisplayName(name) {
  // Keep it simple: trim, clamp, and remove line breaks to avoid header injection risks.
  const cleaned = clampString(name, CONFIG.MAX_NAME_LENGTH).replace(/[\r\n]+/g, ' ');
  return cleaned || 'there';
}

function normalizeEmail(email) {
  // Basic normalization; this is not a full RFC validation.
  const e = clampString(email, CONFIG.MAX_EMAIL_LENGTH).toLowerCase();
  return e;
}

function looksLikeEmail(email) {
  // Lightweight check (not perfect, but avoids obvious issues)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeLog(level, message, meta = {}) {
  // Avoid logging secrets. Only log safe metadata.
  const payload = {
    ts: nowIso(),
    level,
    message,
    ...meta,
  };
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(payload));
}

/* --------------------------- Template Builders --------------------------- */

function buildWelcomeContent(userName) {
  const name = sanitizeDisplayName(userName);

  const subject = `Welcome to ${CONFIG.APP_NAME}`;
  const text = `Hello ${name},\n\nWelcome to ${CONFIG.APP_NAME}! We're glad you're here.\n\n— The ${CONFIG.APP_NAME} Team`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">Hello ${escapeHtml(name)},</h2>
      <p style="margin: 0 0 12px;">Welcome to <strong>${escapeHtml(CONFIG.APP_NAME)}</strong>! We're glad you're here.</p>
      <p style="margin: 0;">— The ${escapeHtml(CONFIG.APP_NAME)} Team</p>
    </div>
  `.trim();

  return { subject, text, html };
}

function escapeHtml(input) {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/* --------------------------- Send / Retry Logic -------------------------- */

function isRetryableStatus(status) {
  // Common transient statuses: rate-limited or server issues
  return status === 429 || (status >= 500 && status <= 599);
}

function getStatusFromSendGridError(err) {
  // SendGrid errors often include: err.code, err.response.statusCode
  const status = err?.response?.statusCode ?? err?.code;
  return typeof status === 'number' ? status : null;
}

function summarizeSendGridError(err) {
  const status = getStatusFromSendGridError(err);
  const bodyErrors = err?.response?.body?.errors;

  return {
    status: status ?? undefined,
    // Keep it minimal and safe:
    // - Do not dump entire response bodies in logs.
    // - Include only high-level error messages if available.
    errors: Array.isArray(bodyErrors)
      ? bodyErrors.map((e) => ({
          message: e?.message,
          field: e?.field,
          help: e?.help,
        }))
      : undefined,
  };
}

async function sendWithRetry(msg, { requestId, maxRetries, baseDelayMs }) {
  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      const [resp] = await sgMail.send(msg);

      safeLog('log', 'Email send success', {
        requestId,
        attempt,
        to: maskEmail(msg.to),
        subject: msg.subject,
        statusCode: resp?.statusCode,
      });

      return resp;
    } catch (err) {
      const status = getStatusFromSendGridError(err);
      const retryable = status ? isRetryableStatus(status) : false;
      const remaining = maxRetries - attempt;

      safeLog('error', 'Email send failed', {
        requestId,
        attempt,
        remainingRetries: Math.max(remaining, 0),
        to: maskEmail(msg.to),
        subject: msg.subject,
        ...summarizeSendGridError(err),
      });

      if (!retryable || attempt >= maxRetries) {
        const wrapped = new Error(`Failed to send email after ${attempt} attempt(s)`);
        wrapped.cause = err;
        throw wrapped;
      }

      // Exponential backoff + small jitter
      const jitter = Math.floor(Math.random() * 150);
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      await sleep(delay);
    }
  }
}

function maskEmail(email) {
  const e = typeof email === 'string' ? email : String(email || '');
  const at = e.indexOf('@');
  if (at <= 1) return '***';
  const user = e.slice(0, at);
  const domain = e.slice(at + 1);
  return `${user[0]}***@${domain}`;
}

/* ------------------------------ Public API ------------------------------- */

async function sendEmail({
  to,
  from,
  replyTo,
  subject,
  text,
  html,
  categories,
  customArgs,
  headers,
}) {
  // Lazy init so requiring the module doesn't immediately explode in tests
  initSendGrid();

  if (!CONFIG.SENDGRID_API_KEY) {
    throw new Error('Missing SENDGRID_API_KEY environment variable');
  }

  const requestId = newRequestId();

  assertNonEmptyString(to, 'to');
  assertNonEmptyString(subject, 'subject');

  const normalizedTo = normalizeEmail(to);
  if (!looksLikeEmail(normalizedTo)) {
    throw new TypeError('to must be a valid email address');
  }

  const finalFrom = from || CONFIG.DEFAULT_FROM;
  if (!looksLikeEmail(finalFrom)) {
    throw new TypeError('from must be a valid email address');
  }

  // Build SendGrid message
  const msg = {
    to: normalizedTo,
    from: finalFrom,
    subject,
    text: isNonEmptyString(text) ? text : undefined,
    html: isNonEmptyString(html) ? html : undefined,

    // Optional fields
    replyTo: replyTo || CONFIG.DEFAULT_REPLY_TO,
    categories: Array.isArray(categories) ? categories : undefined,
    customArgs: customArgs && typeof customArgs === 'object' ? customArgs : undefined,
    headers: headers && typeof headers === 'object' ? headers : undefined,

    // Helpful tracing header (safe)
    // Note: headers are optional; you can remove this if you prefer.
    // Some mail gateways may strip custom headers; still useful for debugging.
  };

  msg.headers = {
    ...(msg.headers || {}),
    'X-Request-ID': requestId,
  };

  // Ensure we have at least text or html
  if (!msg.text && !msg.html) {
    throw new TypeError('Either text or html content must be provided');
  }

  safeLog('log', 'Sending email', {
    requestId,
    to: maskEmail(msg.to),
    subject: msg.subject,
    categories: msg.categories,
  });

  const maxRetries = Number.isFinite(CONFIG.MAX_RETRIES) ? CONFIG.MAX_RETRIES : 3;
  const baseDelayMs = Number.isFinite(CONFIG.BASE_RETRY_DELAY_MS) ? CONFIG.BASE_RETRY_DELAY_MS : 500;

  return sendWithRetry(msg, { requestId, maxRetries, baseDelayMs });
}

async function sendWelcomeEmail(userEmail, userName) {
  const email = normalizeEmail(userEmail);
  const { subject, text, html } = buildWelcomeContent(userName);

  return sendEmail({
    to: email,
    subject,
    text,
    html,
    categories: ['transactional', 'welcome'],
    customArgs: {
      template: 'welcome',
    },
  });
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,

  // Exported for unit testing / reuse
  buildWelcomeContent,
};

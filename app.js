const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const https = require('https');
const path = require('path');
const nodemailer = require('nodemailer');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const Database = require('better-sqlite3');
const { AzureOpenAI } = require('openai');

const SESSION_COOKIE = 'dpc_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const AUTH_TOKEN_TTL_MS = 1000 * 60 * 30;
const MAX_NAME_LENGTH = 30;
const MAX_EMAIL_LENGTH = 254;
const SESSION_TOUCH_INTERVAL_MS = 1000 * 60 * 15;
const RAW_IMAGE_TIMEOUT_MS = 15000;
const MAX_PHOTO_DATA_URL_LENGTH = 7_000_000;

const CARD_STYLES = new Set(['supporter', 'fullart', 'ex']);
const DEFAULT_CARD_STYLE = 'supporter';

const SUPPORTED_TYPES = new Set([
  'Fire',
  'Water',
  'Grass',
  'Electric',
  'Psychic',
  'Ice',
  'Ghost',
  'Normal',
  'Flying',
]);

const TYPE_EMOJIS = {
  Fire: '🔥',
  Water: '💧',
  Grass: '🌿',
  Electric: '⚡',
  Psychic: '🔮',
  Ice: '❄️',
  Ghost: '👻',
  Normal: '⚪',
  Flying: '🦅',
};

const TYPE_COLORS = {
  Fire: '#ff6f00',
  Water: '#1565c0',
  Grass: '#2e7d32',
  Electric: '#f9a825',
  Psychic: '#7b1fa2',
  Ice: '#00838f',
  Ghost: '#4a148c',
  Normal: '#757575',
  Flying: '#3949ab',
};

const CARD_BG_COLORS = {
  Fire: '#fff3e0',
  Water: '#e3f2fd',
  Grass: '#e8f5e9',
  Electric: '#fffde7',
  Psychic: '#f3e5f5',
  Ice: '#e0f7fa',
  Ghost: '#ede7f6',
  Normal: '#fafafa',
  Flying: '#e8eaf6',
};

const COLORS_MAP = {
  red: 'red and orange',
  blue: 'blue and cyan',
  green: 'green and emerald',
  yellow: 'yellow and golden',
  purple: 'purple and violet',
  pink: 'pink and magenta',
  orange: 'orange and amber',
  white: 'white and silver',
};

const ANIMALS_MAP = {
  cat: 'cat',
  dragon: 'dragon',
  rabbit: 'rabbit',
  bird: 'bird',
  shark: 'shark',
  fox: 'fox',
  turtle: 'turtle',
  wolf: 'wolf',
  bear: 'bear',
  unicorn: 'unicorn',
};

const POWERS_MAP = {
  flying: 'majestic wings and ability to fly',
  fire: 'fire flames and glowing embers around it',
  ice: 'ice crystals and frosty aura',
  electric: 'electric sparks and lightning bolts',
  invisible: 'a mysterious translucent ghostly glow',
  water: 'water splashes and ocean waves',
};

const PLANS = {
  single: { credits: 1, price: 149, label: '1 Card - $1.49' },
  pack5: { credits: 5, price: 299, label: '5 Cards - $2.99' },
  pack10: { credits: 10, price: 499, label: '10 Cards - $4.99' },
};

let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'Inter-Regular.ttf'), 'CardFont');
  GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'Inter-Bold.ttf'), 'CardFontBold');
  fontsRegistered = true;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function timingSafeEqualString(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function clamp(number, min, max) {
  return Math.min(max, Math.max(min, number));
}

function sanitizeText(value, fallback = '', maxLength = 120) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return normalized || fallback;
}

function normalizeEmail(email) {
  const trimmed = String(email ?? '').trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);
  return trimmed || '';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeType(value) {
  const next = sanitizeText(value, 'Normal', 16);
  return SUPPORTED_TYPES.has(next) ? next : 'Normal';
}

function normalizeAttack(rawAttack, fallbackName, fallbackDamage) {
  const attack = rawAttack && typeof rawAttack === 'object' ? rawAttack : {};
  return {
    name: sanitizeText(attack.name, fallbackName, 24),
    damage: clamp(Number.parseInt(attack.damage, 10) || fallbackDamage, 0, 90),
    desc: sanitizeText(attack.desc, '', 120),
  };
}

function normalizeCardData(raw) {
  const card = raw && typeof raw === 'object' ? raw : {};
  const type = normalizeType(card.type);

  return {
    name: sanitizeText(card.name, 'Mysteon', 12),
    hp: clamp(Number.parseInt(card.hp, 10) || 60, 40, 90),
    type,
    attack1: normalizeAttack(card.attack1, 'Tackle', 20),
    attack2: normalizeAttack(card.attack2, 'Quick Strike', 40),
    weakness: normalizeType(card.weakness || 'Normal'),
    resistance: normalizeType(card.resistance || 'Normal'),
    retreatCost: clamp(Number.parseInt(card.retreatCost, 10) || 1, 0, 4),
    flavor: sanitizeText(card.flavor, 'A creature born from pure imagination.', 160),
  };
}

function normalizeTrainerCardData(raw) {
  const card = raw && typeof raw === 'object' ? raw : {};
  return {
    title: sanitizeText(card.title, 'Trainer Card', 30),
    effect: sanitizeText(card.effect, 'Draw 2 cards.', 200),
    flavor: sanitizeText(card.flavor, 'A special moment captured forever.', 160),
    cardStyle: CARD_STYLES.has(card.cardStyle) ? card.cardStyle : DEFAULT_CARD_STYLE,
    ruleText: sanitizeText(card.ruleText, 'You may play only 1 Supporter card during your turn (before your attack).', 120),
  };
}

function sanitizeFilename(value, fallback = 'pokemon-card') {
  const cleaned = sanitizeText(value, fallback, 48).replace(/[^a-z0-9_-]+/gi, '-');
  return cleaned.replace(/-+/g, '-').replace(/^-|-$/g, '') || fallback;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return;
      const key = decodeURIComponent(part.slice(0, idx));
      const value = decodeURIComponent(part.slice(idx + 1));
      cookies[key] = value;
    });
  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const segments = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  if (options.maxAge) segments.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  if (options.httpOnly) segments.push('HttpOnly');
  if (options.path) segments.push(`Path=${options.path}`);
  if (options.sameSite) segments.push(`SameSite=${options.sameSite}`);
  if (options.secure) segments.push('Secure');
  return segments.join('; ');
}

function applySecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "script-src 'self' 'unsafe-inline'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function resolveBaseUrl(req, env) {
  return env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function toFriendlyApiError(error, fallbackMessage) {
  if (error && error.publicMessage) {
    return { status: error.statusCode || 400, body: { error: error.publicMessage, code: error.code } };
  }
  return { status: 500, body: { error: fallbackMessage } };
}

function createPublicError(publicMessage, statusCode = 400, code) {
  const error = new Error(publicMessage);
  error.publicMessage = publicMessage;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseTrustProxySetting(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'boolean' || typeof value === 'number') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;

  const numeric = Number.parseInt(normalized, 10);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  return value;
}

function setupDatabase(db) {
  try {
    db.pragma('journal_mode = WAL');
  } catch {
    // In-memory databases do not support WAL.
  }
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      display_name TEXT,
      promo_credits_remaining INTEGER NOT NULL DEFAULT 1,
      terms_accepted_at TEXT,
      privacy_accepted_at TEXT,
      photo_parent_consent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_attempts (
      request_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      charge_source TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      refunded_at TEXT,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_results (
      request_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      image_url TEXT NOT NULL,
      card_data_json TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(request_id) REFERENCES generation_attempts(request_id) ON DELETE CASCADE,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS checkout_sessions (
      stripe_session_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email TEXT,
      plan TEXT NOT NULL,
      credits_added INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
    CREATE INDEX IF NOT EXISTS idx_credit_ledger_account_id ON credit_ledger(account_id);
    CREATE INDEX IF NOT EXISTS idx_generation_attempts_account_id ON generation_attempts(account_id);
    CREATE INDEX IF NOT EXISTS idx_generation_results_account_id ON generation_results(account_id);
    CREATE INDEX IF NOT EXISTS idx_checkout_sessions_account_id ON checkout_sessions(account_id);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_account_id ON auth_tokens(account_id);
  `);
}

function createStatements(db) {
  return {
    insertAccount: db.prepare(`
      INSERT INTO accounts (
        id, email, display_name, promo_credits_remaining,
        terms_accepted_at, privacy_accepted_at, photo_parent_consent_at
      ) VALUES (
        @id, @email, @display_name, @promo_credits_remaining,
        @terms_accepted_at, @privacy_accepted_at, @photo_parent_consent_at
      )
    `),
    selectAccountById: db.prepare(`
      SELECT
        a.id,
        a.email,
        a.display_name,
        a.promo_credits_remaining,
        a.terms_accepted_at,
        a.privacy_accepted_at,
        a.photo_parent_consent_at,
        a.created_at,
        a.updated_at,
        COALESCE(SUM(l.delta), 0) AS paid_credits
      FROM accounts a
      LEFT JOIN credit_ledger l ON l.account_id = a.id
      WHERE a.id = ?
      GROUP BY a.id
    `),
    selectAccountByEmail: db.prepare(`
      SELECT
        a.id,
        a.email,
        a.display_name,
        a.promo_credits_remaining,
        a.terms_accepted_at,
        a.privacy_accepted_at,
        a.photo_parent_consent_at,
        a.created_at,
        a.updated_at,
        COALESCE(SUM(l.delta), 0) AS paid_credits
      FROM accounts a
      LEFT JOIN credit_ledger l ON l.account_id = a.id
      WHERE a.email = ?
      GROUP BY a.id
    `),
    updateAccount: db.prepare(`
      UPDATE accounts
      SET
        email = @email,
        display_name = @display_name,
        promo_credits_remaining = @promo_credits_remaining,
        terms_accepted_at = @terms_accepted_at,
        privacy_accepted_at = @privacy_accepted_at,
        photo_parent_consent_at = @photo_parent_consent_at,
        updated_at = datetime('now')
      WHERE id = @id
    `),
    insertSession: db.prepare(`
      INSERT INTO sessions (id, account_id, secret_hash, user_agent)
      VALUES (?, ?, ?, ?)
    `),
    selectSession: db.prepare(`
      SELECT id, account_id, secret_hash, last_seen_at
      FROM sessions
      WHERE id = ?
    `),
    updateSessionLastSeen: db.prepare(`
      UPDATE sessions
      SET last_seen_at = datetime('now')
      WHERE id = ?
    `),
    insertLedger: db.prepare(`
      INSERT INTO credit_ledger (account_id, delta, reason, reference)
      VALUES (?, ?, ?, ?)
    `),
    selectAttempt: db.prepare(`
      SELECT request_id, account_id, mode, charge_source, status
      FROM generation_attempts
      WHERE request_id = ?
    `),
    insertAttempt: db.prepare(`
      INSERT INTO generation_attempts (request_id, account_id, mode, charge_source, status)
      VALUES (?, ?, ?, ?, 'reserved')
    `),
    upsertGenerationResult: db.prepare(`
      INSERT INTO generation_results (request_id, account_id, mode, image_url, card_data_json, display_name)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET
        image_url = excluded.image_url,
        card_data_json = excluded.card_data_json,
        display_name = excluded.display_name
    `),
    selectGenerationResultForAccount: db.prepare(`
      SELECT request_id, account_id, mode, image_url, card_data_json, display_name
      FROM generation_results
      WHERE request_id = ? AND account_id = ?
    `),
    markAttemptCompleted: db.prepare(`
      UPDATE generation_attempts
      SET status = 'completed', completed_at = datetime('now')
      WHERE request_id = ? AND status = 'reserved'
    `),
    markAttemptRefunded: db.prepare(`
      UPDATE generation_attempts
      SET status = 'refunded', refunded_at = datetime('now')
      WHERE request_id = ? AND status = 'reserved'
    `),
    insertCheckoutSession: db.prepare(`
      INSERT INTO checkout_sessions (stripe_session_id, account_id, email, plan, credits_added, status)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(stripe_session_id) DO UPDATE SET
        account_id = excluded.account_id,
        email = excluded.email,
        plan = excluded.plan,
        credits_added = excluded.credits_added
    `),
    selectCheckoutSession: db.prepare(`
      SELECT stripe_session_id, account_id, email, plan, credits_added, status
      FROM checkout_sessions
      WHERE stripe_session_id = ?
    `),
    markCheckoutCompleted: db.prepare(`
      UPDATE checkout_sessions
      SET status = 'completed', email = ?, completed_at = datetime('now')
      WHERE stripe_session_id = ?
    `),
    insertAuthToken: db.prepare(`
      INSERT INTO auth_tokens (id, account_id, email, token_hash, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    selectAuthToken: db.prepare(`
      SELECT id, account_id, email, token_hash, expires_at, used_at
      FROM auth_tokens
      WHERE id = ?
    `),
    markAuthTokenUsed: db.prepare(`
      UPDATE auth_tokens
      SET used_at = datetime('now')
      WHERE id = ? AND used_at IS NULL
    `),
  };
}

function hydrateAccount(row) {
  if (!row) return null;
  const paidCredits = Number(row.paid_credits) || 0;
  const promoCreditsRemaining = Number(row.promo_credits_remaining) || 0;
  const totalCredits = promoCreditsRemaining + paidCredits;
  return {
    id: row.id,
    email: row.email || '',
    displayName: row.display_name || '',
    promoCreditsRemaining,
    paidCredits,
    totalCredits,
    hasCredits: totalCredits > 0,
    consents: {
      termsAccepted: !!row.terms_accepted_at,
      privacyAccepted: !!row.privacy_accepted_at,
      photoParentConsent: !!row.photo_parent_consent_at,
    },
  };
}

function validatePhotoDataUrl(photo) {
  const value = String(photo || '');
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value)) {
    throw createPublicError('Please upload a JPG, PNG, or WebP photo.', 400, 'invalid_photo_format');
  }
  if (value.length > MAX_PHOTO_DATA_URL_LENGTH) {
    throw createPublicError('Photo is too large after processing. Please try a smaller image.', 400, 'photo_too_large');
  }
  return value;
}

function buildEmailTransport(env) {
  if (!env.EMAIL_USER || !env.EMAIL_PASS) {
    return null;
  }

  const transporter = nodemailer.createTransport({
    service: env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: env.EMAIL_USER,
      pass: env.EMAIL_PASS,
    },
  });

  transporter.verify((error) => {
    if (error) {
      console.log('   Email:    ❌', error.message);
    } else {
      console.log('   Email:    ✅ Ready');
    }
  });

  return transporter;
}

function buildAiClients(env) {
  if (!env.AZURE_OPENAI_API_KEY || !env.AZURE_OPENAI_ENDPOINT) {
    console.log('   AI:       ❌ (Set AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT in .env)');
    return { aiImage: null, aiChat: null, aiVision: null };
  }

  console.log('   AI:       ✅ Ready (Azure OpenAI)');
  return {
    aiImage: new AzureOpenAI({
      apiKey: env.AZURE_OPENAI_API_KEY,
      endpoint: env.AZURE_OPENAI_ENDPOINT,
      apiVersion: '2024-02-01',
    }),
    aiChat: new AzureOpenAI({
      apiKey: env.AZURE_OPENAI_API_KEY,
      endpoint: env.AZURE_OPENAI_ENDPOINT,
      apiVersion: '2025-04-01-preview',
    }),
    aiVision: new AzureOpenAI({
      apiKey: env.AZURE_OPENAI_API_KEY,
      endpoint: env.AZURE_OPENAI_ENDPOINT,
      apiVersion: '2025-01-01-preview',
    }),
  };
}

function buildStripe(env) {
  if (!env.STRIPE_SECRET_KEY) {
    console.log('   Stripe:   ❌ (Set STRIPE_SECRET_KEY in .env)');
    return null;
  }
  const Stripe = require('stripe');
  console.log('   Stripe:   ✅ Ready');
  return new Stripe(env.STRIPE_SECRET_KEY);
}

function createServices({ db, statements, env }) {
  const transporter = buildEmailTransport(env);
  if (!transporter) {
    console.log('   Email:    ❌ (Set EMAIL_USER and EMAIL_PASS in .env)');
  }
  const stripe = buildStripe(env);
  const { aiImage, aiChat, aiVision } = buildAiClients(env);
  const aiRateMap = new Map();

  function setSessionCookie(res, token) {
    res.append(
      'Set-Cookie',
      serializeCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        maxAge: SESSION_MAX_AGE_MS,
        path: '/',
        sameSite: 'Lax',
        secure: env.NODE_ENV === 'production',
      })
    );
  }

  function getAccountById(accountId) {
    return hydrateAccount(statements.selectAccountById.get(accountId));
  }

  function getAccountByEmail(email) {
    return hydrateAccount(statements.selectAccountByEmail.get(normalizeEmail(email)));
  }

  function createGuestAccount() {
    const accountId = createId('acct');
    statements.insertAccount.run({
      id: accountId,
      email: null,
      display_name: null,
      promo_credits_remaining: 1,
      terms_accepted_at: null,
      privacy_accepted_at: null,
      photo_parent_consent_at: null,
    });
    return getAccountById(accountId);
  }

  function issueSessionForAccount(accountId, userAgent) {
    const sessionId = createId('sess');
    const secret = crypto.randomBytes(32).toString('hex');
    statements.insertSession.run(sessionId, accountId, sha256(secret), sanitizeText(userAgent, '', 180));
    return `${sessionId}.${secret}`;
  }

  function getOrCreateSessionAccount(req, res) {
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies[SESSION_COOKIE];
    if (sessionToken) {
      const [sessionId, secret] = sessionToken.split('.');
      if (sessionId && secret) {
        const row = statements.selectSession.get(sessionId);
        if (row && timingSafeEqualString(row.secret_hash, sha256(secret))) {
          if (row.last_seen_at) {
            const lastSeen = Date.parse(row.last_seen_at.endsWith('Z') ? row.last_seen_at : `${row.last_seen_at}Z`);
            if (Number.isFinite(lastSeen) && Date.now() - lastSeen > SESSION_TOUCH_INTERVAL_MS) {
              statements.updateSessionLastSeen.run(sessionId);
            }
          }
          const account = getAccountById(row.account_id);
          if (account) return account;
        }
      }
    }

    const account = createGuestAccount();
    setSessionCookie(res, issueSessionForAccount(account.id, req.get('user-agent') || ''));
    return account;
  }

  function syncAccountProfile(accountId, input = {}) {
    const account = getAccountById(accountId);
    if (!account) throw createPublicError('Account not found.', 404, 'account_not_found');

    const nextEmail = input.email ? normalizeEmail(input.email) : account.email;
    if (input.email) {
      if (!isValidEmail(nextEmail)) {
        throw createPublicError('Please enter a valid email address.', 400, 'invalid_email');
      }
      const existing = getAccountByEmail(nextEmail);
      if (existing && existing.id !== accountId) {
        throw createPublicError('This email is already linked to another account. Use the restore link instead.', 409, 'email_in_use');
      }
    }

    const nextDisplayName = input.displayName
      ? sanitizeText(input.displayName, account.displayName, MAX_NAME_LENGTH)
      : account.displayName;

    const nextAccount = {
      id: account.id,
      email: nextEmail || null,
      display_name: nextDisplayName || null,
      promo_credits_remaining: account.promoCreditsRemaining,
      terms_accepted_at: account.consents.termsAccepted || input.acceptTerms ? new Date().toISOString() : null,
      privacy_accepted_at: account.consents.privacyAccepted || input.acceptPrivacy ? new Date().toISOString() : null,
      photo_parent_consent_at:
        account.consents.photoParentConsent || input.photoParentConsent ? new Date().toISOString() : null,
    };

    statements.updateAccount.run(nextAccount);
    return getAccountById(accountId);
  }

  function assertRequiredConsents(account, { requirePhotoConsent = false } = {}) {
    if (!account.consents.termsAccepted || !account.consents.privacyAccepted) {
      throw createPublicError('Please accept the Terms and Privacy Policy before continuing.', 400, 'missing_consent');
    }
    if (requirePhotoConsent && !account.consents.photoParentConsent) {
      throw createPublicError(
        'Parent or guardian consent is required before uploading a child photo.',
        400,
        'missing_photo_consent'
      );
    }
  }

  const reserveCreditTransaction = db.transaction((accountId, mode) => {
    const account = getAccountById(accountId);
    if (!account) throw createPublicError('Account not found.', 404, 'account_not_found');

    const requestId = createId('gen');
    if (account.promoCreditsRemaining > 0) {
      statements.updateAccount.run({
        id: account.id,
        email: account.email || null,
        display_name: account.displayName || null,
        promo_credits_remaining: account.promoCreditsRemaining - 1,
        terms_accepted_at: account.consents.termsAccepted ? new Date().toISOString() : null,
        privacy_accepted_at: account.consents.privacyAccepted ? new Date().toISOString() : null,
        photo_parent_consent_at: account.consents.photoParentConsent ? new Date().toISOString() : null,
      });
      statements.insertAttempt.run(requestId, accountId, mode, 'promo');
      return { ok: true, requestId, chargeSource: 'promo' };
    }

    if (account.paidCredits > 0) {
      statements.insertLedger.run(accountId, -1, 'generation_reserved', `generation:${requestId}:debit`);
      statements.insertAttempt.run(requestId, accountId, mode, 'paid');
      return { ok: true, requestId, chargeSource: 'paid' };
    }

    return { ok: false };
  });

  const refundReservedCreditTransaction = db.transaction((requestId) => {
    const attempt = statements.selectAttempt.get(requestId);
    if (!attempt || attempt.status !== 'reserved') return false;

    const account = getAccountById(attempt.account_id);
    if (!account) return false;

    if (attempt.charge_source === 'promo') {
      statements.updateAccount.run({
        id: account.id,
        email: account.email || null,
        display_name: account.displayName || null,
        promo_credits_remaining: account.promoCreditsRemaining + 1,
        terms_accepted_at: account.consents.termsAccepted ? new Date().toISOString() : null,
        privacy_accepted_at: account.consents.privacyAccepted ? new Date().toISOString() : null,
        photo_parent_consent_at: account.consents.photoParentConsent ? new Date().toISOString() : null,
      });
    } else {
      statements.insertLedger.run(account.id, 1, 'generation_refund', `generation:${requestId}:refund`);
    }

    statements.markAttemptRefunded.run(requestId);
    return true;
  });

  function reserveCredit(accountId, mode) {
    return reserveCreditTransaction(accountId, mode);
  }

  function completeReservedCredit(requestId) {
    statements.markAttemptCompleted.run(requestId);
  }

  function refundReservedCredit(requestId) {
    return refundReservedCreditTransaction(requestId);
  }

  function storeGenerationResult(accountId, requestId, mode, imageUrl, cardData, displayName) {
    statements.upsertGenerationResult.run(
      requestId,
      accountId,
      mode,
      imageUrl,
      JSON.stringify(cardData),
      sanitizeText(displayName, 'Pokemon Trainer', MAX_NAME_LENGTH)
    );
  }

  function getGenerationResult(accountId, requestId) {
    return statements.selectGenerationResultForAccount.get(requestId, accountId);
  }

  const finalizeCheckoutTransaction = db.transaction((checkoutSession) => {
    const stripeSessionId = checkoutSession.id;
    const creditsToAdd = Number.parseInt(checkoutSession.metadata?.credits, 10) || 0;
    const accountId = sanitizeText(checkoutSession.metadata?.accountId, '', 64);
    const plan = sanitizeText(checkoutSession.metadata?.plan, 'unknown', 24);
    const email = normalizeEmail(checkoutSession.customer_details?.email || checkoutSession.metadata?.email || '');

    if (!stripeSessionId || !accountId || creditsToAdd <= 0) {
      throw new Error('Invalid checkout session metadata.');
    }

    const existing = statements.selectCheckoutSession.get(stripeSessionId);
    if (existing && existing.status === 'completed') {
      return { alreadyProcessed: true, account: getAccountById(existing.account_id) };
    }

    statements.insertCheckoutSession.run(
      stripeSessionId,
      accountId,
      email || null,
      plan,
      creditsToAdd,
      existing?.status || 'created'
    );
    statements.insertLedger.run(accountId, creditsToAdd, 'stripe_purchase', `stripe:${stripeSessionId}:credit`);
    statements.markCheckoutCompleted.run(email || null, stripeSessionId);

    if (email) {
      const account = getAccountById(accountId);
      if (account && !account.email) {
        syncAccountProfile(accountId, { email });
      }
    }

    return { alreadyProcessed: false, account: getAccountById(accountId) };
  });

  function finalizeCheckoutSession(checkoutSession) {
    return finalizeCheckoutTransaction(checkoutSession);
  }

  function createRestoreToken(account) {
    const tokenId = createId('restore');
    const secret = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + AUTH_TOKEN_TTL_MS).toISOString();
    statements.insertAuthToken.run(tokenId, account.id, account.email, sha256(secret), expiresAt);
    return `${tokenId}.${secret}`;
  }

  function consumeRestoreToken(token) {
    const [tokenId, secret] = String(token || '').split('.');
    if (!tokenId || !secret) {
      throw createPublicError('That sign-in link is invalid.', 400, 'invalid_restore_token');
    }

    const row = statements.selectAuthToken.get(tokenId);
    if (!row || row.used_at) {
      throw createPublicError('That sign-in link has already been used or is invalid.', 400, 'invalid_restore_token');
    }
    if (!timingSafeEqualString(row.token_hash, sha256(secret))) {
      throw createPublicError('That sign-in link is invalid.', 400, 'invalid_restore_token');
    }
    if (Date.now() > Date.parse(row.expires_at)) {
      throw createPublicError('That sign-in link has expired. Please request a new one.', 400, 'expired_restore_token');
    }

    statements.markAuthTokenUsed.run(tokenId);
    return getAccountById(row.account_id);
  }

  function checkAIRate(identityKey) {
    const now = Date.now();
    const recent = (aiRateMap.get(identityKey) || []).filter((timestamp) => now - timestamp < 60_000);
    if (recent.length >= 5) return false;
    recent.push(now);
    aiRateMap.set(identityKey, recent);
    return true;
  }

  async function sendRestoreEmail({ account, req }) {
    if (!transporter) {
      throw createPublicError('Email restore is not configured yet.', 503, 'restore_unavailable');
    }

    const token = createRestoreToken(account);
    const restoreUrl = `${resolveBaseUrl(req, env)}/api/account/restore/consume?token=${encodeURIComponent(token)}`;
    const safeEmail = escapeHtml(account.email);

    await transporter.sendMail({
      from: `"DIY Pokemon Card" <${env.EMAIL_FROM || env.EMAIL_USER}>`,
      to: account.email,
      subject: 'Your DIY Pokemon Card sign-in link',
      html: `
        <div style="font-family:Arial,sans-serif; background:#0a0e1a; color:#fff; padding:24px;">
          <div style="max-width:560px; margin:0 auto; background:#151c2f; border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:32px;">
            <h1 style="margin:0 0 12px; color:#FFD700; font-size:24px;">Sign back in</h1>
            <p style="margin:0 0 16px; color:#d5d8e4; line-height:1.6;">
              Use the button below to restore the credits linked to <strong>${safeEmail}</strong>.
            </p>
            <p style="margin:0 0 24px;">
              <a href="${restoreUrl}" style="display:inline-block; background:#FFD700; color:#111827; text-decoration:none; padding:12px 20px; border-radius:999px; font-weight:700;">
                Restore my account
              </a>
            </p>
            <p style="margin:0; color:#9ba3b8; font-size:13px;">This link expires in 30 minutes and can only be used once.</p>
          </div>
        </div>
      `,
      text: `Restore your account here: ${restoreUrl}`,
    });
  }

  async function maybeSendCardEmail({ email, displayName, pokemonName, rawImgBuffer, cardImgBuffer, fromPhoto }) {
    if (!email) return { status: 'not_requested' };
    if (!transporter) return { status: 'not_configured' };

    const safeDisplayName = escapeHtml(displayName);
    const safePokemonName = escapeHtml(pokemonName);
    const prefix = sanitizeFilename(pokemonName);

    try {
      await transporter.sendMail({
        from: `"DIY Pokemon Card" <${env.EMAIL_FROM || env.EMAIL_USER}>`,
        to: email,
        subject: `${safeDisplayName}'s Pokemon Card - ${safePokemonName}`,
        attachments: [
          { filename: `${prefix}-card.jpg`, content: cardImgBuffer, cid: 'pokemoncard' },
          { filename: `${prefix}-original.jpg`, content: rawImgBuffer, cid: 'pokemonraw' },
        ],
        html: `
          <html>
            <body style="margin:0; padding:0; background:#0a0e1a; font-family:Arial,sans-serif;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e1a; padding:20px;">
                <tr>
                  <td align="center">
                    <table width="600" cellpadding="0" cellspacing="0" style="background:#1a1245; border-radius:20px; overflow:hidden; border:2px solid #FFD700;">
                      <tr>
                        <td style="padding:30px 40px 16px; text-align:center;">
                          <div style="font-size:26px; font-weight:bold; color:#FFD700;">Your Pokemon Trading Card</div>
                          <div style="font-size:13px; color:rgba(255,255,255,0.6); margin-top:6px;">
                            ${fromPhoto ? 'Created from your photo with AI' : 'Created with DIY Pokemon Card Maker'}
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 40px; text-align:center;">
                          <img src="cid:pokemoncard" alt="${safePokemonName} Card" style="width:100%; max-width:400px; border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,0.4);">
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:16px 40px 8px; text-align:center;">
                          <div style="font-size:20px; font-weight:bold; color:#FFD700;">${safePokemonName}</div>
                          <div style="font-size:12px; color:rgba(255,255,255,0.6); margin-top:4px;">Designed by <strong style="color:#fff;">${safeDisplayName}</strong></div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:20px 40px 12px; text-align:center;">
                          <div style="font-size:18px; font-weight:bold; color:#FFD700;">Original AI Artwork</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 40px 20px; text-align:center;">
                          <img src="cid:pokemonraw" alt="${safePokemonName}" style="width:100%; max-width:400px; border-radius:16px; border:3px solid rgba(255,215,0,0.3);">
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:10px 40px 28px; text-align:center;">
                          <div style="font-size:14px; color:rgba(255,255,255,0.6); line-height:1.7;">
                            These images are attached so you can save them any time.
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
          </html>
        `,
        text: `Hi ${displayName}! Your Pokemon card "${pokemonName}" is attached to this email.`,
      });
      return { status: 'sent' };
    } catch (error) {
      console.error('   Email send error:', error.message);
      return { status: 'failed' };
    }
  }

  return {
    stripe,
    aiImage,
    aiChat,
    aiVision,
    transporter,
    getOrCreateSessionAccount,
    syncAccountProfile,
    assertRequiredConsents,
    reserveCredit,
    completeReservedCredit,
    refundReservedCredit,
    storeGenerationResult,
    getGenerationResult,
    finalizeCheckoutSession,
    sendRestoreEmail,
    maybeSendCardEmail,
    getAccountById,
    getAccountByEmail,
    issueSessionForAccount,
    setSessionCookie,
    consumeRestoreToken,
    checkAIRate,
  };
}

function downloadImageBuffer(url) {
  return new Promise((resolve, reject) => {
    function follow(nextUrl) {
      let parsed;
      try {
        parsed = new URL(nextUrl);
      } catch {
        reject(new Error('Invalid image URL.'));
        return;
      }

      if (parsed.protocol !== 'https:') {
        reject(new Error('Only HTTPS image URLs are supported.'));
        return;
      }

      const request = https.get(parsed, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          follow(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Image download failed with status ${response.statusCode}.`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });

      request.setTimeout(RAW_IMAGE_TIMEOUT_MS, () => {
        request.destroy(new Error('Image download timed out.'));
      });
      request.on('error', reject);
    }

    follow(url);
  });
}

async function generateCardImage(imageBuffer, cardData, displayName) {
  const SCALE = 2;
  const CW = 630 * SCALE;
  const CH = 880 * SCALE;
  const PAD = 30 * SCALE;
  const IW = CW - PAD * 2;
  const IH = 360 * SCALE;
  const IT = 100 * SCALE;
  const typeName = cardData.type || 'Normal';
  const tc = TYPE_COLORS[typeName] || '#757575';
  const bg = CARD_BG_COLORS[typeName] || '#f7f5e8';
  const a1 = cardData.attack1 || {};
  const a2 = cardData.attack2 || {};
  const rc = cardData.retreatCost || 1;
  const ay = IT + IH + 20 * SCALE;
  const S = (px) => px * SCALE;

  const canvas = createCanvas(CW, CH);
  const ctx = canvas.getContext('2d');

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function circ(cx, cy, r, fill, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }

  function line(y, color = '#d0d0d0') {
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(CW - PAD, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = SCALE;
    ctx.stroke();
  }

  rr(0, 0, CW, CH, S(24));
  const backgroundGradient = ctx.createLinearGradient(0, 0, CW, CH);
  backgroundGradient.addColorStop(0, bg);
  backgroundGradient.addColorStop(0.5, '#fffef8');
  backgroundGradient.addColorStop(1, bg);
  ctx.fillStyle = backgroundGradient;
  ctx.fill();

  rr(S(4), S(4), CW - S(8), CH - S(8), S(20));
  const borderGradient = ctx.createLinearGradient(0, 0, CW, CH);
  borderGradient.addColorStop(0, tc);
  borderGradient.addColorStop(0.25, '#e8c547');
  borderGradient.addColorStop(0.5, tc);
  borderGradient.addColorStop(0.75, '#e8c547');
  borderGradient.addColorStop(1, tc);
  ctx.strokeStyle = borderGradient;
  ctx.lineWidth = S(8);
  ctx.stroke();

  rr(S(16), S(16), CW - S(32), CH - S(32), S(14));
  ctx.strokeStyle = 'rgba(201,168,76,0.5)';
  ctx.lineWidth = S(2);
  ctx.stroke();

  const shimmer = ctx.createLinearGradient(0, 0, CW, CH * 0.5);
  shimmer.addColorStop(0, 'rgba(255,255,255,0)');
  shimmer.addColorStop(0.45, 'rgba(255,255,255,0.08)');
  shimmer.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  shimmer.addColorStop(0.55, 'rgba(255,255,255,0.08)');
  shimmer.addColorStop(1, 'rgba(255,255,255,0)');
  rr(S(16), S(16), CW - S(32), CH - S(32), S(14));
  ctx.fillStyle = shimmer;
  ctx.fill();

  ctx.font = `700 ${S(12)}px CardFontBold`;
  ctx.fillStyle = '#999';
  ctx.textAlign = 'left';
  ctx.fillText('BASIC POKEMON', PAD, S(44));

  ctx.shadowColor = 'rgba(0,0,0,0.1)';
  ctx.shadowBlur = S(6);
  ctx.shadowOffsetY = S(2);
  ctx.font = `700 ${S(34)}px CardFontBold`;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText(cardData.name || 'Mysteon', PAD, S(84));
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.font = `700 ${S(40)}px CardFontBold`;
  ctx.fillStyle = '#cc0000';
  ctx.textAlign = 'right';
  ctx.fillText(String(cardData.hp || 60), CW - PAD, S(76));
  ctx.font = `700 ${S(14)}px CardFontBold`;
  ctx.fillText('HP', CW - PAD, S(94));
  ctx.textAlign = 'left';

  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = S(16);
  ctx.shadowOffsetY = S(6);
  rr(PAD, IT, IW, IH, S(10));
  ctx.fillStyle = '#c9a84c';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  rr(PAD + S(3), IT + S(3), IW - S(6), IH - S(6), S(8));
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = S(1);
  ctx.stroke();

  try {
    const image = await loadImage(imageBuffer);
    ctx.save();
    rr(PAD + S(5), IT + S(5), IW - S(10), IH - S(10), S(6));
    ctx.clip();
    ctx.drawImage(image, PAD + S(5), IT + S(5), IW - S(10), IH - S(10));
    ctx.restore();
  } catch (error) {
    console.error('Failed to load generated image:', error.message);
  }

  const badgeWidth = S(120);
  const badgeHeight = S(26);
  const badgeX = PAD;
  const badgeY = ay;
  rr(badgeX, badgeY, badgeWidth, badgeHeight, S(13));
  const badgeGradient = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeWidth, badgeY);
  badgeGradient.addColorStop(0, tc);
  badgeGradient.addColorStop(1, `${tc}aa`);
  ctx.fillStyle = badgeGradient;
  ctx.fill();
  ctx.font = `700 ${S(12)}px CardFontBold`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(typeName.toUpperCase(), badgeX + badgeWidth / 2, badgeY + S(18));
  ctx.textAlign = 'left';

  ctx.font = `400 ${S(11)}px CardFont`;
  ctx.fillStyle = '#999';
  ctx.fillText(`Designed by ${displayName}`, badgeX + badgeWidth + S(12), badgeY + S(18));

  const attack1Y = ay + S(40);
  line(attack1Y);
  circ(PAD + S(12), attack1Y + S(28), S(10), tc, 0.9);
  circ(PAD + S(34), attack1Y + S(28), S(10), '#ccc', 0.6);
  ctx.font = `700 ${S(20)}px CardFontBold`;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText(a1.name || 'Tackle', PAD + S(52), attack1Y + S(34));
  ctx.font = `700 ${S(30)}px CardFontBold`;
  ctx.textAlign = 'right';
  ctx.fillText(String(a1.damage || 20), CW - PAD, attack1Y + S(36));
  ctx.textAlign = 'left';
  ctx.font = `400 ${S(11)}px CardFont`;
  ctx.fillStyle = '#777';
  ctx.fillText(a1.desc || '', PAD + S(52), attack1Y + S(54));

  const attack2Y = attack1Y + S(68);
  line(attack2Y);
  circ(PAD + S(12), attack2Y + S(28), S(10), tc, 0.9);
  circ(PAD + S(34), attack2Y + S(28), S(10), tc, 0.6);
  circ(PAD + S(56), attack2Y + S(28), S(10), '#ccc', 0.5);
  ctx.font = `700 ${S(20)}px CardFontBold`;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillText(a2.name || 'Strike', PAD + S(74), attack2Y + S(34));
  ctx.font = `700 ${S(30)}px CardFontBold`;
  ctx.textAlign = 'right';
  ctx.fillText(String(a2.damage || 40), CW - PAD, attack2Y + S(36));
  ctx.textAlign = 'left';
  ctx.font = `400 ${S(11)}px CardFont`;
  ctx.fillStyle = '#777';
  ctx.fillText(a2.desc || '', PAD + S(74), attack2Y + S(54));

  const statsY = attack2Y + S(72);
  line(statsY, '#c0c0c0');
  ctx.font = `700 ${S(10)}px CardFontBold`;
  ctx.fillStyle = '#999';
  ctx.textAlign = 'center';
  ctx.fillText('WEAKNESS', CW * 0.17, statsY + S(20));
  circ(CW * 0.17 - S(8), statsY + S(38), S(10), TYPE_COLORS[cardData.weakness] || '#757575');
  ctx.font = `700 ${S(15)}px CardFontBold`;
  ctx.fillStyle = '#333';
  ctx.fillText('x2', CW * 0.17 + S(12), statsY + S(42));

  ctx.font = `700 ${S(10)}px CardFontBold`;
  ctx.fillStyle = '#999';
  ctx.fillText('RESISTANCE', CW * 0.5, statsY + S(20));
  circ(CW * 0.5 - S(10), statsY + S(38), S(10), TYPE_COLORS[cardData.resistance] || '#757575');
  ctx.font = `700 ${S(15)}px CardFontBold`;
  ctx.fillStyle = '#333';
  ctx.fillText('-20', CW * 0.5 + S(10), statsY + S(42));

  ctx.font = `700 ${S(10)}px CardFontBold`;
  ctx.fillStyle = '#999';
  ctx.fillText('RETREAT', CW * 0.83, statsY + S(20));
  for (let index = 0; index < rc; index += 1) {
    const cx = CW * 0.83 - (rc - 1) * S(10) + index * S(20);
    circ(cx, statsY + S(38), S(9), '#e0e0e0');
    ctx.beginPath();
    ctx.arc(cx, statsY + S(38), S(9), 0, Math.PI * 2);
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = SCALE;
    ctx.stroke();
  }

  const flavorY = statsY + S(58);
  line(flavorY, '#ddd');
  ctx.font = `italic ${S(12)}px CardFont`;
  ctx.fillStyle = '#888';
  ctx.textAlign = 'left';
  const flavor = cardData.flavor || 'A creature born from imagination.';
  const maxWidth = CW - PAD * 2;
  let lineText = '';
  let lineY = flavorY + S(22);
  for (const word of flavor.split(' ')) {
    const next = `${lineText}${word} `;
    if (ctx.measureText(next).width > maxWidth && lineText) {
      ctx.fillText(lineText.trim(), PAD, lineY);
      lineText = `${word} `;
      lineY += S(16);
    } else {
      lineText = next;
    }
  }
  if (lineText.trim()) {
    ctx.fillText(lineText.trim(), PAD, lineY);
  }

  ctx.font = `400 ${S(10)}px CardFont`;
  ctx.fillStyle = '#bbb';
  ctx.textAlign = 'center';
  ctx.fillText(`DIY Pokemon Card Collection · YBP-${Date.now().toString().slice(-4)}`, CW / 2, CH - S(22));

  return canvas.toBuffer('image/jpeg', { quality: 95 });
}

async function generateTrainerCardImage(imageBuffer, trainerData, displayName) {
  const SCALE = 2;
  const CW = 630 * SCALE;
  const CH = 880 * SCALE;
  const PAD = 30 * SCALE;
  const S = (px) => px * SCALE;

  const canvas = createCanvas(CW, CH);
  const ctx = canvas.getContext('2d');

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function wrapText(text, x, startY, maxWidth, lineHeight) {
    let lineStr = '';
    let curY = startY;
    for (const word of text.split(' ')) {
      const next = `${lineStr}${word} `;
      if (ctx.measureText(next).width > maxWidth && lineStr) {
        ctx.fillText(lineStr.trim(), x, curY);
        lineStr = `${word} `;
        curY += lineHeight;
      } else {
        lineStr = next;
      }
    }
    if (lineStr.trim()) {
      ctx.fillText(lineStr.trim(), x, curY);
      curY += lineHeight;
    }
    return curY;
  }

  const style = trainerData.cardStyle || 'supporter';

  if (style === 'supporter') {
    // ── Supporter Card: Silver/white border, clean elegant look ──
    const borderGrad = ctx.createLinearGradient(0, 0, CW, CH);
    borderGrad.addColorStop(0, '#c0c0c0');
    borderGrad.addColorStop(0.3, '#e8e8e8');
    borderGrad.addColorStop(0.5, '#f5f5f5');
    borderGrad.addColorStop(0.7, '#e8e8e8');
    borderGrad.addColorStop(1, '#c0c0c0');
    rr(0, 0, CW, CH, S(16));
    ctx.fillStyle = borderGrad;
    ctx.fill();

    // Inner card
    rr(S(12), S(12), CW - S(24), CH - S(24), S(12));
    ctx.fillStyle = '#fafafa';
    ctx.fill();

    // Top bar: "Supporter" badge + "TRAINER" label
    const barY = S(20);
    // "Supporter" badge (orange pill)
    const badgeW = S(100);
    const badgeH = S(24);
    const badgeX = S(24);
    rr(badgeX, barY, badgeW, badgeH, S(12));
    const badgeGrad = ctx.createLinearGradient(badgeX, barY, badgeX + badgeW, barY);
    badgeGrad.addColorStop(0, '#f59e0b');
    badgeGrad.addColorStop(1, '#d97706');
    ctx.fillStyle = badgeGrad;
    ctx.fill();
    ctx.font = `700 ${S(12)}px CardFontBold`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('Supporter', badgeX + badgeW / 2, barY + S(17));

    // "TRAINER" label on right
    ctx.font = `700 ${S(16)}px CardFontBold`;
    ctx.fillStyle = '#2e7d32';
    ctx.textAlign = 'right';
    ctx.fillText('TRAINER', CW - S(28), barY + S(18));
    ctx.textAlign = 'left';

    // Card Title (large)
    ctx.font = `700 ${S(36)}px CardFontBold`;
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.fillText(trainerData.title || 'Trainer Card', CW / 2, S(88));
    ctx.textAlign = 'left';

    // Image frame
    const imgX = PAD;
    const imgY = S(100);
    const imgW = CW - PAD * 2;
    const imgH = S(380);

    rr(imgX, imgY, imgW, imgH, S(8));
    ctx.fillStyle = '#e0e0e0';
    ctx.fill();

    try {
      const image = await loadImage(imageBuffer);
      ctx.save();
      rr(imgX + S(2), imgY + S(2), imgW - S(4), imgH - S(4), S(6));
      ctx.clip();
      // Cover fit
      const srcRatio = image.width / image.height;
      const dstRatio = (imgW - S(4)) / (imgH - S(4));
      let sx = 0, sy = 0, sw = image.width, sh = image.height;
      if (srcRatio > dstRatio) {
        sw = image.height * dstRatio;
        sx = (image.width - sw) / 2;
      } else {
        sh = image.width / dstRatio;
        sy = (image.height - sh) / 2;
      }
      ctx.drawImage(image, sx, sy, sw, sh, imgX + S(2), imgY + S(2), imgW - S(4), imgH - S(4));
      ctx.restore();
    } catch (error) {
      console.error('Failed to load portrait image:', error.message);
    }

    // Effect text area
    const effectY = imgY + imgH + S(20);
    ctx.font = `400 ${S(14)}px CardFont`;
    ctx.fillStyle = '#333';
    ctx.textAlign = 'left';
    const effectEndY = wrapText(trainerData.effect || 'Draw 2 cards.', PAD + S(4), effectY, CW - PAD * 2 - S(8), S(20));

    // Separator line
    const sepY = effectEndY + S(10);
    ctx.beginPath();
    ctx.moveTo(PAD, sepY);
    ctx.lineTo(CW - PAD, sepY);
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = SCALE;
    ctx.stroke();

    // Rule text
    ctx.font = `italic ${S(11)}px CardFont`;
    ctx.fillStyle = '#888';
    const ruleY = sepY + S(18);
    wrapText(
      trainerData.ruleText || 'You may play only 1 Supporter card during your turn (before your attack).',
      PAD + S(4), ruleY, CW - PAD * 2 - S(8), S(16)
    );

    // Footer: illustrator + date
    ctx.font = `400 ${S(10)}px CardFont`;
    ctx.fillStyle = '#bbb';
    ctx.textAlign = 'left';
    const footY = CH - S(32);
    ctx.fillText(`Illus. AI · ${displayName}`, PAD, footY);
    const dateStr = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
    ctx.font = `400 ${S(10)}px CardFont`;
    ctx.fillStyle = '#bbb';
    ctx.textAlign = 'right';
    ctx.fillText(`♥ ${dateStr}`, CW - PAD, footY);

    // Copyright line
    ctx.font = `400 ${S(8)}px CardFont`;
    ctx.fillStyle = '#ccc';
    ctx.textAlign = 'center';
    ctx.fillText('DIY Pokemon Card Maker · Created with AI', CW / 2, CH - S(16));

  } else if (style === 'fullart') {
    // ── Full Art Card: Large portrait fills most of the card ──
    rr(0, 0, CW, CH, S(16));
    ctx.fillStyle = '#1a1a2e';
    ctx.fill();

    // Colorful border
    rr(S(4), S(4), CW - S(8), CH - S(8), S(14));
    const fullBorderGrad = ctx.createLinearGradient(0, 0, CW, CH);
    fullBorderGrad.addColorStop(0, '#667eea');
    fullBorderGrad.addColorStop(0.5, '#764ba2');
    fullBorderGrad.addColorStop(1, '#f093fb');
    ctx.strokeStyle = fullBorderGrad;
    ctx.lineWidth = S(6);
    ctx.stroke();

    // Image fills most of the card
    const faImgX = S(16);
    const faImgY = S(16);
    const faImgW = CW - S(32);
    const faImgH = CH - S(200);

    try {
      const image = await loadImage(imageBuffer);
      ctx.save();
      rr(faImgX, faImgY, faImgW, faImgH, S(10));
      ctx.clip();
      const srcRatio = image.width / image.height;
      const dstRatio = faImgW / faImgH;
      let sx = 0, sy = 0, sw = image.width, sh = image.height;
      if (srcRatio > dstRatio) {
        sw = image.height * dstRatio;
        sx = (image.width - sw) / 2;
      } else {
        sh = image.width / dstRatio;
        sy = (image.height - sh) / 2;
      }
      ctx.drawImage(image, sx, sy, sw, sh, faImgX, faImgY, faImgW, faImgH);
      ctx.restore();
    } catch (error) {
      console.error('Failed to load portrait image:', error.message);
    }

    // Gradient overlay at bottom of image
    const overlayGrad = ctx.createLinearGradient(0, faImgY + faImgH - S(120), 0, faImgY + faImgH);
    overlayGrad.addColorStop(0, 'rgba(26,26,46,0)');
    overlayGrad.addColorStop(1, 'rgba(26,26,46,0.9)');
    ctx.save();
    rr(faImgX, faImgY, faImgW, faImgH, S(10));
    ctx.clip();
    ctx.fillStyle = overlayGrad;
    ctx.fillRect(faImgX, faImgY + faImgH - S(120), faImgW, S(120));
    ctx.restore();

    // Title over image bottom
    ctx.font = `700 ${S(32)}px CardFontBold`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = S(8);
    ctx.fillText(trainerData.title || 'Trainer Card', CW / 2, faImgY + faImgH - S(20));
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // "TAG TEAM" or style label over image top
    ctx.font = `700 ${S(12)}px CardFontBold`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = S(4);
    ctx.fillText('TRAINER · FULL ART', S(26), S(36));
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // Text below image
    const faTextY = faImgY + faImgH + S(16);
    ctx.font = `400 ${S(12)}px CardFont`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'left';
    const faEffectEndY = wrapText(trainerData.effect || 'Draw 2 cards.', PAD, faTextY, CW - PAD * 2, S(16));

    ctx.font = `italic ${S(10)}px CardFont`;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    wrapText(
      trainerData.ruleText || 'You may play only 1 Supporter card during your turn.',
      PAD, faEffectEndY + S(6), CW - PAD * 2, S(14)
    );

    // Footer
    ctx.font = `400 ${S(9)}px CardFont`;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'center';
    const dateStr = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
    ctx.fillText(`Illus. AI · ${displayName} · ♥ ${dateStr}`, CW / 2, CH - S(16));

  } else {
    // ── Pokemon EX Card: Colorful border with HP ──
    const exBorderGrad = ctx.createLinearGradient(0, 0, CW, CH);
    exBorderGrad.addColorStop(0, '#e53935');
    exBorderGrad.addColorStop(0.3, '#ff7043');
    exBorderGrad.addColorStop(0.5, '#ffa726');
    exBorderGrad.addColorStop(0.7, '#ff7043');
    exBorderGrad.addColorStop(1, '#e53935');
    rr(0, 0, CW, CH, S(16));
    ctx.fillStyle = exBorderGrad;
    ctx.fill();

    // Inner card
    rr(S(10), S(10), CW - S(20), CH - S(20), S(12));
    ctx.fillStyle = '#fff8e1';
    ctx.fill();

    // Foil shimmer
    const exShimmer = ctx.createLinearGradient(0, 0, CW, CH * 0.5);
    exShimmer.addColorStop(0, 'rgba(255,255,255,0)');
    exShimmer.addColorStop(0.45, 'rgba(255,255,255,0.1)');
    exShimmer.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    exShimmer.addColorStop(0.55, 'rgba(255,255,255,0.1)');
    exShimmer.addColorStop(1, 'rgba(255,255,255,0)');
    rr(S(10), S(10), CW - S(20), CH - S(20), S(12));
    ctx.fillStyle = exShimmer;
    ctx.fill();

    // Top: STAGE label + name + "ex" + HP
    ctx.font = `700 ${S(10)}px CardFontBold`;
    ctx.fillStyle = '#cc0000';
    ctx.textAlign = 'left';
    ctx.fillText('STAGE 1', PAD, S(36));

    ctx.font = `700 ${S(30)}px CardFontBold`;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillText(trainerData.title || 'Trainer', PAD, S(72));

    // "ex" text
    ctx.font = `italic 700 ${S(20)}px CardFontBold`;
    ctx.fillStyle = '#cc0000';
    const nameW = ctx.measureText(trainerData.title || 'Trainer').width;
    ctx.fillText('ex', PAD + nameW + S(8), S(72));

    // HP
    ctx.font = `700 ${S(12)}px CardFontBold`;
    ctx.fillStyle = '#cc0000';
    ctx.textAlign = 'right';
    ctx.fillText('HP', CW - PAD - S(60), S(46));
    ctx.font = `700 ${S(36)}px CardFontBold`;
    ctx.fillText('240', CW - PAD, S(72));
    ctx.textAlign = 'left';

    // Image
    const exImgX = PAD;
    const exImgY = S(86);
    const exImgW = CW - PAD * 2;
    const exImgH = S(340);

    rr(exImgX, exImgY, exImgW, exImgH, S(8));
    ctx.fillStyle = '#e0d5b5';
    ctx.fill();

    try {
      const image = await loadImage(imageBuffer);
      ctx.save();
      rr(exImgX + S(2), exImgY + S(2), exImgW - S(4), exImgH - S(4), S(6));
      ctx.clip();
      const srcRatio = image.width / image.height;
      const dstRatio = (exImgW - S(4)) / (exImgH - S(4));
      let sx = 0, sy = 0, sw = image.width, sh = image.height;
      if (srcRatio > dstRatio) {
        sw = image.height * dstRatio;
        sx = (image.width - sw) / 2;
      } else {
        sh = image.width / dstRatio;
        sy = (image.height - sh) / 2;
      }
      ctx.drawImage(image, sx, sy, sw, sh, exImgX + S(2), exImgY + S(2), exImgW - S(4), exImgH - S(4));
      ctx.restore();
    } catch (error) {
      console.error('Failed to load portrait image:', error.message);
    }

    // Ability section
    const abilityY = exImgY + exImgH + S(12);
    ctx.font = `700 ${S(10)}px CardFontBold`;
    ctx.fillStyle = '#cc0000';
    ctx.fillText('Ability', PAD, abilityY);

    ctx.font = `700 ${S(18)}px CardFontBold`;
    ctx.fillStyle = '#1a1a1a';
    const abilityNameY = abilityY + S(22);
    ctx.fillText(trainerData.title ? `${trainerData.title}'s Power` : 'Special Power', PAD, abilityNameY);

    ctx.font = `400 ${S(11)}px CardFont`;
    ctx.fillStyle = '#555';
    const abilityTextY = abilityNameY + S(16);
    const abilityEndY = wrapText(trainerData.effect || 'Draw 2 cards.', PAD, abilityTextY, CW - PAD * 2, S(16));

    // Separator
    ctx.beginPath();
    ctx.moveTo(PAD, abilityEndY + S(6));
    ctx.lineTo(CW - PAD, abilityEndY + S(6));
    ctx.strokeStyle = '#d0c8a8';
    ctx.lineWidth = SCALE;
    ctx.stroke();

    // Flavor text
    ctx.font = `italic ${S(11)}px CardFont`;
    ctx.fillStyle = '#888';
    const flavorY = abilityEndY + S(22);
    wrapText(trainerData.flavor || 'A special moment.', PAD, flavorY, CW - PAD * 2, S(16));

    // Pokemon ex rule
    ctx.font = `700 ${S(9)}px CardFontBold`;
    ctx.fillStyle = '#cc0000';
    ctx.textAlign = 'left';
    ctx.fillText('Pokémon ex rule', PAD, CH - S(50));
    ctx.font = `400 ${S(9)}px CardFont`;
    ctx.fillStyle = '#888';
    ctx.fillText('When your Pokémon ex is Knocked Out, your opponent takes 2 Prize cards.', PAD, CH - S(36));

    // Footer
    ctx.font = `400 ${S(9)}px CardFont`;
    ctx.fillStyle = '#bbb';
    ctx.textAlign = 'center';
    const dateStr = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
    ctx.fillText(`Illus. AI · ${displayName} · ♥ ${dateStr}`, CW / 2, CH - S(16));
  }

  return canvas.toBuffer('image/jpeg', { quality: 95 });
}

function createApp(options = {}) {
  registerFonts();

  const env = options.env || process.env;
  const app = express();

  app.set('trust proxy', parseTrustProxySetting(env.TRUST_PROXY));
  app.use(applySecurityHeaders);

  // Redirect bare domain → www (SEO + Stripe consistency)
  if ((env.BASE_URL || '').includes('www.')) {
    app.use((req, res, next) => {
      const host = req.get('host') || '';
      if (host && !host.startsWith('www.') && !host.includes('localhost') && !host.includes('127.0.0.1')) {
        return res.redirect(301, `https://www.${host}${req.originalUrl}`);
      }
      next();
    });
  }

  const dataDir = options.dataDir || env.DATA_DIR || path.join(__dirname, 'data');
  const dbPath = options.dbPath || env.DB_PATH || path.join(dataDir, 'credits.db');
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  setupDatabase(db);
  console.log('   DB:       ✅ Ready (SQLite)');

  const statements = createStatements(db);
  const services = createServices({ db, statements, env });
  app.locals.db = db;
  app.locals.services = services;

  app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    if (!services.stripe) {
      return res.status(503).send('Stripe not configured');
    }

    const signature = req.headers['stripe-signature'];
    let event;

    try {
      event = services.stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      console.error('   Webhook signature failed:', error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const result = services.finalizeCheckoutSession(event.data.object);
        if (!result.alreadyProcessed) {
          console.log(
            `   💰 Payment confirmed: +${event.data.object.metadata?.credits || 0} credits for account ${event.data.object.metadata?.accountId}`
          );
        }
      }
      res.json({ received: true });
    } catch (error) {
      console.error('   Webhook processing failed:', error.message);
      res.status(500).json({ error: 'Webhook processing failed.' });
    }
  });

  app.use(express.json({ limit: '6mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.get('/api/account/restore/consume', (req, res) => {
    try {
      const account = services.consumeRestoreToken(req.query.token);
      services.setSessionCookie(res, services.issueSessionForAccount(account.id, req.get('user-agent') || ''));
      res.redirect('/?restored=1');
    } catch (error) {
      const friendly = toFriendlyApiError(error, 'Unable to restore the account.');
      res.status(friendly.status).send(friendly.body.error);
    }
  });

  app.post('/api/account/restore/request', (req, res) => {
    try {
      const email = normalizeEmail(req.body.email);
      if (!isValidEmail(email)) {
        throw createPublicError('Please enter a valid email address.', 400, 'invalid_email');
      }

      const account = services.getAccountByEmail(email);
      if (account) {
        services
          .sendRestoreEmail({ account, req })
          .then(() => null)
          .catch((error) => console.error('Restore email failed:', error.message));
      }

      res.json({ ok: true, message: 'If that email exists, a sign-in link is on the way.' });
    } catch (error) {
      const friendly = toFriendlyApiError(error, 'Unable to send a sign-in link right now.');
      res.status(friendly.status).json(friendly.body);
    }
  });

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    if (req.path === '/api/webhook' || req.path === '/api/account/restore/request' || req.path === '/api/account/restore/consume') {
      return next();
    }
    req.account = services.getOrCreateSessionAccount(req, res);
    next();
  });

  app.get('/api/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/session', (req, res) => {
    res.json({
      account: req.account,
      restoreAvailable: !!services.transporter,
    });
  });

  app.get('/api/credits', (req, res) => {
    res.json(req.account);
  });

  app.post('/api/account', (req, res) => {
    try {
      const account = services.syncAccountProfile(req.account.id, {
        email: req.body.email,
        displayName: req.body.displayName,
        acceptTerms: !!req.body.acceptTerms,
        acceptPrivacy: !!req.body.acceptPrivacy,
        photoParentConsent: !!req.body.photoParentConsent,
      });
      req.account = account;
      res.json(account);
    } catch (error) {
      const friendly = toFriendlyApiError(error, 'Unable to update your account.');
      res.status(friendly.status).json(friendly.body);
    }
  });

  app.post('/api/checkout', async (req, res) => {
    if (!services.stripe) {
      return res.status(503).json({ error: 'Payment system not configured.' });
    }

    try {
      const plan = sanitizeText(req.body.plan, '', 16);
      const planData = PLANS[plan];
      if (!planData) {
        throw createPublicError('Invalid plan.', 400, 'invalid_plan');
      }

      const account = services.syncAccountProfile(req.account.id, {
        email: req.body.email,
        displayName: req.body.displayName,
        acceptTerms: !!req.body.acceptTerms,
        acceptPrivacy: !!req.body.acceptPrivacy,
      });
      services.assertRequiredConsents(account);
      if (!account.email) {
        throw createPublicError('Enter your email before buying credits so they can be restored later.', 400, 'email_required');
      }

      const baseUrl = resolveBaseUrl(req, env);
      const session = await services.stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Pokemon Card Credits - ${planData.label}`,
                description: `${planData.credits} AI Pokemon card generation${planData.credits > 1 ? 's' : ''}`,
              },
              unit_amount: planData.price,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${baseUrl}/?payment=success`,
        cancel_url: `${baseUrl}/?payment=cancelled`,
        client_reference_id: account.id,
        customer_email: account.email,
        metadata: {
          accountId: account.id,
          credits: String(planData.credits),
          plan,
          email: account.email,
        },
      });

      statements.insertCheckoutSession.run(
        session.id,
        account.id,
        account.email,
        plan,
        planData.credits,
        'created'
      );

      res.json({ url: session.url });
    } catch (error) {
      console.error('Checkout error:', error.message);
      const friendly = toFriendlyApiError(error, 'Failed to create the checkout session.');
      res.status(friendly.status).json(friendly.body);
    }
  });

  async function buildCardResponse({ requestId, accountId, mode, imageUrl, cardData, trainerData, displayName, email, fromPhoto }) {
    services.storeGenerationResult(accountId, requestId, mode, imageUrl, cardData || trainerData, displayName);

    let emailStatus = 'not_requested';

    if (email) {
      const rawImgBuffer = await downloadImageBuffer(imageUrl);
      let cardImgBuffer;
      if (fromPhoto && trainerData) {
        cardImgBuffer = await generateTrainerCardImage(rawImgBuffer, trainerData, displayName);
      } else {
        cardImgBuffer = await generateCardImage(rawImgBuffer, cardData, displayName);
      }
      const emailResult = await services.maybeSendCardEmail({
        email,
        displayName,
        pokemonName: (trainerData && trainerData.title) || (cardData && cardData.name) || 'Pokemon Card',
        rawImgBuffer,
        cardImgBuffer,
        fromPhoto,
      });
      emailStatus = emailResult.status;
    }

    return {
      generationId: requestId,
      imageUrl,
      name: (trainerData && trainerData.title) || (cardData && cardData.name),
      cardData: cardData || null,
      trainerData: trainerData || null,
      emailStatus,
    };
  }

  app.post('/api/ai/pokemon-create', async (req, res) => {
    if (!services.aiImage || !services.aiChat) {
      return res.status(503).json({ error: 'AI service not configured.' });
    }

    let reservation = null;

    try {
      const account = services.syncAccountProfile(req.account.id, {
        displayName: req.body.kidName,
      });

      const identityKey = `${account.id}:${req.ip}`;
      if (!services.checkAIRate(identityKey)) {
        throw createPublicError('Too many requests - please wait a minute.', 429, 'rate_limited');
      }

      const color = sanitizeText(req.body.color, '', 16);
      const animal = sanitizeText(req.body.animal, '', 16);
      const power = sanitizeText(req.body.power, '', 16);
      if (!color || !animal || !power) {
        throw createPublicError('Pick a color, animal, and superpower first.', 400, 'missing_fields');
      }

      reservation = services.reserveCredit(account.id, 'design');
      if (!reservation.ok) {
        return res.status(402).json({ error: 'no_credits', remaining: 0 });
      }

      const colorDesc = COLORS_MAP[color] || color;
      const animalDesc = ANIMALS_MAP[animal] || animal;
      const powerDesc = POWERS_MAP[power] || power;

      const prompt = `A cute chibi-style fictional creature inspired by a ${colorDesc} ${animalDesc} with ${powerDesc}. Friendly happy expression, big sparkling eyes, round proportions, pastel colors, clean white background. Digital art style similar to Japanese anime creature design. High quality, vibrant. Original character design only, do not include any existing copyrighted characters.`;

      const imageResp = await services.aiImage.images.generate({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });
      const imageUrl = imageResp.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error('Image generation returned no URL.');
      }

      const cardResp = await services.aiChat.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [
          {
            role: 'system',
            content: `You create Pokemon trading card data. Respond only with valid JSON.
{
  "name":"CuteName",
  "hp":60,
  "type":"Fire",
  "attack1":{"name":"Ember Pounce","damage":20,"desc":"Flip a coin. If heads, the opponent is now Burned."},
  "attack2":{"name":"Flame Whirl","damage":40,"desc":"Discard 1 Energy card."},
  "weakness":"Water",
  "resistance":"Grass",
  "retreatCost":1,
  "flavor":"A playful creature found near volcanoes, always smiling."
}
Rules: name max 12 chars, HP 40-90, damage 10-50, descriptions short and fun, type must match the power.`,
          },
          {
            role: 'user',
            content: `Create card data for a ${colorDesc} ${animalDesc} creature with ${powerDesc}.`,
          },
        ],
        max_completion_tokens: 250,
        response_format: { type: 'json_object' },
      });

      const rawCardData = safeJsonParse(cardResp.choices?.[0]?.message?.content, {});
      const cardData = normalizeCardData(rawCardData);
      const displayName = sanitizeText(req.body.kidName, 'Pokemon Trainer', MAX_NAME_LENGTH);
      const response = await buildCardResponse({
        requestId: reservation.requestId,
        accountId: account.id,
        mode: 'design',
        imageUrl,
        cardData,
        displayName,
        email: '',
        fromPhoto: false,
      });

      services.completeReservedCredit(reservation.requestId);
      const refreshedAccount = services.getAccountById(account.id);

      res.json({
        ...response,
        account: refreshedAccount,
      });
    } catch (error) {
      if (reservation?.requestId) {
        services.refundReservedCredit(reservation.requestId);
      }
      console.error('AI Pokemon Create error:', error.message);
      const friendly = toFriendlyApiError(error, 'Failed to generate your card. No credit was used.');
      res.status(friendly.status).json(friendly.body);
    }
  });

  app.post('/api/ai/pokemon-from-photo', async (req, res) => {
    if (!services.aiImage || !services.aiVision) {
      return res.status(503).json({ error: 'AI service not configured.' });
    }

    let reservation = null;

    try {
      const photo = validatePhotoDataUrl(req.body.photo);
      const account = services.syncAccountProfile(req.account.id, {
        email: req.body.email,
        displayName: req.body.kidName,
        acceptTerms: !!req.body.acceptTerms,
        acceptPrivacy: !!req.body.acceptPrivacy,
        photoParentConsent: !!req.body.photoParentConsent,
      });
      services.assertRequiredConsents(account, { requirePhotoConsent: true });

      const identityKey = `${account.id}:${req.ip}`;
      if (!services.checkAIRate(identityKey)) {
        throw createPublicError('Too many requests - please wait a minute.', 429, 'rate_limited');
      }

      reservation = services.reserveCredit(account.id, 'photo');
      if (!reservation.ok) {
        return res.status(402).json({ error: 'no_credits', remaining: 0 });
      }

      const userTitle = sanitizeText(req.body.cardTitle, '', 30);
      const userStyle = CARD_STYLES.has(req.body.cardStyle) ? req.body.cardStyle : DEFAULT_CARD_STYLE;

      const visionResp = await services.aiVision.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a professional Pokemon trading card artist. Analyze the photo and return only valid JSON.

Your job:
1. Describe the person's appearance in EXTREME DETAIL for an anime portrait artist (hair color, hairstyle, eye color, skin tone, expression, clothing, accessories, pose, background scene if any).
2. Create a DALL-E prompt that will generate an anime/Pokemon art style portrait of THIS SPECIFIC PERSON (not a creature). The portrait should look like official Pokemon Trainer card artwork — expressive, vibrant, Japanese anime style. The person must be clearly recognizable.
3. Generate card text data.

Return:
{
  "appearance": "Brief summary of the person",
  "portrait_prompt": "A detailed DALL-E prompt for an anime-style portrait of this person. Include: exact hair color/style, eye color, skin tone, expression, clothing details, pose. Style: Japanese anime illustration, Pokemon Trainer card artwork style, vibrant colors, clean linework, expressive features, professional digital art quality. Dynamic pose with personality.",
  "title": "${userTitle || 'A suggested card title based on the photo scene or mood'}",
  "effect": "A fun Pokemon card effect text (1-2 sentences) themed around the photo",
  "flavor": "A short flavor text related to the moment captured",
  "cardStyle": "${userStyle}"
}`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Analyze this photo and create a Pokemon Trainer card portrait.${userTitle ? ` The card title should be: ${userTitle}` : ''} Card style: ${userStyle}.` },
              { type: 'image_url', image_url: { url: photo, detail: 'low' } },
            ],
          },
        ],
        max_completion_tokens: 600,
        response_format: { type: 'json_object' },
      });

      const visionData = safeJsonParse(visionResp.choices?.[0]?.message?.content, {});

      const portraitPrompt = sanitizeText(
        visionData.portrait_prompt,
        'A young person illustrated in Japanese anime style, vibrant colors, clean linework, expressive eyes, trading card artwork style, professional digital art quality, dynamic pose, warm lighting. Original character only, do not include any copyrighted characters.',
        1200
      );

      const imageResp = await services.aiImage.images.generate({
        model: 'dall-e-3',
        prompt: portraitPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });
      const imageUrl = imageResp.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error('Image generation returned no URL.');
      }

      const trainerData = normalizeTrainerCardData({
        title: userTitle || visionData.title,
        effect: visionData.effect,
        flavor: visionData.flavor,
        cardStyle: userStyle,
      });
      const displayName = sanitizeText(req.body.kidName, 'Pokemon Trainer', MAX_NAME_LENGTH);
      const response = await buildCardResponse({
        requestId: reservation.requestId,
        accountId: account.id,
        mode: 'photo',
        imageUrl,
        trainerData,
        displayName,
        email: normalizeEmail(req.body.email),
        fromPhoto: true,
      });

      services.completeReservedCredit(reservation.requestId);
      const refreshedAccount = services.getAccountById(account.id);

      res.json({
        ...response,
        appearance: sanitizeText(visionData.appearance, '', 180),
        account: refreshedAccount,
      });
    } catch (error) {
      if (reservation?.requestId) {
        services.refundReservedCredit(reservation.requestId);
      }
      console.error('Photo Pokemon Create error:', error.message);
      const friendly = toFriendlyApiError(error, 'Failed to generate your photo card. No credit was used.');
      res.status(friendly.status).json(friendly.body);
    }
  });

  app.post('/api/card/email', async (req, res) => {
    try {
      const generationId = sanitizeText(req.body.generationId, '', 64);
      if (!generationId) {
        throw createPublicError('Missing card reference.', 400, 'missing_generation');
      }

      const stored = services.getGenerationResult(req.account.id, generationId);
      if (!stored) {
        throw createPublicError('Card not found. Please generate it again first.', 404, 'generation_not_found');
      }

      const account = services.syncAccountProfile(req.account.id, {
        email: req.body.email,
        displayName: req.body.displayName || stored.display_name,
        acceptTerms: !!req.body.acceptTerms,
        acceptPrivacy: !!req.body.acceptPrivacy,
        photoParentConsent: stored.mode === 'photo' ? !!req.body.photoParentConsent : false,
      });
      services.assertRequiredConsents(account, { requirePhotoConsent: stored.mode === 'photo' });
      if (!account.email) {
        throw createPublicError('Enter an email address first.', 400, 'email_required');
      }

      const storedCardPayload = safeJsonParse(stored.card_data_json, {});
      const cardData = stored.mode === 'photo' ? null : normalizeCardData(storedCardPayload);
      const trainerData = stored.mode === 'photo' ? normalizeTrainerCardData(storedCardPayload) : null;
      const displayName = sanitizeText(
        req.body.displayName || stored.display_name || account.displayName,
        'Pokemon Trainer',
        MAX_NAME_LENGTH
      );
      const emailResult = await buildCardResponse({
        requestId: stored.request_id,
        accountId: req.account.id,
        mode: stored.mode,
        imageUrl: stored.image_url,
        cardData,
        trainerData,
        displayName,
        email: account.email,
        fromPhoto: stored.mode === 'photo',
      });

      res.json({
        emailStatus: emailResult.emailStatus,
        generationId: stored.request_id,
        account: services.getAccountById(account.id),
      });
    } catch (error) {
      console.error('Card email error:', error.message);
      const friendly = toFriendlyApiError(error, 'Unable to email this card right now.');
      res.status(friendly.status).json(friendly.body);
    }
  });

  app.use(express.static(path.join(__dirname, 'public')));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

module.exports = {
  createApp,
  normalizeCardData,
  normalizeTrainerCardData,
};

/**
 * ERPNext passwordless desk SSO (mirror CRM LOGIN handoff).
 * 1 Flolah company -> 1 ERPNext Company + SSO User + User Permission(s).
 */
import crypto from 'crypto';
import { getDb } from '../db/schema.js';
import { getUserById } from './users.js';
import {
  assertErpEntitled,
  getBusinessProfile,
  setErpnextBind,
  getErpnextBindRaw,
} from './company-business-profile.js';
// bind secrets via getErpnextBindRaw
import { resolveCompanyDisplayName } from './business-embed.js';
import {
  ensureErpnextCompanyForOwner,
  frappeFetch,
  isErpnextApiConfigured,
  baseUrl as erpBaseUrl,
} from './erpnext-erp.js';

const TOKEN_TTL_MS = 90_000;

function ensureTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS erpnext_sso_tokens (
      token TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      sid TEXT NOT NULL DEFAULT '',
      system_user TEXT NOT NULL DEFAULT '',
      redirect_path TEXT NOT NULL DEFAULT '/app',
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_erpnext_sso_owner ON erpnext_sso_tokens(owner_user_id);
  `);
}

export function isErpnextSsoEnabled() {
  const raw = process.env.ERPNEXT_SSO_ENABLED;
  if (raw === '0' || raw === 'false') return false;
  return isErpnextApiConfigured();
}

function sanitizeEmail(email, ownerUserId) {
  const e = String(email || '').trim().toLowerCase();
  if (e && e.includes('@')) return e;
  const slug = String(ownerUserId || 'ceo').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
  return 'erp-' + slug + '@flolah.local';
}

function genPassword() {
  return 'Fl-' + crypto.randomBytes(12).toString('base64url') + '!a1';
}

async function getOrCreateSsoUser(ownerUserId, companyName, email, fullName) {
  const profile = getBusinessProfile(ownerUserId);
  const bind = getErpnextBindRaw(ownerUserId) || {};
  let pwd = bind.sso_password || null;
  let userId = bind.sso_user || email;

  let exists = false;
  try {
    const listed = await frappeFetch(
      '/api/resource/User?filters=' +
        encodeURIComponent(JSON.stringify([['email', '=', email]])) +
        '&limit_page_length=1&fields=' +
        encodeURIComponent(JSON.stringify(['name', 'email', 'enabled']))
    );
    const row = Array.isArray(listed && listed.data) ? listed.data[0] : null;
    if (row && row.name) {
      exists = true;
      userId = row.name;
    }
  } catch (e) {
    console.warn('[erpnext-sso] user lookup', e && e.message ? e.message : e);
  }

  if (!exists) {
    pwd = genPassword();
    try {
      const createdUser = await frappeFetch('/api/resource/User', {
        method: 'POST',
        body: {
          email,
          first_name: String(fullName || email.split('@')[0] || 'CEO').slice(0, 80),
          send_welcome_email: 0,
          roles: [
            { role: 'System Manager' },
            { role: 'Accounts User' },
            { role: 'Accounts Manager' },
            { role: 'Sales User' },
            { role: 'Projects User' },
          ],
          new_password: pwd,
        },
      });
      userId = (createdUser && createdUser.data && createdUser.data.name) || email;
    } catch (e) {
      console.warn('[erpnext-sso] create user', e && e.message ? e.message : e);
      pwd = genPassword();
      try {
        await frappeFetch('/api/resource/User', {
          method: 'POST',
          body: {
            email,
            first_name: String(fullName || 'CEO').slice(0, 80),
            send_welcome_email: 0,
            roles: [{ role: 'System Manager' }],
            new_password: pwd,
          },
        });
        userId = email;
      } catch (e2) {
        const msg = (e2 && e2.message) || (e && e.message) || 'user create failed';
        throw Object.assign(new Error('ERPNext SSO user ensure failed: ' + msg), { status: 502 });
      }
    }
  } else if (!pwd) {
    pwd = genPassword();
    try {
      await frappeFetch('/api/resource/User/' + encodeURIComponent(userId), {
        method: 'PUT',
        body: { new_password: pwd },
      });
    } catch (e3) {
      console.warn('[erpnext-sso] set password failed', e3 && e3.message ? e3.message : e3);
    }
  }

  if (companyName) {
    try {
      const perms = await frappeFetch(
        '/api/resource/User Permission?filters=' +
          encodeURIComponent(
            JSON.stringify([
              ['user', '=', userId],
              ['allow', '=', 'Company'],
              ['for_value', '=', companyName],
            ])
          ) +
          '&limit_page_length=1'
      );
      const has = Array.isArray(perms && perms.data) && perms.data.length > 0;
      if (!has) {
        await frappeFetch('/api/resource/User Permission', {
          method: 'POST',
          body: {
            user: userId,
            allow: 'Company',
            for_value: companyName,
            apply_to_all_doctypes: 1,
          },
        });
      }
    } catch (e) {
      console.warn('[erpnext-sso] user permission', e && e.message ? e.message : e);
    }
  }

  setErpnextBind(ownerUserId, {
    company_id: profile.erpnext.company_id,
    company_name: profile.erpnext.company_name || companyName,
    bind: Object.assign({}, bind || {}, {
      flolah_owner_user_id: ownerUserId,
      sso_user: userId,
      sso_email: email,
      sso_password: pwd,
      sso_password_set_at: new Date().toISOString(),
      mode: (bind && bind.mode) || 'remote',
    }),
  });

  return { userId: userId, email: email, password: pwd };
}

function parseSidFromResponse(res) {
  let raw = '';
  try {
    if (typeof res.headers.getSetCookie === 'function') {
      raw = res.headers.getSetCookie().join(';');
    } else {
      raw = res.headers.get('set-cookie') || '';
    }
  } catch (e) {
    raw = '';
  }
  const m = /(?:^|[,;]\s*)sid=([^;,\s]+)/.exec(raw);
  return m ? m[1] : null;
}

async function loginForSid(email, password) {
  const root = erpBaseUrl();
  if (!root) throw Object.assign(new Error('ERPNEXT_URL not set'), { status: 503 });
  const siteHost = String(process.env.ERPNEXT_SITE_NAME || 'frontend').trim() || 'frontend';
  const res = await fetch(root + '/api/method/login', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Host: siteHost,
    },
    body: JSON.stringify({ usr: email, pwd: password }),
    signal: AbortSignal.timeout(45000),
    redirect: 'manual',
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.exc)) || ('login HTTP ' + res.status);
    throw Object.assign(new Error(String(msg).slice(0, 300)), { status: 502 });
  }
  const sid = parseSidFromResponse(res);
  if (!sid) {
    throw Object.assign(
      new Error('ERPNext login succeeded but sid cookie missing - check ERPNEXT_URL / site'),
      { status: 502 }
    );
  }
  return { sid: sid, system_user: email, full_name: (data && data.full_name) || email };
}

export async function buildErpSsoHandoff(ownerUserId, opts) {
  opts = opts || {};
  ensureTables();
  const owner = String(ownerUserId || '').trim();
  assertErpEntitled(owner);

  const company = await ensureErpnextCompanyForOwner(owner, {
    displayName: resolveCompanyDisplayName(owner) || undefined,
  });
  const companyName = company.company_name || company.company_id;

  const user = opts.flolahUser || getUserById(owner) || {};
  const email = sanitizeEmail(user.email, owner);
  const fullName = user.name || resolveCompanyDisplayName(owner) || email;

  if (!isErpnextSsoEnabled()) {
    return {
      ok: false,
      mode: 'login_redirect',
      reason: 'erp_sso_disabled_or_api_missing',
      company_id: company.company_id,
      company_name: companyName,
    };
  }

  const ssoUser = await getOrCreateSsoUser(owner, companyName, email, fullName);
  const session = await loginForSid(ssoUser.email, ssoUser.password);

  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const rawRedirect = String(opts.redirectPath || opts.redirect_path || '/app').trim() || '/app';
  const redirectBase = rawRedirect.startsWith('/') ? rawRedirect : '/' + rawRedirect;
  const redirectPath =
    redirectBase +
    (companyName
      ? (redirectBase.includes('?') ? '&' : '?') + 'company=' + encodeURIComponent(companyName)
      : '');

  getDb()
    .prepare(
      'INSERT INTO erpnext_sso_tokens (token, owner_user_id, email, sid, system_user, redirect_path, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(token, owner, email, session.sid, session.system_user, redirectPath, expires);

  const base = String(opts.publicBase || '').trim().replace(/\/+$/, '');
  const handoffPath =
    '/flolah-erp-handoff/?t=' + encodeURIComponent(token) + '&owner=' + encodeURIComponent(owner);
  const logoutPath =
    '/flolah-erp-handoff/?logout=1&wipe=1&owner=' + encodeURIComponent(owner);

  console.info('[erpnext-sso] minted handoff owner=%s company=%s', owner, companyName);

  return {
    ok: true,
    mode: 'session_cookie_sso',
    company_id: company.company_id,
    company_name: companyName,
    token_ttl_ms: TOKEN_TTL_MS,
    iframe_url: base ? base + handoffPath : null,
    open_url: base ? base + handoffPath : null,
    switch_account_url: base ? base + logoutPath + '&next=' + encodeURIComponent(handoffPath) : null,
    consume_path: '/api/business-core/erp-sso-consume',
  };
}

export function consumeErpSsoToken(token) {
  ensureTables();
  const t = String(token || '').trim();
  if (!t) throw Object.assign(new Error('token required'), { status: 400 });
  const db = getDb();
  const row = db.prepare('SELECT * FROM erpnext_sso_tokens WHERE token = ?').get(t);
  if (!row) throw Object.assign(new Error('invalid token'), { status: 404 });
  if (row.used_at) throw Object.assign(new Error('token already used'), { status: 410 });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error('token expired'), { status: 410 });
  }
  db.prepare("UPDATE erpnext_sso_tokens SET used_at = datetime('now') WHERE token = ?").run(t);
  return {
    ok: true,
    sid: row.sid,
    system_user: row.system_user || row.email,
    email: row.email,
    redirect_path: row.redirect_path || '/app',
    owner_user_id: row.owner_user_id,
  };
}

export function buildErpSessionLogoutUrls(ownerUserId) {
  const base = String(process.env.ERPNEXT_EMBED_URL || process.env.ERPNEXT_PUBLIC_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (!base) return [];
  const owner = String(ownerUserId || '').trim();
  return [base + '/flolah-erp-handoff/?logout=1&wipe=1&owner=' + encodeURIComponent(owner || 'x')];
}

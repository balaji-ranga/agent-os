/**
 * Company business profile + CRM/ERP enablement + embed launchers (Phase 2).
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  getBusinessProfile,
  updateBusinessProviders,
  CRM_PROVIDERS,
  ERP_PROVIDERS,
} from '../services/company-business-profile.js';
import { ensureTwentyWorkspaceForCompany } from '../services/twenty-crm.js';
import { syncPrefabCrmAgentsForOwner } from '../services/prefab-crm-agents.js';
import { syncPrefabErpAgentsForOwner } from '../services/prefab-erp-agents.js';
import { ensureErpnextCompanyForOwner } from '../services/erpnext-erp.js';
import {
  getCrmEmbedForOwner,
  getErpEmbedForOwner,
  getBusinessMenuFlags,
  getBusinessCoreStackStatus,
} from '../services/business-embed.js';
import { buildCrmSessionLogoutUrls, consumeTwentySsoBrowserToken } from '../services/twenty-sso.js';
import {
  buildErpSessionLogoutUrls,
  consumeErpSsoToken,
} from '../services/erpnext-sso.js';
import { getUserById } from '../services/users.js';
import { syncFlolahOrgToBusinessCore, listFlolahOrgSnapshot } from '../services/business-core-org-sync.js';

const router = Router();

/**
 * Public ERP SSO consume/apply (handoff before auth).
 * Tokens are short-lived; re-consume is allowed until expires_at (idempotent Set-Cookie).
 * Prefer same-origin nginx /flolah-erp-sso → erp-sso-apply with dual Partitioned + non-Partitioned cookies.
 */
function safeErpRedirectPath(raw) {
  let path = String(raw || '/app').trim() || '/app';
  if (!path.startsWith('/') || path.startsWith('//')) path = '/app';
  return path;
}

function clearErpSessionCookies(res) {
  // Shared host erp.crm.* for all Flolah CEOs — must drop previous CEO session before Set-Cookie.
  // HttpOnly cookies cannot be cleared from handoff JS; only Set-Cookie Max-Age=0 works.
  const names = [
    'sid',
    'system_user',
    'full_name',
    'user_id',
    'user_image',
    'user_lang',
    'company',
    'user_id',
  ];
  for (const n of names) {
    for (const httpOnly of [true, false]) {
      const ho = httpOnly ? 'HttpOnly; ' : '';
      res.append('Set-Cookie', `${n}=; Path=/; ${ho}Secure; SameSite=None; Max-Age=0`);
      res.append(
        'Set-Cookie',
        `${n}=; Path=/; ${ho}Secure; SameSite=None; Max-Age=0; Partitioned`
      );
    }
  }
}

function applyErpSsoCookies(res, out) {
  const sid = String(out.sid || '').trim();
  const userId = String(out.system_user || out.email || '').trim();
  if (!sid) throw Object.assign(new Error('sid missing'), { status: 500 });
  if (!/^[A-Za-z0-9._~+-]+$/.test(sid)) {
    throw Object.assign(new Error('invalid sid format'), { status: 500 });
  }
  clearErpSessionCookies(res);

  // Dual cookies:
  // - Non-partitioned: top-level "Open ERP" tab
  // - Partitioned (CHIPS): Flolah iframe under login.* (same top-level for every CEO)
  const maxAge = 60 * 60 * 12; // 12h
  const pairs = [];
  pairs.push([`sid=${sid}`, true]);
  pairs.push([`system_user=yes`, false]);
  if (userId) {
    const u = encodeURIComponent(userId);
    pairs.push([`user_id=${u}`, false]);
    // full_name for Frappe navbar — use email (never another CEO's display name cache)
    pairs.push([`full_name=${u}`, false]);
  }
  // Prefer bound company when present in redirect_path (?company=)
  const rp = String(out.redirect_path || '');
  const coM = /[?&]company=([^&]+)/.exec(rp);
  if (coM) {
    pairs.push([`company=${coM[1]}`, false]);
  }
  for (const [nv, httpOnly] of pairs) {
    const ho = httpOnly ? 'HttpOnly; ' : '';
    res.append('Set-Cookie', `${nv}; Path=/; ${ho}Secure; SameSite=None; Max-Age=${maxAge}`);
    res.append(
      'Set-Cookie',
      `${nv}; Path=/; ${ho}Secure; SameSite=None; Max-Age=${maxAge}; Partitioned`
    );
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
}

router.post('/erp-sso-consume', (req, res) => {
  try {
    const token = req.body?.token || req.query?.token || req.body?.t;
    const out = consumeErpSsoToken(token);
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/erp-sso-consume', (req, res) => {
  try {
    const token = req.query?.token || req.query?.t;
    const format = String(req.query?.format || '').toLowerCase();
    const out = consumeErpSsoToken(token);
    if (format === 'cookie' || format === 'redirect' || req.query?.redirect != null) {
      applyErpSsoCookies(res, out);
      const dest = safeErpRedirectPath(req.query?.redirect || req.query?.next || out.redirect_path);
      res.redirect(302, dest);
      return;
    }
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

/** Preferred handoff: ERP host nginx proxies here so Set-Cookie is first-party to erp.crm.* */
router.get('/erp-sso-apply', (req, res) => {
  try {
    const token = req.query?.token || req.query?.t;
    const out = consumeErpSsoToken(token);
    applyErpSsoCookies(res, out);
    const dest = safeErpRedirectPath(req.query?.redirect || req.query?.next || out.redirect_path);
    console.info('[business-core] erp-sso-apply ok user=%s next=%s', out.system_user || out.email, dest);
    res.redirect(302, dest);
  } catch (e) {
    console.warn('[business-core] erp-sso-apply failed', e.message);
    res
      .status(e.status || 500)
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"/><title>ERP SSO</title>` +
          `<p style="font-family:system-ui">ERP single sign-on failed: ${String(e.message || e).replace(/[<>]/g, '')}</p>` +
          `<p><a href="/login">ERP login</a></p>`
      );
  }
});

function requestHostname(req) {
  const xf = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const raw = xf || req.hostname || String(req.headers.host || '');
  return String(raw).split(':')[0].trim().toLowerCase();
}

function clearTwentySessionCookies(res) {
  // Few Max-Age=0 lines only — do not emit JWT Set-Cookie (nginx 502: "upstream sent too big header").
  const names = ['tokenPair', 'accessToken', 'refreshToken', 'twenty-session'];
  for (const n of names) {
    res.append('Set-Cookie', `${n}=; Path=/; Secure; SameSite=None; Max-Age=0`);
    res.append('Set-Cookie', `${n}=; Path=/; Secure; SameSite=None; Max-Age=0; Partitioned`);
  }
}

function prepareCrmSsoApplyHeaders(res) {
  clearTwentySessionCookies(res);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
}

function renderCrmSsoApplyHtml(tokenPair, loginToken) {
  const payload = JSON.stringify({
    tokenPair,
    isCookieAuthActiveState: false,
  }).replace(/</g, '\\u003c');
  const next = loginToken
    ? `/verify?loginToken=${encodeURIComponent(String(loginToken))}`
    : '/';
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>CRM</title>` +
    `<style>body{font-family:system-ui,sans-serif;margin:2rem;color:#222}.m{opacity:.6}</style></head>` +
    `<body><p class="m">Signing into CRM…</p><script>` +
    `(function(){var p=${payload};var n=${JSON.stringify(next)};try{` +
    `localStorage.setItem("tokenPairState",JSON.stringify(p.tokenPair));` +
    `localStorage.setItem("tokenPair",JSON.stringify(p.tokenPair));` +
    `localStorage.setItem("isCookieAuthActiveState",JSON.stringify(false));` +
    `}catch(e){}location.replace(n);})();` +
    `</script></body></html>`
  );
}

/**
 * Public CRM SSO apply (handoff before Flolah auth).
 * Nginx on {sub}.crm.* proxies here so localStorage is first-party
 * to the Twenty workspace host. Do not Set-Cookie Twenty JWTs — nginx
 * then returns 502 "upstream sent too big header".
 */
router.get('/crm-sso-apply', (req, res) => {
  try {
    const token = req.query?.token || req.query?.t;
    const out = consumeTwentySsoBrowserToken(token, { hostname: requestHostname(req) });
    prepareCrmSsoApplyHeaders(res);
    console.info(
      '[business-core] crm-sso-apply ok owner=%s host=%s',
      String(out.owner_user_id || '').slice(0, 32),
      requestHostname(req)
    );
    res.status(200).type('html').send(renderCrmSsoApplyHtml(out.tokenPair, out.loginToken));
  } catch (e) {
    console.warn('[business-core] crm-sso-apply failed', e.message);
    res
      .status(e.status || 500)
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"/><title>CRM SSO</title>` +
          `<p style="font-family:system-ui">CRM single sign-on failed: ${String(e.message || e).replace(/[<>]/g, '')}</p>` +
          `<p>Open CRM from the Flolah menu. Do not use Twenty email/password — that form is not Flolah SSO.</p>`
      );
  }
});

router.use(requireAuth, requireCeoOrAdmin);

function ownerOf(req) {
  return resolveAuthenticatedCeoUserId(req, req.body || req.query || {});
}

/** Desk SSO identity: employee email when a sub-user opens CRM/ERP; CEO otherwise. Company bind stays on owner. */
function embedActorUser(req, ownerUserId) {
  const ownerProfile = getUserById(ownerUserId);
  const actor = req.authUser || {};
  const useActor = actor.role === 'org_user' && actor.email;
  return {
    id: useActor ? actor.id : ownerUserId,
    email: useActor ? actor.email : ownerProfile?.email || actor.email || null,
    name: useActor ? actor.name : ownerProfile?.name || actor.name || null,
    impersonation: actor.impersonation || null,
  };
}

router.get('/profile', (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    res.json({
      profile: getBusinessProfile(ownerUserId),
      menus: getBusinessMenuFlags(ownerUserId),
      options: {
        crm_providers: [...CRM_PROVIDERS],
        erp_providers: [...ERP_PROVIDERS],
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Lightweight flags for nav (auth + owner scope). */
router.get('/menus', (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    res.json(getBusinessMenuFlags(ownerUserId));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/business-core/crm-logout-targets — CRM host wipe URLs for Flolah logout.
 * Returns same-origin static handoff pages that clear Twenty browser storage.
 * Must be called while still authenticated (before session revoke).
 */
router.get('/crm-logout-targets', (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    const urls = buildCrmSessionLogoutUrls(ownerUserId);
    console.info(
      '[business-core] crm-logout-targets owner=%s count=%s',
      ownerUserId || '?',
      urls.length
    );
    res.json({ ok: true, urls });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/business-core/erp-logout-targets — wipe ERP desk session on Flolah logout.
 */
router.get('/erp-logout-targets', (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    const urls = buildErpSessionLogoutUrls(ownerUserId);
    res.json({ ok: true, urls });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/business-core/embed/crm — Twenty iframe config (platform CRM only).
 * Passwordless SSO mints for the **signed-in person** (CEO root or employee email) in the
 * company Twenty workspace. Workspace bind stays on the CEO owner.
 */
router.get('/embed/crm', async (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    const flolahUser = embedActorUser(req, ownerUserId);
    const embed = await getCrmEmbedForOwner(ownerUserId, { flolahUser });
    try {
      const parsed = embed.iframe_url ? new URL(embed.iframe_url) : null;
      const hasLt = Boolean(
        parsed && (parsed.searchParams.has('lt') || /[#&]lt=/.test(embed.iframe_url || ''))
      );
      console.info(
        '[business-core] embed/crm owner=%s mode=%s host=%s has_lt=%s ok=%s',
        String(ownerUserId || '').slice(0, 32),
        embed.sso?.mode || '?',
        parsed?.hostname || 'none',
        hasLt,
        embed.sso?.ok !== false
      );
    } catch {
      /* ignore url parse */
    }
    let stack_status = null;
    try {
      stack_status = (await getBusinessCoreStackStatus()).crm;
    } catch (e) {
      console.warn('[business-core] stack probe crm', e?.message || e);
    }
    res.json({
      ...embed,
      stack_status,
      sso: {
        ...(embed.sso || {}),
        flolah_email_domain: flolahUser.email ? String(flolahUser.email).replace(/^[^@]+/, '***') : null,
        via_impersonation: Boolean(req.authUser?.impersonation),
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/business-core/embed/erp — ERPNext iframe config (platform ERP only).
 * Passwordless SSO handoff when ERPNEXT API keys + ERPNEXT_SSO_ENABLED.
 */
router.get('/embed/erp', async (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    const flolahUser = embedActorUser(req, ownerUserId);
    const embed = await getErpEmbedForOwner(ownerUserId, { flolahUser });
    let stack_status = null;
    try {
      stack_status = (await getBusinessCoreStackStatus()).erp;
    } catch (e) {
      console.warn('[business-core] stack probe erp', e?.message || e);
    }
    res.json({
      ...embed,
      stack_status,
      sso: {
        ...(embed.sso || {}),
        flolah_email_domain: flolahUser.email
          ? String(flolahUser.email).replace(/^[^@]+/, '***')
          : null,
        via_impersonation: Boolean(req.authUser?.impersonation),
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** GET /api/business-core/stack-status — Twenty/ERPNext reachability (CEO scope not required for secrets; auth only). */
router.get('/stack-status', async (req, res) => {
  try {
    ownerOf(req);
    res.json({ ok: true, ...(await getBusinessCoreStackStatus()) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** GET /api/business-core/org-snapshot — departments + AI employees for sync review. */
router.get('/org-snapshot', (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    res.json({ ok: true, ...listFlolahOrgSnapshot(ownerUserId) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * POST /api/business-core/sync-org
 * Body: { targets?: ['crm'|'erp'] } — defaults to all enabled platform providers.
 * Pushes Flolah departments + AI employees into Twenty / ERPNext (owner-scoped).
 */
router.post('/sync-org', async (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : undefined;
    const result = await syncFlolahOrgToBusinessCore(ownerUserId, { targets });
    res.json(result);
  } catch (e) {
    console.warn('[business-core] sync-org', e?.message || e);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

/**
 * PATCH body: { crm_provider?, erp_provider?, provision?: true }
 * Prefab CRM/ERP AI employees are granted to the org only when
 * CRM = Twenty or ERPNext / ERP = ERPNext. Selecting none (or a non-platform vendor)
 * removes those prefab agents from the org (user_agents disabled).
 */
router.patch('/profile', async (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    const body = req.body || {};
    let profile = updateBusinessProviders(ownerUserId, {
      crm_provider: body.crm_provider,
      erp_provider: body.erp_provider,
    });

    const wantProvision = body.provision !== false;
    let twenty = null;
    let prefab = null;
    let erpnext = null;
    let prefabErp = null;

    const user = getUserById(ownerUserId);
    const displayName = user?.business_name || user?.name || undefined;

    // Sync org membership regardless of workspace provision flag
    if (wantProvision) {
      if (profile.crm_provider === 'twenty') {
        try {
          twenty = await ensureTwentyWorkspaceForCompany(ownerUserId, {
            displayName: profile.twenty.workspace_name || displayName,
          });
        } catch (e) {
          console.warn('[business-core] twenty workspace provision', e?.message || e);
          twenty = { ok: false, error: e.message, status: e.status || 500 };
        }
      }
      prefab = await syncPrefabCrmAgentsForOwner(ownerUserId);

      if (profile.erp_provider === 'erpnext' || profile.crm_provider === 'erpnext') {
        erpnext = await ensureErpnextCompanyForOwner(ownerUserId, {
          displayName: displayName || profile.erpnext.company_name,
        });
      }
      prefabErp = await syncPrefabErpAgentsForOwner(ownerUserId);
      profile = getBusinessProfile(ownerUserId);
    } else {
      // Still enforce "only platform" org membership when providers change without provision
      prefab = await syncPrefabCrmAgentsForOwner(ownerUserId);
      prefabErp = await syncPrefabErpAgentsForOwner(ownerUserId);
      profile = getBusinessProfile(ownerUserId);
    }

    res.json({
      profile,
      menus: getBusinessMenuFlags(ownerUserId),
      twenty,
      prefab,
      erpnext,
      prefab_erp: prefabErp,
      embed: {
        crm: profile.platform_crm ? await getCrmEmbedForOwner(ownerUserId, { flolahUser: req.authUser }) : null,
        erp: profile.platform_erp
          ? await getErpEmbedForOwner(ownerUserId, { flolahUser: req.authUser })
          : null,
      },
    });
  } catch (e) {
    console.warn('[business-core] patch profile', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;

/**
 * Clear Twenty CRM browser storage on CRM host origins.
 * Must run while still on Flolah (hidden iframes to /flolah-handoff/?logout=1).
 * Origins may be apex crm.<apex> and company {sub}.crm.<apex>.
 */

const STORAGE_KEY = 'flolah_crm_session_origins';
const MAX_ORIGINS = 8;

function asOrigin(urlOrOrigin) {
  try {
    if (!urlOrOrigin) return '';
    const u = new URL(String(urlOrOrigin), window.location.origin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

/** Remember CRM hosts opened in this browser (survives profile for logout wipe). */
export function rememberCrmSessionOrigin(urlOrOrigin) {
  const origin = asOrigin(urlOrOrigin);
  if (!origin || typeof localStorage === 'undefined') return;
  try {
    const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const list = Array.isArray(prev) ? prev.map(asOrigin).filter(Boolean) : [];
    const next = [origin, ...list.filter((o) => o !== origin)].slice(0, MAX_ORIGINS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function getRememberedCrmLogoutUrls() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(list)) return [];
    return list
      .map(asOrigin)
      .filter(Boolean)
      .map((origin) => `${origin}/flolah-handoff/?owner=_logout&wipe=1&logout=1&next=%2F`);
  } catch {
    return [];
  }
}

function loadIframe(url, timeoutMs) {
  return new Promise((resolve) => {
    if (!url || typeof document === 'undefined') {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        iframe.remove();
      } catch {
        /* ignore */
      }
      resolve();
    };
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText =
      'position:fixed;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;pointer-events:none';
    iframe.referrerPolicy = 'no-referrer';
    iframe.onload = () => setTimeout(finish, 200);
    iframe.onerror = finish;
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(finish, timeoutMs);
  });
}

/**
 * Wipe CRM sessions on known hosts. Call before clearing Flolah auth token.
 * @param {string[]} [apiUrls] from GET /api/business-core/crm-logout-targets
 */
export async function clearCrmBrowserSessions(apiUrls = []) {
  const fromApi = (Array.isArray(apiUrls) ? apiUrls : []).filter(
    (u) => typeof u === 'string' && /^https?:\/\//i.test(u)
  );
  const remembered = getRememberedCrmLogoutUrls();
  const urls = [...new Set([...fromApi, ...remembered])];
  if (!urls.length) return { wiped: 0, urls: [] };

  await Promise.all(urls.map((u) => loadIframe(u, 2500)));
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return { wiped: urls.length, urls };
}
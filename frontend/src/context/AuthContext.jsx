import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setAuthToken } from '../api';
import { clearCrmBrowserSessions } from '../lib/crmSessionCleanup';
import {
  setPreferredDisplayTimeZone,
  setPlatformDefaultTimeZone,
  resolveDisplayTimeZone,
} from '../utils/displayTimezone.js';

const AuthContext = createContext(null);

const TOKEN_KEY = 'agent-os-auth-token';
const IMPERSONATOR_TOKEN_KEY = 'agent-os-impersonator-token';

/** Fetch CRM wipe URLs then load hidden handoff iframes (cross-origin Twenty storage). */
async function wipeCrmSessionsIfPossible() {
  let urls = [];
  try {
    const data = await api.businessCoreCrmLogoutTargets();
    urls = data?.urls || [];
  } catch {
    /* not entitled / offline — still try remembered origins */
  }
  try {
    await clearCrmBrowserSessions(urls);
  } catch {
    /* best-effort */
  }
}

/** Wipe ERPNext desk session iframes (best-effort). */
async function wipeErpSessionsIfPossible() {
  let urls = [];
  try {
    const data = await api.businessCoreErpLogoutTargets();
    urls = data?.urls || [];
  } catch {
    /* ignore */
  }
  if (!urls.length) return;
  await Promise.all(
    urls.map(
      (u) =>
        new Promise((resolve) => {
          const iframe = document.createElement('iframe');
          iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0';
          iframe.src = u;
          const done = () => {
            try {
              iframe.remove();
            } catch {
              /* */
            }
            resolve();
          };
          iframe.onload = done;
          iframe.onerror = done;
          document.body.appendChild(iframe);
          setTimeout(done, 2500);
        })
    )
  );
}

function applyDisplayTimezonesFromMe(data) {
  setPlatformDefaultTimeZone(data?.platform_timezone || null);
  setPreferredDisplayTimeZone(data?.user?.display_timezone || null);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [agents, setAgents] = useState([]);
  const [dataCeoUserId, setDataCeoUserId] = useState(null);
  const [usesPlatformDb, setUsesPlatformDb] = useState(false);
  const [impersonation, setImpersonation] = useState(null);
  const [platformTimezone, setPlatformTimezone] = useState(null);
  const [loading, setLoading] = useState(true);

  const applyMe = useCallback((data) => {
    setUser(data.user);
    setAgents(data.agents || []);
    setDataCeoUserId(data.data_ceo_user_id || null);
    setUsesPlatformDb(!!data.uses_platform_db);
    setImpersonation(data.impersonation || data.user?.impersonation || null);
    setPlatformTimezone(data.platform_timezone || null);
    applyDisplayTimezonesFromMe(data);
  }, []);

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setUser(null);
      setAgents([]);
      setDataCeoUserId(null);
      setUsesPlatformDb(false);
      setImpersonation(null);
      setPlatformTimezone(null);
      setPreferredDisplayTimeZone(null);
      setPlatformDefaultTimeZone(null);
      setLoading(false);
      return;
    }
    setAuthToken(token);
    try {
      const data = await api.authMe();
      applyMe(data);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(IMPERSONATOR_TOKEN_KEY);
      setAuthToken(null);
      setUser(null);
      setAgents([]);
      setDataCeoUserId(null);
      setUsesPlatformDb(false);
      setImpersonation(null);
      setPlatformTimezone(null);
      setPreferredDisplayTimeZone(null);
      setPlatformDefaultTimeZone(null);
    } finally {
      setLoading(false);
    }
  }, [applyMe]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const applySession = useCallback(
    async (data) => {
      if (!data?.session?.token) {
        throw new Error(data?.message || data?.error || 'No session returned');
      }
      localStorage.removeItem(IMPERSONATOR_TOKEN_KEY);
      localStorage.setItem(TOKEN_KEY, data.session.token);
      setAuthToken(data.session.token);
      setUser(data.user);
      if (data.user?.role === 'ceo' || data.user?.role === 'org_user') {
        const me = await api.authMe();
        applyMe(me);
        return me.user;
      }
      setImpersonation(null);
      return data.user;
    },
    [applyMe]
  );

  const login = async (email, password, admin = false) => {
    const data = admin ? await api.authAdminLogin({ email, password }) : await api.authLogin({ email, password });
    if (data.mfa_required || data.mfa_setup_required) {
      return data; // caller shows OTP / setup UI
    }
    return applySession(data);
  };

  const completeMfa = async ({ mfa_token, code }) => {
    const data = await api.authMfaVerify({ mfa_token, code });
    return applySession(data);
  };

  const resendMfa = async (mfa_token) => api.authMfaResend({ mfa_token });

  const register = async (body) => {
    const data = await api.authRegister(body);
    if (data.mfa_required || data.mfa_setup_required) {
      return data;
    }
    return applySession(data);
  };

  const impersonateUser = async (userId) => {
    const currentToken = localStorage.getItem(TOKEN_KEY);
    if (!currentToken) throw new Error('Admin session required');
    const data = await api.adminImpersonateUser(userId);
    localStorage.setItem(IMPERSONATOR_TOKEN_KEY, currentToken);
    localStorage.setItem(TOKEN_KEY, data.session.token);
    setAuthToken(data.session.token);
    const me = await api.authMe();
    applyMe(me);
    return me.user;
  };

  const exitImpersonation = async () => {
    // Clear CEO CRM session opened during view-as before restoring admin.
    await wipeCrmSessionsIfPossible();
    await wipeErpSessionsIfPossible();
    try {
      await api.authExitImpersonation();
    } catch (_) {
      /* session may already be invalid */
    }
    const adminToken = localStorage.getItem(IMPERSONATOR_TOKEN_KEY);
    localStorage.removeItem(IMPERSONATOR_TOKEN_KEY);
    if (adminToken) {
      localStorage.setItem(TOKEN_KEY, adminToken);
      setAuthToken(adminToken);
      setLoading(true);
      await loadMe();
      window.location.href = '/admin';
      return;
    }
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
    setAgents([]);
    setImpersonation(null);
    window.location.href = '/login';
  };

  const logout = async () => {
    if (localStorage.getItem(IMPERSONATOR_TOKEN_KEY)) {
      await exitImpersonation();
      return;
    }
    // Wipe Twenty CRM browser session on CRM hosts (not same-origin as Flolah).
    // Must run while Flolah token still valid so logout-targets can resolve company host.
    await wipeCrmSessionsIfPossible();
    await wipeErpSessionsIfPossible();
    try {
      await api.authLogout();
    } catch (_) {}
    // Clear Path=/opensearch and Path=/openconnector HttpOnly cookies (API logout Set-Cookie
    // can miss if Secure/Path mismatched). Same-origin fetch includes those cookies.
    await Promise.all([
      fetch('/opensearch/?os_logout=1', { credentials: 'include', cache: 'no-store' }).catch(() => {}),
      fetch('/openconnector/?oc_logout=1', { credentials: 'include', cache: 'no-store' }).catch(() => {}),
    ]);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(IMPERSONATOR_TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
    setAgents([]);
    setDataCeoUserId(null);
    setUsesPlatformDb(false);
    setImpersonation(null);
    setPlatformTimezone(null);
    setPreferredDisplayTimeZone(null);
    setPlatformDefaultTimeZone(null);
  };

  const displayTimezone = resolveDisplayTimeZone();

  return (
    <AuthContext.Provider
      value={{
        user,
        agents,
        dataCeoUserId,
        usesPlatformDb,
        impersonation,
        platformTimezone,
        /** Effective IANA zone for all UI datetimes (user profile → platform → browser). */
        displayTimezone,
        loading,
        login,
        completeMfa,
        resendMfa,
        register,
        logout,
        impersonateUser,
        exitImpersonation,
        reload: loadMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function RequireAuth({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: '2rem' }}>Loading…</div>;
  if (!user) {
    window.location.href = '/login';
    return null;
  }
  if (role && user.role !== role) {
    return <div style={{ padding: '2rem', color: '#f87171' }}>Access denied — {role} role required.</div>;
  }
  return children;
}

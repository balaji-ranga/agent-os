import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from './AuthContext';

const STORAGE_KEY = 'agent-os-privileged-session';

const PrivilegedSessionContext = createContext(null);

function readStored() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.expires_at) return null;
    if (new Date(parsed.expires_at).getTime() <= Date.now()) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(session) {
  if (!session?.token) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function PrivilegedSessionProvider({ children }) {
  const { user } = useAuth() || {};
  const [session, setSession] = useState(() => readStored());
  const [meta, setMeta] = useState(null);

  const clear = useCallback(() => {
    writeStored(null);
    setSession(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'admin') clear();
  }, [user, clear]);

  const remainingMs = session?.expires_at
    ? Math.max(0, new Date(session.expires_at).getTime() - Date.now())
    : 0;
  const unlocked = remainingMs > 0;

  useEffect(() => {
    if (!unlocked) return undefined;
    const ms = remainingMs;
    const t = setTimeout(() => clear(), Math.min(ms + 50, 2_147_000_000));
    return () => clearTimeout(t);
  }, [unlocked, remainingMs, clear, session?.expires_at]);

  const refreshMeta = useCallback(async () => {
    if (!user || user.role !== 'admin') return null;
    try {
      const st = await api.adminPrivilegedSessionStatus(session?.token);
      setMeta(st);
      if (st?.unlocked && st.expires_at && session?.token) {
        const next = { ...session, expires_at: st.expires_at, purpose: st.purpose };
        writeStored(next);
        setSession(next);
      } else if (session && !st?.unlocked) {
        clear();
      }
      return st;
    } catch {
      return null;
    }
  }, [user, session, clear]);

  const challenge = useCallback(
    async (purpose) => api.adminPrivilegedSessionChallenge(purpose),
    []
  );

  const verify = useCallback(async ({ code, mfaToken, purpose }) => {
    const out = await api.adminPrivilegedSessionVerify({ code, mfa_token: mfaToken, purpose });
    const next = {
      token: out.privileged_session_token || out.stepup_token,
      expires_at: out.expires_at,
      purpose: out.purpose,
      ttl_ms: out.ttl_ms,
    };
    writeStored(next);
    setSession(next);
    setMeta((m) => ({ ...(m || {}), unlocked: true, expires_at: next.expires_at, purpose: next.purpose }));
    return next;
  }, []);

  const value = useMemo(
    () => ({
      token: unlocked ? session?.token : null,
      expiresAt: unlocked ? session?.expires_at : null,
      purpose: session?.purpose || null,
      remainingMs: unlocked ? remainingMs : 0,
      unlocked,
      meta,
      refreshMeta,
      challenge,
      verify,
      clear,
    }),
    [session, unlocked, remainingMs, meta, refreshMeta, challenge, verify, clear]
  );

  return <PrivilegedSessionContext.Provider value={value}>{children}</PrivilegedSessionContext.Provider>;
}

export function usePrivilegedSession() {
  const ctx = useContext(PrivilegedSessionContext);
  if (!ctx) {
    throw new Error('usePrivilegedSession must be used within PrivilegedSessionProvider');
  }
  return ctx;
}

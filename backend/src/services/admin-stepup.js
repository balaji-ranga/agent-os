/**
 * Backward-compatible wrappers around the generic privileged-session manager.
 * Docker tool onboarding and TLS cert routes keep calling these names.
 */
import {
  PRIVILEGED_PURPOSE,
  ensurePrivilegedSessionTable,
  issuePrivilegedSession,
  requirePrivilegedSession,
  privilegedSessionTtlMs,
} from './admin-privileged-session.js';

const PURPOSE = PRIVILEGED_PURPOSE.DOCKER_TOOLS;

export function ensureAdminStepupTable() {
  ensurePrivilegedSessionTable();
}

/**
 * Verify admin OTP and issue a step-up token for privileged ops.
 */
export async function issueAdminStepup({ userId, role, impersonation, code, purpose = PURPOSE, mfaToken }) {
  const out = await issuePrivilegedSession({
    userId,
    role,
    impersonation,
    code,
    mfaToken,
    purpose,
  });
  console.info(
    `[admin-stepup] issued purpose=${out.purpose} user=${userId} ttlMs=${out.ttl_ms}`
  );
  return out;
}

/**
 * Consume/validate step-up token (does not delete — reusable until expiry within the window).
 */
export function requireAdminStepup({ userId, role, impersonation, token, purpose = PURPOSE }) {
  return requirePrivilegedSession({
    userId,
    role,
    impersonation,
    token,
    purpose,
    acceptShared: true,
  });
}

export { privilegedSessionTtlMs };

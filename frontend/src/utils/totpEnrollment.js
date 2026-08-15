/**
 * Ensure TOTP first-login/register payload includes secret + otpauth URL.
 * Login/register may already return them; otherwise fetch setup-challenge.
 */
export async function resolveTotpEnrollment(result, setupChallenge) {
  if (!result?.mfa_setup_required) return result;
  if (result.secret && result.otpauth_url) return result;
  if (!result.mfa_token || typeof setupChallenge !== 'function') return result;
  const setup = await setupChallenge({ mfa_token: result.mfa_token });
  return { ...result, ...setup };
}

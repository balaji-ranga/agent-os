const MIN_PASSWORD_LENGTH = Number(process.env.AGENT_OS_PASSWORD_MIN_LENGTH || 12);
const MAX_PASSWORD_LENGTH = 256;

export function assertStrongPassword(password, field = 'Password') {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    const error = new Error(`${field} must be at least ${MIN_PASSWORD_LENGTH} characters`);
    error.status = 400;
    throw error;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    const error = new Error(`${field} must be at most ${MAX_PASSWORD_LENGTH} characters`);
    error.status = 400;
    throw error;
  }
  return value;
}

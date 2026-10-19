// Trusted deployment defaults, not website/user-controlled settings. Each outer
// budget leaves time for the inner layer to return a fail-closed review result.
export const MODEL_GATEWAY_TIMEOUT_MS = 180_000;
export const MODEL_CLIENT_TIMEOUT_MS = 190_000;
export const MODEL_SESSION_TIMEOUT_MS = 195_000;
export const WIDGET_REQUEST_TIMEOUT_MS = 200_000;
const modelRoutes = new Set(['/v1/plan','/v1/recipe/plan','/v1/ask','/v1/tasks/plan','/v1/tasks/summary','/v1/tasks/command-plan']);
export const sessionRequestTimeoutMs = path => path === '/v1/sessions' ? 8_000 : modelRoutes.has(path) ? MODEL_SESSION_TIMEOUT_MS : 55_000;

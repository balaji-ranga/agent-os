/**
 * AgentSystem runtime tools that must stay on agents.list[].tools.allow.
 * When tools.allow is set, the gateway treats it as a closed allowlist and strips
 * defaults (sessions_*, read/write, …). Empty payloads then surface as
 * "No response from AgentSystem." — especially for COO chats that inject
 * sessions_history / MEMORY.md instructions.
 */
export const NATIVE_OPENCLAW_TOOLS = ['browser', 'image', 'cron', 'cron_add'];

/** Always merge into per-agent tools.allow (content grants alone are not enough). */
export const ESSENTIAL_OPENCLAW_RUNTIME_TOOLS = [
  'read',
  'write',
  'edit',
  'apply_patch',
  'exec',
  'process',
  'sessions_history',
  'sessions_list',
  'sessions_send',
  'sessions_spawn',
  'sessions_yield',
  'session_status',
  'agents_list',
  'subagents',
  'message',
];

export function mergeOpenClawAllowList(existingAllow = [], contentGrants = [], opts = {}) {
  const dropImage = opts.dropImage !== false;
  const dropBrowser = opts.dropBrowser === true;
  const merged = [
    ...new Set([
      ...(existingAllow || []).map((t) => String(t)),
      ...(contentGrants || []).map((t) => String(t)),
      ...NATIVE_OPENCLAW_TOOLS,
      ...ESSENTIAL_OPENCLAW_RUNTIME_TOOLS,
    ]),
  ].filter((t) => {
    if (!t) return false;
    if (dropImage && t === 'image') return false;
    if (dropBrowser && t === 'browser') return false;
    return true;
  });
  return merged;
}

/** True when the gateway substituted its empty-payload placeholder. */
export function isOpenClawEmptyResponse(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  return /^no response from (openclaw|agentsystem)\.?$/i.test(t);
}

/** Canonical empty-reply string stored in chat after a failed gateway turn. */
export const AGENT_SYSTEM_EMPTY_REPLY = 'No response from AgentSystem.';

/** User-facing copy: never expose the OpenClaw product name. */
export function toAgentSystemUserMessage(text) {
  const s = String(text || '');
  if (isOpenClawEmptyResponse(s) && s.trim()) return AGENT_SYSTEM_EMPTY_REPLY;
  return s.replace(/\bOpenClaw\b/g, 'AgentSystem');
}

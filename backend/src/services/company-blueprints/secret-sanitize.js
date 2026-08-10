/**
 * Strip live API keys / tokens from company blueprint payloads and workflow graphs.
 * Keep vault *Ref bindings and {{template}} placeholders.
 */
/**
 * True if this property name usually holds a secret (not *Ref / budget / maxTokens).
 */
export function isSecretishBlueprintKey(key) {
  const k = String(key || '');
  if (!k) return false;
  // Keep vault/ref bindings and non-secret token metrics
  if (
    /(?:api[_-]?key_?ref|auth[_-]?bearer_?ref|key_?ref|keyref|token_budget|token_count|max_?tokens|monthly_token|template_key|chat_trigger)/i.test(
      k
    )
  ) {
    return false;
  }
  return /(?:api[_-]?key|bearer|password|passwd|secret|access_token|refresh_token|client_secret|private[_-]?key|authorization|local_bridge_token|bridge_token|runtime_token|x[-_]?agent[-_]?os[-_]?internal|brain_api_key|brave_api_key|apikey)/i.test(
    k
  );
}

/** Template / vault placeholders are allowed; bare credentials are not. */
export function isAllowlistedSecretPlaceholder(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  if (/^\{\{[^}]+\}\}$/.test(s)) return true;
  if (/^\{\{[\s\S]+\}\}$/.test(s) && !/sk-[a-zA-Z0-9]{10,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9\-._~+/]{12,}/i.test(s)) {
    return true;
  }
  if (/^\$keyRef$/i.test(s) || s === '$keyRef') return true;
  return false;
}

/**
 * Heuristic: string looks like a live credential (OpenAI/DeepSeek/JWT/hex token/etc.).
 */
export function looksLikeLiveSecret(value) {
  if (value == null) return false;
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!s || s.length < 8) return false;
  if (isAllowlistedSecretPlaceholder(s)) return false;
  if (/^sk-proj-[A-Za-z0-9_\-]{20,}/.test(s)) return true;
  if (/^sk-[a-zA-Z0-9]{16,}/.test(s)) return true;
  if (/^AKIA[0-9A-Z]{16}/.test(s)) return true;
  if (/^ghp_[A-Za-z0-9]{20,}/.test(s)) return true;
  if (/^xox[baprs]-/i.test(s)) return true;
  if (/^Bearer\s+[A-Za-z0-9\-._~+/]+=*$/i.test(s)) return true;
  if (/^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(s)) return true;
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s)) return true;
  // long hex / base64-ish tokens (bridge tokens, random secrets)
  if (/^[a-f0-9]{32,}$/i.test(s)) return true;
  if (/^[A-Za-z0-9+/_=-]{40,}$/.test(s) && /[0-9]/.test(s) && /[A-Za-z]/.test(s)) return true;
  return false;
}

function scrubSecretSubstrings(text) {
  let s = String(text);
  s = s.replace(/sk-proj-[A-Za-z0-9_\-]{20,}/g, '');
  s = s.replace(/sk-[a-zA-Z0-9]{16,}/g, '');
  s = s.replace(/AKIA[0-9A-Z]{16}/g, '');
  s = s.replace(/ghp_[A-Za-z0-9]{20,}/g, '');
  s = s.replace(/xox[baprs]-[A-Za-z0-9-]{10,}/gi, '');
  s = s.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer ');
  s = s.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '');
  s = s.replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '');
  return s;
}

/**
 * Deep-scrub secrets from blueprint payloads (workflow graphs, variables, nested JSON).
 * Keeps apiKeyRef / vault key refs and {{template}} placeholders.
 * Mutates in place and returns the same tree.
 */
export function sanitizeBlueprintSecrets(value, stats = { cleared: 0, scrubbed: 0 }) {
  if (value == null) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = sanitizeBlueprintSecrets(value[i], stats);
    }
    return value;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (isSecretishBlueprintKey(k)) {
        if (typeof v === 'string') {
          if (!isAllowlistedSecretPlaceholder(v)) {
            value[k] = '';
            stats.cleared += 1;
          }
        } else if (v != null && typeof v !== 'object') {
          value[k] = null;
          stats.cleared += 1;
        } else {
          value[k] = sanitizeBlueprintSecrets(v, stats);
        }
        continue;
      }
      if (typeof v === 'string') {
        if (looksLikeLiveSecret(v)) {
          value[k] = '';
          stats.cleared += 1;
        } else if (/sk-[a-zA-Z0-9]{10,}|sk-proj-|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9\-._~+/]{16,}|eyJ[A-Za-z0-9_-]{10,}\./i.test(v)) {
          const next = scrubSecretSubstrings(v);
          if (next !== v) {
            value[k] = next;
            stats.scrubbed += 1;
          }
        }
      } else {
        value[k] = sanitizeBlueprintSecrets(v, stats);
      }
    }
    return value;
  }
  if (typeof value === 'string' && looksLikeLiveSecret(value)) {
    stats.cleared += 1;
    return '';
  }
  return value;
}


/** Prompt-size telemetry without logging prompt content or secrets. */
const lastWarnings = new Map();

export function summarizeLlmContext(messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  const byRole = {};
  let chars = 0;
  let largestMessageChars = 0;
  for (const message of rows) {
    const content = typeof message?.content === 'string'
      ? message.content
      : JSON.stringify(message?.content ?? '');
    const length = content.length;
    chars += length;
    largestMessageChars = Math.max(largestMessageChars, length);
    const role = String(message?.role || 'unknown');
    byRole[role] = (byRole[role] || 0) + length;
  }
  return {
    messages: rows.length,
    chars,
    estimated_tokens: chars ? Math.ceil(chars / 4) : 0,
    largest_message_chars: largestMessageChars,
    chars_by_role: byRole,
  };
}

export function warnOnLargeLlmContext(messages, metadata = {}) {
  const summary = summarizeLlmContext(messages);
  const threshold = Math.max(20000, Number(process.env.LLM_CONTEXT_WARN_CHARS) || 80000);
  if (summary.chars < threshold) return summary;
  const key = [metadata.source, metadata.tool, metadata.agent].filter(Boolean).join(':') || 'unknown';
  const now = Date.now();
  if (now - (lastWarnings.get(key) || 0) >= 60000) {
    lastWarnings.set(key, now);
    console.warn('[llm-context] oversized prompt', {
      ...summary,
      threshold_chars: threshold,
      source: metadata.source || null,
      tool: metadata.tool || null,
      agent: metadata.agent || null,
    });
  }
  return summary;
}

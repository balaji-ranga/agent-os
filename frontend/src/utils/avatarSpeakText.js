/** Mirror of backend extractSpokenAvatarReply for Virtual Room transcript display. */
export function extractSpokenAvatarReply(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  const fenced = text.match(/```(?:json|text)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);
  const isMeta = (line) =>
    /session history|MEMORY\.md|in_progress|Kanban|tool call|function call|AGENTS\.md|TOOLS\.md/i.test(line) ||
    /^(Let me (start|check|get|look|see|fetch|read)|I'll |I will |Checking |Getting |Looking |Good,)/i.test(line) ||
    /The request is (simple|clear)|speaking through a 3D avatar|Reply briefly|OUTPUT ONLY|CRITICAL OUTPUT/i.test(line) ||
    /^Task\s+\d+/i.test(line) ||
    /now in_progress/i.test(line);
  const kept = lines.filter((l) => !isMeta(l));
  let out = (kept.length ? kept : lines).join(' ').replace(/\s+/g, ' ').trim();
  const spokenStart = out.match(
    /(?:^|[.!?]\s+)((?:Hey|Hi|Hello|Sure|Okay|Ok|Alright|Got it|I'm here|Yes|No|Thanks)[,!]?\s+[\s\S]{8,})$/i
  );
  if (spokenStart?.[1] && spokenStart[1].length < out.length) out = spokenStart[1].trim();
  const sentences = out.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [out];
  if (sentences.length > 2) out = sentences.slice(-2).join(' ').trim();
  return out.slice(0, 480);
}
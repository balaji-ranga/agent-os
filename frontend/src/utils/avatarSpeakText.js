/**
 * Mirror of backend avatar-speak-text.js for Virtual Room UI.
 * - extractSpokenAvatarReply → short TTS line for 3D avatars
 * - speakableChatReply → full chat Speak
 * - extractAvatarTranscriptReply → chat bubble
 */

function stripMediaAndCode(text) {
  let t = String(text || '');
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, ' ');
  t = t.replace(/\[[^\]]*\]\([^)]*api\/media\/[^)]+\)/gi, ' ');
  t = t.replace(/\{[^{}]*"(?:title|values|series|data|labels|type)"[^{}]*\}/gi, ' ');
  t = t.replace(/MEDIA:\s*\/?api\/media\/\S+/gi, ' ');
  t = t.replace(/https?:\/\/\S+/gi, ' ');
  return t;
}

function stripSpokenLabels(text) {
  let t = String(text || '');
  t = t.replace(/short\s+spoken\s+line\s*:\s*["“][^"”]*["”]\s*/gi, ' ');
  t = t.replace(
    /(?:spoken\s+line(?:\s+for\s+(?:the\s+)?avatar)?|speakable(?:\s+(?:line|aloud|this))?)\s*:\s*["“]?[^"”\n]*["”]?\s*/gi,
    ' '
  );
  return t;
}

/** Full assistant reply for Agent Chat Speak — not the 2-sentence avatar snippet. */
export function speakableChatReply(raw, maxChars = 8000) {
  let t = stripMediaAndCode(String(raw || ''));
  t = stripSpokenLabels(t);
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const n = Number(maxChars);
  const cap = Number.isFinite(n) && n > 0 ? n : 8000;
  return t.slice(0, cap);
}

function isMetaLine(line) {
  return (
    /session history|MEMORY\.md|in_progress|Kanban|tool call|function call|AGENTS\.md|TOOLS\.md/i.test(line) ||
    /^(Let me (start|check|get|look|see|fetch|read)|I'll |I will |Checking |Getting |Looking |Good,)/i.test(line) ||
    /The request is (simple|clear)|speaking through a 3D avatar|Reply briefly|OUTPUT ONLY|CRITICAL OUTPUT/i.test(line) ||
    /^Task\s+\d+/i.test(line) ||
    /now in_progress/i.test(line) ||
    /provided as JSON for chart/i.test(line) ||
    /["']values["']\s*:/i.test(line) ||
    /["']series["']\s*:/i.test(line) ||
    /["']labels["']\s*:/i.test(line) ||
    /^[\d.,\s%USD$€£¥]+$/.test(line) ||
    /task is marked complete/i.test(line) ||
    /I'm the COO coordinating this workflow/i.test(line)
  );
}

export function extractSpokenAvatarReply(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';

  const labeled =
    text.match(/short\s+spoken\s+line\s*:\s*["“]([^"”]+)["”]/i) ||
    text.match(/(?:speak(?:able)?(?:\s+(?:line|aloud|this))?|spoken(?:\s+reply)?)\s*:\s*["“]([^"”]+)["”]/i) ||
    text.match(/spoken\s+line(?:\s+for\s+(?:the\s+)?avatar)?\s*:\s*["“]([^"”]+)["”]/i);
  if (labeled?.[1]) {
    return labeled[1].replace(/\s+/g, ' ').trim().slice(0, 480);
  }

  text = stripMediaAndCode(text);
  text = stripSpokenLabels(text);
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');

  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);
  const kept = lines.filter((l) => !isMetaLine(l) && !/^\d+\.\s+\S+/i.test(l));
  let out = (kept.length ? kept : lines).join(' ').replace(/\s+/g, ' ').trim();
  const spokenStart = out.match(
    /(?:^|[.!?]\s+)((?:Hey|Hi|Hello|Sure|Okay|Ok|Alright|Got it|I'm here|Yes|No|Thanks|Here(?:'s| is)?|I've|I have)[,!]?\s+[\s\S]{8,})$/i
  );
  if (spokenStart?.[1] && spokenStart[1].length < out.length) out = spokenStart[1].trim();

  const protectedText = out.replace(/(\d+)\./g, '$1\uFFF0');
  const sentences = protectedText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [protectedText];
  const restored = sentences.map((s) => String(s || '').replace(/\uFFF0/g, '.').trim());
  const spokenish = restored.filter((t) => {
    if (!t) return false;
    if (/^\d+\.\s+\S+/i.test(t)) return false;
    if (/[{}\[\]]/.test(t)) return false;
    if (/["']?(values|series|labels|title)["']?\s*:/i.test(t)) return false;
    if (/^["'].*["']$/.test(t) && /:\s*\[/.test(t)) return false;
    return true;
  });
  const pick = spokenish.length ? spokenish : restored;
  out = (pick.length > 2 ? pick.slice(-2) : pick).join(' ').trim();
  out = out.replace(/^["“](.+)["”]$/s, '$1').trim();
  return out.slice(0, 480);
}

export function extractAvatarTranscriptReply(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';

  text = stripMediaAndCode(text);
  text = stripSpokenLabels(text);

  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean)
    .filter((l) => !isMetaLine(l));

  const summaryIdx = lines.findIndex((l) =>
    /^(summary|status\s*report|latest\s+updates)\b/i.test(l.replace(/^\*+\s*/, ''))
  );
  let bodyLines = summaryIdx >= 0 ? lines.slice(summaryIdx) : lines;

  let out = (bodyLines.length ? bodyLines : lines).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  if (!out) {
    out = stripSpokenLabels(stripMediaAndCode(String(raw || '')))
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return out.slice(0, 2500);
}

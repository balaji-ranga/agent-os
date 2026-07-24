/**
 * Ensure Kanban/chat replies include tool deliverables the model often omits
 * (e.g. generate_image URL) and nudge once when the reply is status-only.
 */
import { getDb } from '../db/schema.js';

const STATUS_ONLY_RE =
  /^(the\s+)?(.{0,80}\s+)?(has been |was )?(successfully )?(completed|finished|done|marked).{0,120}$/i;

export function looksStatusOnlyReply(text) {
  const t = String(text || '').trim();
  if (!t || t.startsWith('[Error from agent:')) return false;
  if (t.length > 320) return false;
  if (/!\[|\/api\/media\/|ingredients?:|instructions?:|#{1,3}\s/i.test(t)) return false;
  return STATUS_ONLY_RE.test(t) || (/completed|marked as (done|finished|completed)/i.test(t) && t.length < 280);
}

export function taskExpectsRichDeliverable(title, description, userText) {
  const blob = `${title || ''}\n${description || ''}\n${userText || ''}`;
  return /recipe|research|brief|image|generate|deep research|overview|ingredients/i.test(blob);
}

function recentOkToolUrls(ownerUserId, agentId, sinceIso, toolName) {
  if (!ownerUserId || !sinceIso) return [];
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT response_payload FROM content_tool_logs
       WHERE owner_user_id = ?
         AND tool_name = ?
         AND lower(status) = 'ok'
         AND datetime(created_at) >= datetime(?)
         AND (source LIKE ? OR source LIKE ?)
       ORDER BY id DESC
       LIMIT 8`
    )
    .all(
      ownerUserId,
      toolName,
      sinceIso.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace(/Z$/, ''),
      `%${String(agentId || '').toLowerCase()}%`,
      `%${String(agentId || '').replace(/-/g, '')}%`
    );
  const urls = [];
  for (const row of rows) {
    try {
      const j = JSON.parse(row.response_payload || '{}');
      const u = j.url || j.image_url || j.media_url;
      if (u && typeof u === 'string' && !urls.includes(u)) urls.push(u);
    } catch {
      /* ignore */
    }
  }
  return urls;
}

/** Append generate_image markdown if the model omitted it. */
export function enrichReplyWithRecentImages(reply, { ownerUserId, agentId, sinceIso }) {
  let out = String(reply || '');
  if (/\/api\/media\/|!\[/.test(out)) return out;
  const urls = recentOkToolUrls(ownerUserId, agentId, sinceIso, 'generate_image');
  if (!urls.length) return out;
  const block = urls.map((u) => `![generated](${u})`).join('\n');
  return `${out.trim()}\n\n${block}`.trim();
}

export const RICH_DELIVERABLE_NUDGE =
  'STOP. Your last message was only a status line. Resend now with the FULL deliverable in the message body ' +
  '(for recipes: Ingredients + step-by-step Instructions + paste generate_image markdown ![generated](<url>); ' +
  'for research: the brief with citations). Do not reply with only "completed".';

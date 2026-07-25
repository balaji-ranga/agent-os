/**
 * Ensure Kanban/chat replies include tool deliverables the model often omits
 * (e.g. generate_image URL) and nudge once when the reply is status-only.
 *
 * Also used by the COO → specialty **delegation** path: status-only replies must
 * not auto-complete the linked Kanban card (regression when agents call
 * kanban_move_status completed without answering the ask).
 */
import { getDb } from '../db/schema.js';

const STATUS_ONLY_RE =
  /^(the\s+)?(.{0,80}\s+)?(has been |was )?(successfully )?(completed|finished|done|marked).{0,120}$/i;

/** "I marked it complete / task is done — ask if you need more" with no answer body. */
const STATUS_CHATTER_RE =
  /\b(marked (as )?(completed|done|finished)|successfully (marked|completed)|task (has been |was )?(successfully )?(marked |is )?(as )?(completed|done|finished)|kanban (task |card )?(has been |was )?(marked )?(as )?(completed|done))\b/i;

export function looksStatusOnlyReply(text) {
  const t = String(text || '').trim();
  if (!t || t.startsWith('[Error from agent:')) return false;
  if (t.length > 420) return false;
  // Real deliverables / structured answers — never treat as status-only.
  if (/!\[|\/api\/media\/|ingredients?:|instructions?:|#{1,3}\s|^\s*[-*]\s+\S/im.test(t)) return false;
  if (STATUS_ONLY_RE.test(t)) return true;
  if (STATUS_CHATTER_RE.test(t) && t.length < 360) return true;
  if (/completed|marked as (done|finished|completed)/i.test(t) && t.length < 280) return true;
  return false;
}

/** True when the card/ask expects a real answer (not a greet) — used for Kanban chat nudge. */
export function taskExpectsRichDeliverable(title, description, userText) {
  const blob = `${title || ''}\n${description || ''}\n${userText || ''}`.trim();
  if (!blob) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay)[.!]?\s*$/i.test(blob)) return false;
  return (
    /recipe|research|brief|image|generate|deep research|overview|ingredients|rag|embedding|keyword|how (do|does|is|are)|what (is|are|does)|explain|compare|find|look up|summar|platform|master.?data/i.test(
      blob
    ) || blob.length > 40
  );
}

/** Should the backend auto-complete the linked Kanban card for this reply? */
export function shouldCompleteKanbanForReply(reply) {
  const t = String(reply || '').trim();
  if (!t || t === '(no response)' || t === '(no content)') return false;
  return !looksStatusOnlyReply(t);
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
  'STOP. Your last message was only a status line (e.g. "task marked as completed"). ' +
  'Resend now with the FULL answer to the CEO ask in the message body. ' +
  'Kanban status moves are not the deliverable. ' +
  'For recipes: Ingredients + step-by-step Instructions + paste generate_image markdown ![generated](<url>). ' +
  'For research / factual Q&A: the actual answer (use master_data_rag / summarize_url / browser when needed). ' +
  'Do not reply with only "completed".';

/**
 * Shared Kanban finish block for specialty delegation runs.
 * Must not claim the backend auto-completes — that taught models to skip the answer.
 */
export function buildDelegationKanbanFinishPrompt(kanbanId) {
  const id = Number(kanbanId);
  return (
    `\n\n---\nIMPORTANT — Kanban finish (you decide):\n` +
    `1. Do the assigned work and put the FULL answer in this reply (not only a status sentence).\n` +
    `2. Self-check before calling completed:\n` +
    `   - YES — reply contains the deliverable (research brief / factual answer / recipe+image / etc.) → ` +
    `call kanban_move_status {"task_id": ${id}, "new_status": "completed"}\n` +
    `   - NO — reply is only "marked completed" / "done" → do NOT call completed; keep working or call failed.\n` +
    `3. The platform will NOT treat a status-only reply as done — empty "completed" chatter leaves the card in_progress.\n` +
    `Do NOT say you are waiting for CEO acknowledgment — this run already executes automatically.\n---`
  );
}

/**
 * One nudge when a delegation/chat reply is status-only. Returns the best reply text.
 */
export async function nudgeIfStatusOnlyReply({
  chatCompletions,
  openclawAgentId,
  sessionUser,
  priorMessages,
  reply,
  enrichOpts = null,
} = {}) {
  let out = String(reply || '').trim() || '(no response)';
  if (!looksStatusOnlyReply(out) || typeof chatCompletions !== 'function') {
    return { reply: out, nudged: false, stillStatusOnly: looksStatusOnlyReply(out) };
  }
  try {
    const nudged = await chatCompletions(
      openclawAgentId,
      [...(priorMessages || []), { role: 'assistant', content: out }, { role: 'user', content: RICH_DELIVERABLE_NUDGE }],
      sessionUser,
      false
    );
    let nudgedReply = (nudged?.content && String(nudged.content).trim()) || '';
    if (nudgedReply && !nudgedReply.startsWith('[Error from agent:')) {
      if (enrichOpts) {
        nudgedReply = enrichReplyWithRecentImages(nudgedReply, enrichOpts);
      }
      if (nudgedReply.length > out.length || !looksStatusOnlyReply(nudgedReply)) {
        out = nudgedReply;
      }
    }
  } catch (e) {
    console.warn('[kanban] deliverable nudge failed:', e?.message || e);
  }
  return {
    reply: out,
    nudged: true,
    stillStatusOnly: looksStatusOnlyReply(out),
  };
}

/**
 * Kanban task-chat status guidance (reopen / follow-up / awaiting confirmation).
 */
import { taskExpectsRichDeliverable } from './kanban-reply-enrich.js';

/** Statuses where the card is waiting on the CEO / user — do not push agent to in_progress. */
export function isAwaitingUserConfirmation(status) {
  return String(status || '') === 'awaiting_confirmation';
}

/** Real deliverable / multi-step work — must not be auto-completed just because the agent replied once. */
const LONG_WORK_RE =
  /\b(research|investigate|implement|build|develop|refactor|compare|analyze|analyse|find all|look up|search for|draft a (plan|report|doc)|write (a |an )?(full |detailed )?(report|plan|proposal)|keep (working|going)|continue (working|investigat)|multi[- ]step|deep dive|deep (tech |space )?research|throughout|over the (next|coming)|embedding|keyword|rag)\b/i;

const CLOSED_QA_RE =
  /\b(what model|which model|what('s| is) (your|the) model|are you using|confirm|yes\/no|just tell|quick (check|question)|one (short )?sentence|mark (as )?(done|complete|completed)|that('s| is) all|thanks|thank you)\b/i;

/**
 * Long-running / deliverable work stays in_progress until the agent (or CEO) finishes explicitly.
 * Auto-complete is only for short Q&A — never for research/build just because a reply arrived.
 */
export function looksLikeLongRunningWork(userText) {
  const t = String(userText || '').trim();
  if (!t) return false;
  if (t.length > 400) return true;
  return LONG_WORK_RE.test(t);
}

/**
 * Short reopen / confirmation Q&A — safe to auto-complete after the agent replies.
 * Do not use alone when the card title/description already expects a real deliverable.
 */
export function looksLikeClosedFollowUp(userText) {
  const t = String(userText || '').trim();
  if (!t) return false;
  if (looksLikeLongRunningWork(t)) return false;
  if (CLOSED_QA_RE.test(t)) return true;
  if (t.length <= 160 && /[?？]\s*$/.test(t)) return true;
  if (t.length <= 80) return true;
  return false;
}

/**
 * Prompt + auto-promote / auto-complete rules for Kanban task chat follow-ups.
 * - awaiting_confirmation: wait for user; no move nudge / no auto status changes
 * - open: nudge + auto-promote to in_progress when agent replies
 * - open / in_progress: auto-complete ONLY for short closed Q&A that is not a deliverable ask
 * - research/build/etc: stay in_progress until agent calls completed/failed (or CEO does)
 */
export function buildKanbanChatStatusGuidance(taskId, status, { userText = '', title = '', description = '' } = {}) {
  if (isAwaitingUserConfirmation(status)) {
    const resumed = buildKanbanChatStatusGuidance(taskId, 'in_progress', { userText, title, description });
    return {
      ...resumed,
      awaitingUser: false,
      promoteOnReply: true,
      instructions:
        `The CEO/user has replied to the confirmation or clarification request. ` +
        `Resume this same task now. FIRST call kanban_move_status with JSON:\n` +
        `  {"task_id": ${taskId}, "new_status": "in_progress"}\n\n`,
    };
  }

  const promoteOnReply = status === 'open';
  const longWork = looksLikeLongRunningWork(userText);
  const expectsDeliverable = taskExpectsRichDeliverable(title, description, userText);
  const closedFollowUp = looksLikeClosedFollowUp(userText);
  // Never auto-complete deliverable work (including short CEO nudges on a research card).
  const completeOnReply =
    !longWork &&
    !expectsDeliverable &&
    (status === 'open' || status === 'in_progress') &&
    (closedFollowUp || (promoteOnReply && !longWork && String(userText || '').trim().length <= 120));

  const instructions = promoteOnReply
    ? `FIRST ACTION (before answering): call the kanban_move_status tool with JSON:\n  {"task_id": ${taskId}, "new_status": "in_progress"}\n\n`
    : '';

  let finishBlock = '';
  if (status === 'open' || status === 'in_progress') {
    if (completeOnReply) {
      finishBlock =
        `\n\n---\nIMPORTANT — Kanban finish (required):\n` +
        `After your brief answer, your LAST action MUST be kanban_move_status:\n` +
        `  {"task_id": ${taskId}, "new_status": "completed"}\n` +
        `Do not leave the card in_progress for a short Q&A.\n---`;
    } else {
      finishBlock =
        `\n\n---\nIMPORTANT — Kanban finish (you decide; deliverable work):\n` +
        `1. Do the assigned work fully (use tools: summarize_url, browser, generate_image, master_data_rag, etc.).\n` +
        `2. Self-check: did you produce the actual deliverable in this reply (full text in the message, not only "done")?\n` +
        `   - YES (research brief body / full recipe+image markdown / factual answer / etc.) → call {"task_id": ${taskId}, "new_status": "completed"}\n` +
        `   - NO usable deliverable in the reply → call failed or awaiting_confirmation.\n` +
        `   Never reply with only a status sentence — include the work product in the same message.\n` +
        `3. If summarize_url 404/403: try one alternate URL or browse_task_start / granted browser — still complete if you delivered a substantive brief with gaps noted. Do not chain three extra summarize_url calls.\n` +
        `4. Optional side tools (master_data_*, email) failing must NOT cause failed if the main deliverable is done.\n` +
        `The platform will NOT auto-complete this card on a status-only reply.\n---`;
    }
  }

  return {
    awaitingUser: false,
    promoteOnReply,
    completeOnReply,
    expectsDeliverable,
    instructions,
    finishBlock,
  };
}

/**
 * Kanban task-chat status guidance (reopen / follow-up / awaiting confirmation).
 */

/** Statuses where the card is waiting on the CEO / user — do not push agent to in_progress. */
export function isAwaitingUserConfirmation(status) {
  return String(status || '') === 'awaiting_confirmation';
}

/**
 * Prompt + auto-promote rules for Kanban task chat follow-ups (including after reopen).
 * - awaiting_confirmation: wait for user; no move nudge / no auto in_progress
 * - open: nudge + auto-promote to in_progress when agent replies
 * - open / in_progress: nudge finish completed|failed
 */
export function buildKanbanChatStatusGuidance(taskId, status) {
  if (isAwaitingUserConfirmation(status)) {
    return {
      awaitingUser: true,
      promoteOnReply: false,
      instructions: '',
      finishBlock:
        '\n\n---\nIMPORTANT — awaiting user confirmation:\n' +
        'Do NOT call kanban_move_status yet. Wait for the CEO/user to confirm or reply, then continue.\n---',
    };
  }
  const promoteOnReply = status === 'open';
  const instructions = promoteOnReply
    ? `FIRST ACTION (before anything else): call the kanban_move_status tool with JSON:\n  {"task_id": ${taskId}, "new_status": "in_progress"}\n\n`
    : '';
  const finishBlock =
    status === 'open' || status === 'in_progress'
      ? `\n\n---\nIMPORTANT — Kanban finish:\nWhen you are done, call ONE of:\n  {"task_id": ${taskId}, "new_status": "completed"}\n  {"task_id": ${taskId}, "new_status": "failed"}\n---`
      : '';
  return { awaitingUser: false, promoteOnReply, instructions, finishBlock };
}

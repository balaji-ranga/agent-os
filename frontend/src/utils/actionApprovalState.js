/** Client-side time guard as well as server status: an open drawer can outlive its grant. */
export function actionApprovalUiState(task, now = Date.now()) {
  const approval = task?.action_approval;
  const chat = String(task?.description || '').includes('[CHAT_ACTION_APPROVAL]');
  if (!chat && !approval) return null;
  const status = approval?.status || 'unavailable';
  const expires = Date.parse(approval?.expires_at || '');
  if (status === 'superseded') return { canDecide: false, label: 'Approval no longer required', message: 'This internal notification request was closed without executing or replaying it.' };
  if (status === 'expired' || (['pending','approved'].includes(status) && Number.isFinite(expires) && now >= expires)) {
    return { canDecide: false, label: 'Approval expired', message: 'The action was not executed. Ask the agent to prepare a fresh request for approval.' };
  }
  if (!approval || !['pending','approved'].includes(status) || !Number.isFinite(expires) || !approval.can_decide) {
    return { canDecide: false, label: 'Approval unavailable', message: status === 'unavailable' ? 'No bound approval record is available. Ask the agent to prepare a fresh request.' : `This approval is ${status}; it cannot be approved or replayed.` };
  }
  return { canDecide: true, label: 'Action approval required', message: 'Approve permits only this exact pending action once. Reject stops the action.' };
}

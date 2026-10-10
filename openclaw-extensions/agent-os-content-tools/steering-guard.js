// Applies only to the platform's bounded steering reconciliation, not normal work.
export function steeringToolBlock(scope, name, params = {}, at = Date.now()) {
  if (!scope?.steering_reconcile) return null;
  if (Date.parse(scope.expires_at || '') <= at) return 'Reconciliation scope expired; no further tools may run.';
  if (!Number.isFinite(Date.parse(scope.expires_at || ''))) return 'Invalid reconciliation scope';
  const research = ['connector_search_actions','connector_get_action_guide','connector_execute_action','brave_web_search','summarize_url'];
  if (!research.includes(name) || !scope.tools?.includes(name)) return 'Steering reconciliation permits granted read-only research only; no native, mutation or planning tools.';
  if (name === 'connector_execute_action') {
    const id = String(params.action_id || params.actionId || params.id || '');
    const operation = id.split('.').pop();
    if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(id) || !/^(get|list|search|find|fetch|read|lookup|inspect)(_|$)/i.test(operation)) return 'Steering reconciliation cannot execute a write or unknown connector action.';
  }
  return null;
}

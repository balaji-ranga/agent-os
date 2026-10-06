export const IBKRNEW_SME_REVIEW_TOOLS = Object.freeze([
  'ibkrnew_paper_strategy_status',
  'ibkrnew_paper_instrument_readiness',
  'ibkrnew_paper_decision_history',
]);

// A narrow per-turn evidence source contract, not new permissions or a trading
// policy. Runtime/account follow-ups also need canonical current evidence:
// history and legacy process flags are not the IBKRNew execution source.
export function ibkrNewSmeReviewContract(agent, prompt, grantedTools = []) {
  if (agent?.template_base_id !== 'ibkr-portfolio-strategy-sme') return null;
  const text = String(prompt || '');
  const strategyReview = /\b(?:ibkrnew|paper|strategy|strategies|goal)\b/i.test(text) && /\b(?:review|check|status|readiness|ready|active|enabled|blocked|blockers|prerequisites?|interpret|execut\w*|orders?)\b/i.test(text);
  const accountReview = /\baccount\s+(?:snapshot|view)\b/i.test(text);
  const runtimeFollowup = /\btrading\s+enabled\b|\bmarket\b[^.!?\n]*\b(?:closed|open)\b|\baccount\b[^.!?\n]*\b(?:paper|live)\b|\b(?:paper|live)\b[^.!?\n]*\baccount\b/i.test(text);
  if (!strategyReview && !accountReview && !runtimeFollowup) return null;
  const affirmative = text.replace(/\b(?:do not|don't|never|without|no changes?)\b[^.!?\n]*/gi, '');
  if (/\b(?:draft|publish|modify|reset|pause|resume|restart|deploy|configure|activate|propose|design|change|fix)\b/i.test(affirmative)) return null;
  const missing = IBKRNEW_SME_REVIEW_TOOLS.filter(name => !grantedTools.includes(name));
  const tools = IBKRNEW_SME_REVIEW_TOOLS.filter(name => grantedTools.includes(name));
  if (accountReview && grantedTools.includes('ibkr_account_snapshot_latest')) tools.push('ibkr_account_snapshot_latest');
  return {
    tools,
    missing,
    instruction: `[IBKRNEW PAPER REVIEW — CURRENT TURN]\nThis is a current runtime/strategy review, not legacy preflight. ${missing.length ? `Missing required granted tools: ${missing.join(', ')}. Report that exact capability gap; do not substitute legacy results.` : `Invoke all three read-only evidence tools: ${IBKRNEW_SME_REVIEW_TOOLS.join(', ')}. Start with strategy status, then instrument readiness and decision history. All are granted in this turn.`}\n${accountReview ? 'For the requested account book also call ibkr_account_snapshot_latest if granted. Label its cached_at/captured_at and legacy day_status separately; it cannot override canonical Paper runtime.' : ''}\nUse only fresh IBKRNew evidence for the execution conclusion, not earlier chat assertions or legacy preflight/account-snapshot/draft results. Enabled strategy outside the market session is NOT disabled trading. day_status.trading_enabled is the LEGACY IBKR_TRADING_ENABLED switch and NOT the IBKRNew strategy flag; never change it for this review. Report runtime.strategy_configured_enabled, runtime.automatic_strategy_enabled, runtime.market_open_now and runtime.opening_evaluation_allowed_now as separate booleans, with as_of and block_reasons. session.regular=true means the market IS OPEN; minutes_to_close is time UNTIL CLOSE, never time until opening. Never infer Paper/Live from absence of fills; use execution mode and verified attestation. A general hours webpage cannot contradict the current exchange-calendar timestamp. State exact goal and cycle IDs, six-agent enablement, profile gate counts, quote capacity and actual recent veto reasons. Distinguish conditional profile passes from executable trade readiness and account exposure from goal-attributed profit. If evidence is missing, say so. This review must not create drafts, change settings, refresh, reserve or submit/cancel orders.`,
  };
}

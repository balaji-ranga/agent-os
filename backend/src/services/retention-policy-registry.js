/** Explicit retention contracts. Never infer deletion authority from a table name. */
export const retentionRules = {};
const add = (names, rule = {}) => {
  for (const name of names.trim().split(/\s+/)) retentionRules[name] = { owner: 'owner_user_id', time: 'created_at', ...rule };
};
add(`chat_turns agent_workflow_chat_turns agent_response_feedback agent_execution_learning_versions
  company_review_feedback company_review_opinions company_objective_versions company_objective_goal_runs
  content_tool_logs cost_lines token_usage tool_api_rate_limit_resets tool_write_evidence
  goal_mission_events kanban_user_action_audit kanban_task_observer_audit kanban_observer_feedback
  model_route_events org_member_invocations workflow_a2a_invocation_logs human_messages
  ibkr_order_events ibkr_cash_events ibkr_fills ibkr_realized_pnl ibkr_position_snapshots
  ibkr_quant_inference_runs ibkrnew_allocation_decisions ibkrnew_component_errors
  ibkrnew_event_reactions ibkrnew_executions ibkrnew_paper_execution_tests`);
add('kanban_sla_events', { time: 'occurred_at' });
add('company_objective_measurements', { time: 'measured_at' });
add('company_revenue_evidence', { time: 'occurred_at' });
add('content_download_scans', { time: 'scanned_at' });
add('chat_action_approval_task_archive', { time: 'archived_at' });
add('ibkrnew_position_snapshots', { time: 'captured_at' });
add('ibkr_equity_marks', { time: 'mark_date' });
add('knowledge_feedback knowledge_retrieval_metrics', { owner: 'owner' });
add('data_retention_runs', { time: 'finished_at' });
add('tool_async_jobs', {time:'updated_at',state:'notification_state',states:['sent','web_fallback']});
add('agent_workflow_audit', {parent:{table:'agent_workflow_definitions',key:'id',fk:'definition_id',owner:'owner_user_id'}});
add('activities', {parent:{table:'agents',key:'id',fk:'agent_id',owner:'owner_user_id'}});
add('platform_skill_audit', {parent:{table:'agent_skills',key:'id',fk:'skill_id',owner:'owner_user_id'}});
add('native_retention_requests', { time:'finished_at',state:'status',states:['completed','failed'] });
add('agent_learnings_cache tool_summary_cache', { time: 'updated_at' });
add('ibkrnew_instrument_profiles ibkrnew_component_health ibkrnew_profile_refresh_state', { time: 'updated_at' });
add('floassist_run_errors', { owner: 'owner_id', time: 'resolved_at', unit: 'ms' });
add('floassist_account_receipts floassist_connector_health floassist_storage_health', { owner: 'owner_id', time: 'checked_at', unit: 'ms' });
add('floassist_task_alert_days', { owner: 'owner_id', time: 'first_sent_at', unit: 'ms' });
add('floassist_source_assessments', { owner: 'owner_id', time: 'completed_at', unit: 'ms' });
add('floassist_coverage_audit floassist_tracking_audit floassist_run_assessment_context floassist_run_source_versions floassist_source_references', { owner: 'owner_id', unit: 'ms' });
add('floassist_source_receipts', { owner: 'owner_id', time: 'checked_at', unit: 'ms' });
add('floassist_thread_receipts', { owner: 'owner_id', time: 'latest_at', unit: 'ms' });
add('platform_user_notifications promotion_events mcp_call_logs', { owner: 'user_id', users: true });
add('admin_privileged_audit', { owner:'user_id',users:true });
add('content_conversion_jobs');
add('user_feed_dismissals', { owner: 'user_id', users: true, time: 'dismissed_at' });

const terminal = (names, states, extra = {}) => add(names, { time: 'updated_at', state: 'status', states: states.split(' '), ...extra });
terminal('agent_goal_runs', 'completed partial_success failed cancelled', { time: 'COALESCE(completed_at,updated_at)' });
terminal('agent_workflow_runs', 'completed failed cancelled', { time: 'COALESCE(completed_at,updated_at)' });
terminal('agent_delegation_tasks', 'completed failed cancelled', { time: 'completed_at' });
terminal('job_workflow_runs', 'completed failed cancelled', { owner: 'ceo_user_id', time: 'COALESCE(completed_at,updated_at)' });
terminal('browser_tasks', 'completed failed cancelled', { owner: 'ceo_user_id' });
terminal('browser_worker_jobs agent_workflow_certify_jobs', 'completed failed cancelled');
terminal('chat_work_units', 'completed failed cancelled archived');
terminal('chat_sessions', 'archived');
terminal('kanban_tasks', 'completed done cancelled closed');
terminal('standups', 'completed approved cancelled failed', { time: 'COALESCE(approved_at,created_at)' });
terminal('scheduled_goal_runs', 'ok error cancelled completed failed', { time: 'created_at' });
terminal('productivity_events', 'completed dead_letter acknowledged ignored', { time: 'COALESCE(processed_at,received_at)' });
terminal('agent_mcp_action_receipts', 'completed failed success error', { time: 'created_at' });
terminal('efficiency_calls', 'completed failed success error');
terminal('workflow_a2a_tasks', 'completed failed canceled cancelled rejected', { state: 'state' });
terminal('chat_action_approvals', 'approved rejected denied consumed expired cancelled', { time: 'COALESCE(consumed_at,decided_at,requested_at)', expired: 'expires_at' });
terminal('goal_action_approvals', 'approved rejected denied consumed expired cancelled', { time: 'COALESCE(decided_at,created_at)' });
terminal('human_calls', 'ended declined missed failed cancelled expired', { time: 'COALESCE(ended_at,expires_at,created_at)' });
terminal('ceo_voice_sessions', 'ended closed expired failed', { time: 'COALESCE(ended_at,expires_at,created_at)' });
terminal('company_reviews', 'completed cancelled');
terminal('company_review_improvements', 'rejected rolled_back completed');
terminal('job_applications', 'rejected withdrawn closed archived', { owner: 'ceo_user_id' });
terminal('ibkr_trade_reservations', 'released filled cancelled rejected expired');
terminal('ibkrnew_command_outbox ibkrnew_authorizations', 'expired rejected cancelled filled', { time: 'created_at' });
terminal('ibkrnew_budget_reservations', 'released filled');
terminal('ibkrnew_trade_records', 'closed cancelled rejected');
terminal('ibkrnew_goal_cycles', 'ACHIEVED EXPIRED');
terminal('ibkrnew_goals', 'COMPLETED');
terminal('ibkrnew_events', 'processed completed rejected ignored failed', { time: 'created_at' });
terminal('trading_day_plans', 'completed expired cancelled rejected');
terminal('knowledge_jobs', 'completed failed cancelled', { owner: 'owner', time: 'ended_at' });
terminal('knowledge_mapping_advice', 'accepted rejected applied dismissed', { owner: 'owner', time: 'created_at' });
terminal('platform_feedback', 'resolved closed rejected');
terminal('agent_skill_execution_audit', 'completed failed cancelled', { time: 'COALESCE(completed_at,created_at)' });
terminal('floassist_source_coverage', '1', { owner:'owner_id', state:'complete', unit:'ms' });
terminal('native_model_calls', 'completed failed cancelled error', { owner: 'owner_id', unit: 'ms' });
terminal('floassist_notifications', 'sent delivered expired cancelled failed', { owner: 'owner_id', unit: 'ms' });
terminal('floassist_reminders', 'completed cancelled expired done', { owner: 'owner_id', unit: 'ms' });
terminal('floassist_task_tracking', 'completed closed cancelled', { owner: 'owner_id', time: 'last_seen_at', state: 'state', unit: 'ms' });
terminal('work_steering', 'delivered resolved expired cancelled', { time: 'COALESCE(delivered_at,created_at)', expired: 'expires_at' });
add('tool_execution_actions', { time: 'completed_at' });

// These records may be removed only after their authority has expired too.
add('human_call_invites mcp_oauth_states browser_extension_pairing_codes', { time: 'expires_at', expired: 'expires_at' });
add('action_approval_grants company_objective_approvals', {time:'expires_at',expired:'expires_at'});
add('platform_sessions password_reset_tokens mfa_challenges admin_stepup_tokens', { owner: 'user_id', users: true, time: 'expires_at', expired: 'expires_at' });
add('tool_credential_leases', { time: 'expires_at', expired: 'expires_at' });
add('floassist_access floassist_verifications native_model_test_budgets', { owner: 'owner_id', time: 'expires_at', expired: 'expires_at', unit: 'ms' });
add('ui_copilot_sessions', { owner: 'owner', time: 'expires_at', expired: 'expires_at', unit: 'ms' });
add('gmail_mailbox_cleanup_plans', { time:'expires_at',expired:'expires_at' });
add('erpnext_sso_tokens twenty_sso_tokens', { time:'expires_at',expired:'expires_at' });

// Child lifetimes follow the parent's terminal eligibility, never just creation.
export const retentionChildren = {
  agent_goal_runs: [['agent_goal_steps', 'goal_run_id', 'id']],
  agent_workflow_runs: [['agent_workflow_run_steps', 'run_id', 'id'], ['agent_workflow_pending_listeners', 'run_id', 'id']],
  job_workflow_runs: [['job_workflow_steps', 'workflow_run_id', 'id']],
  standups: [['standup_messages', 'standup_id', 'id'], ['standup_responses', 'standup_id', 'id']],
  kanban_tasks: [['task_messages', 'task_id', 'id'], ['kanban_task_observer_state', 'task_id', 'id']],
  knowledge_jobs: [['knowledge_record_attempts', 'job_id', 'id']],
  native_model_test_budgets: [['native_model_test_sessions','budget_id','id']],
  tool_execution_actions: [['floassist_action_context','action_id','id'],['floassist_action_error_items','action_id','id']],
  ibkrnew_goal_cycles: [['ibkrnew_goal_trade_links','cycle_id','cycle_id']],
};

// Retain replay protection, but discard the expired response/request bodies.
export const retentionRedactions = {
  company_email_channel_receipts: {owner:'owner_user_id',time:'COALESCE(received_at,created_at)',state:'status',states:['completed','processed','failed','ignored'],fields:{subject:'',sender_masked:'',error:null}},
  productivity_action_receipts: {owner:'owner_user_id',time:'updated_at',state:'status',states:['completed','failed'],fields:{request_summary_json:'{}',response_summary_json:'{}',error:null}},
  human_conversations: { owner: 'owner_user_id', time: 'summary_updated_at', fields: { summary_text: null, summary_updated_at: null } },
  tool_write_idempotency: { owner: 'owner_user_id', time: 'created_at', fields: { result_json: null } },
  agent_command_receipts: { owner: 'owner_user_id', time: 'created_at', state: 'state', states: ['completed','failed'], fields: { response_json: null } },
};

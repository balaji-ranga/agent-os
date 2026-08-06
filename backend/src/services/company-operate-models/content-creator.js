/**
 * Content Creator operating model template (Phase D Day 0).
 *
 * Run model: CEO weekly goals → COO → manual/event operate workflows.
 * No platform cron on content loops — COO (or CEO) triggers after a goal is live.
 * Topic / post uniqueness: master_data content_topics_history (20-day window).
 */
export const contentCreatorOperatingModel = {
  id: "content_creator",
  label: "Content Creator operations",
  loops: [
    {
      id: "content_pipeline",
      name: "Content production loop",
      description:
        "COO- or CEO-triggered. Execute against the active CEO weekly content goal: angles/drafts for ready channels, review, publish checklist, log. Never invent the week's topic. Never schedule silently.",
      cadence: "event",
      owner_roles: ["COO", "Content Strategist", "Media Generator", "Content Reviewer", "Channel Publisher"],
      steps: [
        "load_ceo_goal",
        "check_topics_history_20d",
        "research",
        "draft",
        "review",
        "publish_checklist",
        "log_topics_history",
        "log",
      ],
      critical_day1: true,
      primary_agent_role: "Content Strategist",
    },
    {
      id: "community_triage",
      name: "Community comment triage",
      description:
        "Event/manual. Workflow nodes: Meta Graph MCP get_my_pages + brain (get_page_posts/get_post_comments) → agent writes comment_inbox → Community Manager drafts → CEO gate → brain reply_to_comment. LinkedIn comments still deferred (no Graph-equivalent OC action).",
      cadence: "event",
      owner_roles: ["COO", "Community Manager"],
      steps: ["triage", "draft_reply", "approve_if_needed", "log"],
      critical_day1: true,
      primary_agent_role: "Community Manager",
    },
    {
      id: "weekly_ops_rollup",
      name: "Weekly ops rollup",
      description: "Event/manual: pipeline counts, topic-history health, blockers, channel readiness summary for CEO.",
      cadence: "event",
      owner_roles: ["COO", "Ops Reporter"],
      steps: ["gather", "summarize", "notify_ceo"],
      critical_day1: true,
      primary_agent_role: "Ops Reporter",
    },
  ],
  /** Day-1 tracked goals (same readiness honesty as systems/channels). */
  goals: [
    {
      id: "policies_guardrails",
      label: "Policies & guardrails (content safety baseline)",
      path: "/policies",
      owner_role: "CEO",
      cadence: "once",
      required: true,
      readiness: "not_ready",
      note: "Day 1 seeds universal safety (no sexual, abusive, discriminatory content). Mark ready after review.",
    },
    {
      id: "weekly_content_goal",
      label: "Weekly content goal (CEO topic)",
      path: "/scheduled-goals",
      owner_role: "CEO",
      cadence: "weekly",
      required: true,
      readiness: "not_ready",
      note:
        "CEO sets the week's topic (Scheduled goals → COO or brief). COO triggers content workflows with that goal as input.",
    },
    {
      id: "coo_trigger_content_pipeline",
      label: "COO triggers content production when a goal is set",
      path: "/scheduled-goals",
      owner_role: "COO",
      cadence: "event",
      required: true,
      readiness: "not_ready",
      note:
        "After a CEO goal is active, COO uses agent_workflow_trigger on Operate – Content production loop (manual/event; no silent cron).",
    },
    {
      id: "community_comment_goal",
      label: "Community comment triage goal",
      path: "/scheduled-goals",
      owner_role: "CEO",
      cadence: "weekly",
      required: true,
      readiness: "not_ready",
      note:
        "CEO/COO goal targeting Community Manager: which channels/threads to triage. Live feed read stays connector/browser;",
    },
    {
      id: "ops_rollup_goal",
      label: "Ops rollup for CEO",
      path: "/scheduled-goals",
      owner_role: "CEO",
      cadence: "weekly",
      required: true,
      readiness: "not_ready",
      note: "CEO schedules Ops Reporter to summarize pipeline, goals readiness, blockers; uses notify_ceo.",
    },
  ],
  daily_tasks: [
    {
      agent_name: "COO",
      tasks: [
        "Hold the active CEO weekly content goal; if none, notify_ceo — do not invent a topic",
        "When a goal is set or refreshed: agent_workflow_trigger Operate – Content production loop with the goal text as input (ready channels only)",
        "When comments need triage: agent_workflow_trigger Operate – Community comment triage with threads/context (no silent cron)",
        "When CEO wants a rollup: agent_workflow_trigger Operate – Weekly ops rollup",
        "Do not rely on workflow schedule — content loops are manual/event only",
      ],
    },
    {
      agent_name: "Content Strategist",
      tasks: [
        "Load CEO weekly content goal from run input / goals track / Scheduled goals / content_calendar (ceo_set). If none: stop and notify_ceo",
        "Query master_data content_topics_history for the last 20 days — do not reuse title, theme fingerprint, or near-duplicate angle",
        "Translate the CEO goal into 1-3 NEW angles/briefs per ready channel only",
        "After drafts: ensure proposed titles/topics are logged or staged for content_topics_history (date, platform, topic, fingerprint)",
      ],
    },
    {
      agent_name: "Media Generator",
      tasks: [
        "Produce drafts only from briefs that reference the CEO weekly goal (copy first)",
        "Avoid repeating wording from content_topics_history (20-day window)",
        "Attach URLs/assets; hand off to Content Reviewer",
      ],
    },
    {
      agent_name: "Content Reviewer",
      tasks: [
        "Check brand voice, policy, and 20-day uniqueness vs content_topics_history",
        "Return issues or mark ready for Channel Publisher",
      ],
    },
    {
      agent_name: "Community Manager",
      tasks: [
        "On triage trigger: run Operate community workflow (MCP Graph nodes); load comment_inbox via master_data_list_rows; never invent live comments",
        "Draft replies using comment_playbook; escalate legal/PR (notify_ceo / CEO gate)",
        "Do not invent live feed scrapes; connector/browser comment fetch is a separate readiness item",
        "Log triage outcomes to master_data; never claim a public reply was posted without connector success",
      ],
    },
    {
      agent_name: "Channel Publisher",
      tasks: [
        "Last leg only after Reviewer / CEO gate: extract EXACT approved bodies",
        "agent_workflow_trigger workflow_id=content-publish-social for each platform (linkedin/facebook) with { platform, body, page_id?, fingerprint }",
        "Poll agent_workflow_runs; never invent post URLs; fail closed if Connectors not linked",
        "Log content_topics_history + publish_log after every attempt",
        "browse_task_* only if publish_path=browser emergency",
      ],
    },
    {
      agent_name: "Ops Reporter",
      tasks: [
        "On rollup trigger: inspect master_data (content_topics_history, publish_log, company_goals), workflow run summaries when granted",
        "Summarize pipeline stages, pending CEO approvals, missing weekly goals, connector readiness (honest)",
        "notify_ceo with short rollup; do not invent publish success",
      ],
    },
  ],
  weekly_rituals: [
    "CEO sets or refreshes weekly content goal (path=/scheduled-goals) - topic source of truth",
    "COO triggers Operate - Content production loop (multi-agent: Strategist -> Media -> Reviewer -> CEO gate -> Channel Publisher) with that goal (manual/event)",
    "Team consults content_topics_history so titles/themes are not repeated within 20 days",
    "Channel readiness review (Connectors MCP + OpenConnector; browser emergency only)",
    "Ops rollup on demand: posts shipped, topic reuse avoided, blockers",
  ],
  autonomy_matrix: [
    { action: "set_weekly_topic", label: "Set / change weekly content topic", level: "require_ceo" },
    { action: "research", label: "Research angles under CEO goal", level: "auto" },
    { action: "draft", label: "Draft content / media", level: "auto" },
    { action: "review", label: "Internal brand review", level: "auto" },
    { action: "publish", label: "Public publish", level: "require_ceo" },
    { action: "reply_public", label: "Public comment reply", level: "recommend" },
    { action: "spend", label: "Paid ads / paid tools", level: "require_ceo" },
    { action: "hire", label: "Hire new AI employees", level: "require_ceo" },
    { action: "infra", label: "Connector / infra changes", level: "require_ceo" },
  ],
  channels: [
    { id: "facebook", label: "Facebook Page", owner_role: "Channel Publisher", path: "/connectors", system_id: "mcp_meta_graph" },
    { id: "instagram", label: "Instagram", owner_role: "Channel Publisher", path: "/connectors", system_id: "mcp_meta_graph" },
    { id: "linkedin", label: "LinkedIn", owner_role: "Channel Publisher", path: "/connectors", system_id: "openconnector" },
    { id: "blog", label: "Blog CMS", owner_role: "Channel Publisher", path: "/browser-session", system_id: "browser_session" },
  ],
  systems_run: [
    { id: "policies", label: "Policies & guardrails", path: "/policies", required: true },
    { id: "connectors_mcp", label: "Connectors -> MCPs (Facebook Meta Graph OAuth)", path: "/connectors", required: true },
    { id: "openconnector", label: "OpenConnector (LinkedIn Share + OpenID)", path: "/connectors", required: true },
    { id: "browser_session", label: "Browser Session (blog / emergency only)", path: "/browser-session", required: false },
    { id: "master_data", label: "Master Data (goals, calendar, 20-day topic history)", path: "/master-data", required: true },
    { id: "kanban", label: "Kanban board (agent tasks / approvals)", path: "/kanban", required: true },
    { id: "replicate", label: "Image gen (Replicate BYOK, optional)", path: "/api-keys", required: false },
  ],
  quality_bars: [
    "Week's content topics come from the CEO weekly content goal only - agents do not invent the goal",
    "Do not repeat a post title, theme fingerprint, or near-duplicate angle within 20 days (check content_topics_history)",
    "Match brand voice and company mission",
    "No unapproved legal / financial claims",
    "Publish only after autonomy matrix allows (CEO gate if require_ceo)",
    "Public FB/LI text posts use content-publish-social (MCP + OpenConnector) - not browser compose",
    "Log every publish attempt into publish_log / content_topics_history",
  ],
  raci: [
    { activity: "Weekly content goal (topic)", responsible: "CEO", accountable: "CEO", consulted: "Content Strategist", informed: "COO / Team" },
    { activity: "Trigger content workflow", responsible: "COO", accountable: "CEO", consulted: "Content Strategist", informed: "Team" },
    { activity: "Weekly calendar angles from goal", responsible: "Content Strategist", accountable: "CEO", consulted: "Ops Reporter", informed: "Team" },
    { activity: "Generate drafts", responsible: "Media Generator", accountable: "Content Strategist", consulted: "Content Reviewer", informed: "Channel Publisher" },
    { activity: "Publish", responsible: "Channel Publisher", accountable: "CEO (when gated)", consulted: "Content Reviewer", informed: "Ops Reporter" },
    { activity: "Public replies", responsible: "Community Manager", accountable: "CEO (when gated)", consulted: "Content Reviewer", informed: "Ops Reporter" },
  ],
  knowledge_seeds: [
    {
      name: "company_goals",
      description: "Tracked operate goals (mirrors Day-1 goals readiness; fill from CEO).",
      columns: ["goal_id", "label", "owner", "cadence", "status", "prompt_or_brief", "updated"],
      seed_rows: [
        {
          goal_id: "weekly_content_goal",
          label: "Weekly content goal (CEO topic)",
          owner: "CEO",
          cadence: "weekly",
          status: "awaiting_ceo",
          prompt_or_brief: "",
          updated: "",
        },
        {
          goal_id: "coo_trigger_content_pipeline",
          label: "COO triggers content production when a goal is set",
          owner: "COO",
          cadence: "event",
          status: "awaiting_setup",
          prompt_or_brief: "agent_workflow_trigger Operate - Content production loop with CEO goal as input",
          updated: "",
        },
      ],
    },
    {
      name: "content_calendar",
      description: "Slots filled from CEO weekly content goal — not invented placeholders.",
      columns: ["date", "platform", "theme", "owner", "status", "notes"],
      seed_rows: [
        {
          date: "",
          platform: "LinkedIn",
          theme: "",
          owner: "Content Strategist",
          status: "awaiting_ceo_goal",
          notes: "Fill theme only after CEO weekly goal is set",
        },
        {
          date: "",
          platform: "Facebook",
          theme: "",
          owner: "Content Strategist",
          status: "awaiting_ceo_goal",
          notes: "Fill theme only after CEO weekly goal is set",
        },
      ],
    },
    {
      name: "content_topics_history",
      description:
        "Dedup ledger: every drafted/published title+topic. Agents must not reuse title/theme fingerprint for 20 days.",
      columns: [
        "when",
        "platform",
        "title",
        "topic",
        "fingerprint",
        "status",
        "notes",
        "expires_after",
      ],
      seed_rows: [],
    },
    {
      name: "publish_log",
      description: "Honest post outcomes (no fake publishes).",
      columns: ["when", "platform", "title", "topic", "status", "notes"],
      seed_rows: [],
    },
  ],
  digest: {
    mode: "daily",
    channel: "in_app",
    include: ["pipeline stages", "awaiting CEO publish", "channel readiness", "goals readiness", "20d topic history"],
  },
  escalations: {
    public_risk: "Stop and notify_ceo; do not reply/publish",
    budget: "Escalate spend without auto-execute",
    connector_down: "Mark readiness not_ready; notify CEO; continue internal drafts",
    missing_ceo_goal: "Stop content production; notify_ceo; do not invent topic",
    topic_reuse: "Reject angle; pick a new angle under the same CEO goal",
  },
};

/**
 * Content Creator operating model template (Phase D Day 0).
 */
export const contentCreatorOperatingModel = {
  id: "content_creator",
  label: "Content Creator operations",
  loops: [
    {
      id: "content_pipeline",
      name: "Content production loop",
      description: "Research themes, produce drafts, review, publish checklist, log outcomes.",
      cadence: "daily",
      owner_roles: ["Content Strategist", "Media Generator", "Content Reviewer", "Channel Publisher"],
      steps: ["research", "draft", "review", "publish_checklist", "log"],
      critical_day1: true,
      primary_agent_role: "Content Strategist",
    },
    {
      id: "community_triage",
      name: "Community comment triage",
      description: "Draft replies; escalate sensitive threads to CEO when gated.",
      cadence: "daily",
      owner_roles: ["Community Manager"],
      steps: ["triage", "draft_reply", "approve_if_needed", "log"],
      critical_day1: true,
      primary_agent_role: "Community Manager",
    },
    {
      id: "weekly_ops_rollup",
      name: "Weekly ops rollup",
      description: "Pipeline counts, blockers, channel readiness summary for CEO.",
      cadence: "weekly",
      owner_roles: ["Ops Reporter"],
      steps: ["gather", "summarize", "notify_ceo"],
      critical_day1: false,
      primary_agent_role: "Ops Reporter",
    },
  ],
  daily_tasks: [
    {
      agent_name: "Content Strategist",
      tasks: [
        "Review content calendar for next 7 days",
        "Propose 1-3 themes or briefs for Media Generator",
        "Flag overdue pipeline items on Kanban",
      ],
    },
    {
      agent_name: "Media Generator",
      tasks: [
        "Produce drafts from approved briefs (image/copy/blog draft)",
        "Attach URLs/assets to pipeline row",
        "Hand off to Content Reviewer",
      ],
    },
    {
      agent_name: "Content Reviewer",
      tasks: [
        "Check brand voice and policy before publish",
        "Return issues or mark ready for Channel Publisher",
      ],
    },
    {
      agent_name: "Community Manager",
      tasks: [
        "Scan priority threads on connected channels (when Browser Session ready)",
        "Draft replies; escalate policy / reputation risk",
      ],
    },
    {
      agent_name: "Channel Publisher",
      tasks: [
        "Run platform publish checklists (FB/IG/LI/blog CMS)",
        "Log outcomes in content_pipeline / post log",
      ],
    },
    {
      agent_name: "Ops Reporter",
      tasks: [
        "Update pipeline stage summary",
        "Notify CEO of blockers and publish waits",
      ],
    },
  ],
  weekly_rituals: [
    "Weekly content calendar planning (Strategist + CEO digest)",
    "Channel readiness review (Browser Session logins)",
    "Ops Reporter rollup: posts shipped, comments handled, blockers",
  ],
  autonomy_matrix: [
    { action: "research", label: "Research / themes", level: "auto" },
    { action: "draft", label: "Draft content / media", level: "auto" },
    { action: "review", label: "Internal brand review", level: "auto" },
    { action: "publish", label: "Public publish", level: "require_ceo" },
    { action: "reply_public", label: "Public comment reply", level: "recommend" },
    { action: "spend", label: "Paid ads / paid tools", level: "require_ceo" },
    { action: "hire", label: "Hire new AI employees", level: "require_ceo" },
    { action: "infra", label: "Connector / infra changes", level: "require_ceo" },
  ],
  channels: [
    { id: "facebook", label: "Facebook", owner_role: "Channel Publisher", path: "/browser-session", system_id: "browser_session" },
    { id: "instagram", label: "Instagram", owner_role: "Channel Publisher", path: "/browser-session", system_id: "browser_session" },
    { id: "linkedin", label: "LinkedIn", owner_role: "Channel Publisher", path: "/browser-session", system_id: "browser_session" },
    { id: "blog", label: "Blog CMS", owner_role: "Channel Publisher", path: "/browser-session", system_id: "browser_session" },
  ],
  systems_run: [
    { id: "browser_session", label: "Browser Session (FB/IG/LI/blog logins)", path: "/browser-session", required: true },
    { id: "replicate", label: "Image gen (Replicate BYOK, optional)", path: "/api-keys", required: false },
    { id: "kanban", label: "Kanban board (agent tasks / approvals)", path: "/kanban", required: true },
  ],
  quality_bars: [
    "Match brand voice and company mission",
    "No unapproved legal / financial claims",
    "Publish only after autonomy matrix allows (CEO gate if require_ceo)",
    "Log every publish attempt with channel and outcome",
  ],
  raci: [
    { activity: "Weekly calendar", responsible: "Content Strategist", accountable: "CEO", consulted: "Ops Reporter", informed: "Team" },
    { activity: "Generate drafts", responsible: "Media Generator", accountable: "Content Strategist", consulted: "Content Reviewer", informed: "Channel Publisher" },
    { activity: "Publish", responsible: "Channel Publisher", accountable: "CEO (when gated)", consulted: "Content Reviewer", informed: "Ops Reporter" },
    { activity: "Public replies", responsible: "Community Manager", accountable: "CEO (when gated)", consulted: "Content Reviewer", informed: "Ops Reporter" },
  ],
  knowledge_seeds: [
    {
      name: "content_calendar",
      description: "Operate Day-1 content calendar slots.",
      columns: ["date", "platform", "theme", "owner", "status", "notes"],
      seed_rows: [
        { date: "", platform: "Instagram", theme: "Week opener", owner: "Content Strategist", status: "planned", notes: "Fill dates after Day 1" },
        { date: "", platform: "LinkedIn", theme: "Thought leadership post", owner: "Content Strategist", status: "planned", notes: "Not YouTube — separate industry later" },
      ],
    },
    {
      name: "publish_log",
      description: "Honest post outcomes (no fake publishes).",
      columns: ["when", "platform", "title", "status", "notes"],
      seed_rows: [],
    },
  ],
  digest: {
    mode: "daily",
    channel: "in_app",
    include: ["pipeline stages", "awaiting CEO publish", "channel readiness"],
  },
  escalations: {
    public_risk: "Stop and notify_ceo; do not reply/publish",
    budget: "Escalate spend without auto-execute",
    connector_down: "Mark readiness not_ready; notify CEO; continue internal drafts",
  },
};

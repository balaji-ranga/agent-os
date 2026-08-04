/**
 * Generic / thin-pack operating model skeletons (Phase D Day 0).
 */
function baseMatrix(bias = "after_approval") {
  const publish = bias === "autonomous" ? "recommend" : "require_ceo";
  return [
    { action: "research", label: "Research", level: "auto" },
    { action: "draft", label: "Draft work product", level: "auto" },
    { action: "review", label: "Internal review", level: bias === "suggest" ? "recommend" : "auto" },
    { action: "publish", label: "External / public action", level: publish },
    { action: "reply_public", label: "Customer / public reply", level: "recommend" },
    { action: "spend", label: "Spend money", level: "require_ceo" },
    { action: "hire", label: "Hire AI employees", level: "require_ceo" },
    { action: "infra", label: "Infra / connectors", level: "require_ceo" },
  ];
}

export function buildGenericOperatingModel({ companyType = "general_ops", label = "General operations" } = {}) {
  const id = String(companyType || "general_ops");
  const isTrading = id.includes("trad");
  const isTalent = id.includes("talent") || id.includes("job");
  const isSaas = id.includes("saas");

  let loops = [
    {
      id: "daily_standup_ops",
      name: "Daily coordination loop",
      description: "COO coordinates specialty work; surface blockers to CEO.",
      cadence: "daily",
      owner_roles: ["COO"],
      steps: ["gather", "plan", "delegate", "report"],
      critical_day1: true,
      primary_agent_role: "COO",
    },
    {
      id: "weekly_rollup",
      name: "Weekly CEO rollup",
      description: "Summarize wins, risks, token/cost pressure.",
      cadence: "weekly",
      owner_roles: ["COO"],
      steps: ["gather", "summarize", "notify_ceo"],
      critical_day1: false,
      primary_agent_role: "COO",
    },
  ];
  let daily_tasks = [
    {
      agent_name: "COO",
      tasks: [
        "Review open Kanban and reassign if stuck",
        "Delegate specialty work to specialists under you",
        "Notify CEO of decisions that hit autonomy gates",
      ],
    },
  ];
  let weekly_rituals = ["Weekly CEO digest from COO", "Systems readiness check"];
  let channels = [];
  let systems_run = [
    { id: "kanban", label: "Kanban", path: "/kanban", required: true },
    { id: "browser_session", label: "Browser Session", path: "/browser-session", required: false },
  ];
  let quality_bars = [
    "Align work with mission and company policy",
    "Never spend or publish externally without autonomy matrix permission",
  ];

  if (isTrading) {
    loops = [
      {
        id: "daily_market_plan",
        name: "Daily market plan",
        description: "Plan paper/live-safe actions; risk first.",
        cadence: "daily",
        owner_roles: ["Maker", "Checker", "COO"],
        steps: ["plan", "check", "execute_if_allowed", "log"],
        critical_day1: true,
        primary_agent_role: "COO",
      },
      ...loops.slice(1),
    ];
    systems_run.push({ id: "ibkr", label: "IBKR / trading tools", path: "/connectors", required: false });
    quality_bars.push("Paper mode until CEO authorizes live");
  } else if (isTalent) {
    loops = [
      {
        id: "applicant_pipeline",
        name: "Applicant pipeline",
        description: "Screen, score, escalate to CEO for outreach.",
        cadence: "daily",
        owner_roles: ["Recruiter", "COO"],
        steps: ["source", "screen", "score", "ceo_gate", "log"],
        critical_day1: true,
        primary_agent_role: "COO",
      },
      ...loops.slice(1),
    ];
  } else if (isSaas) {
    loops = [
      {
        id: "product_ops",
        name: "Product ops loop",
        description: "Prioritize backlog, research, draft updates; CEO for external announcements.",
        cadence: "daily",
        owner_roles: ["Product", "COO"],
        steps: ["prioritize", "research", "draft", "notify"],
        critical_day1: true,
        primary_agent_role: "COO",
      },
      ...loops.slice(1),
    ];
  }

  return {
    id,
    label,
    loops,
    daily_tasks,
    weekly_rituals,
    autonomy_matrix: baseMatrix("after_approval"),
    channels,
    systems_run,
    quality_bars,
    raci: [
      { activity: "Daily ops", responsible: "COO", accountable: "CEO", consulted: "Specialists", informed: "Team" },
      { activity: "External action", responsible: "Specialist", accountable: "CEO", consulted: "COO", informed: "Ops" },
    ],
    knowledge_seeds: [
      {
        name: "ops_runbook",
        description: "Day-1 company run notes.",
        columns: ["item", "owner", "cadence", "status", "notes"],
        seed_rows: [
          { item: "Daily coordination", owner: "COO", cadence: "daily", status: "active", notes: "From operating model" },
        ],
      },
    ],
    digest: {
      mode: "daily",
      channel: "in_app",
      include: ["open kanban", "gates waiting on CEO", "system readiness"],
    },
    escalations: {
      public_risk: "notify_ceo and pause external action",
      budget: "require_ceo",
      connector_down: "mark readiness; continue offline planning",
    },
  };
}

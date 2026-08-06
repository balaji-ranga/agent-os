/**
 * Fixed operate catalog for LLM selection + AGENTS.md channel/system sections.
 */

const CHANNEL_PRESETS = [
  { id: "facebook", label: "Facebook" },
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "blog", label: "Blog CMS" },
  { id: "twitter", label: "X / Twitter" },
  { id: "tiktok", label: "TikTok" },
  { id: "youtube", label: "YouTube" },
];

/**
 * Fixed catalog text + selection rules for LLM operate design.
 */
export function buildOperateCatalogForLlm() {
  const platformNative = [
    {
      id: "browser_session",
      how: "Browser Session",
      path: "/browser-session",
      use: "Social sites and any site login (FB/IG/LI/blog/CMS). Use browse_* when ready. NOT OpenConnector OAuth for Meta/social.",
    },
    {
      id: "kanban",
      how: "Platform native",
      path: "/kanban",
      use: "Agent tasks, approvals, handoffs. Always include.",
    },
    {
      id: "master_data",
      how: "Platform native",
      path: "/master-data",
      use: "Company knowledge tables and RAG documents.",
    },
    {
      id: "policies",
      how: "Platform native",
      path: "/policies",
      use: "CEO guardrails written into POLICY.",
    },
    {
      id: "replicate",
      how: "BYOK API Keys",
      path: "/api-keys",
      use: "Optional image/video gen via Replicate key.",
    },
    {
      id: "slack",
      how: "Agent messaging channels",
      path: "/ai-employees",
      use: "Slack binding for agent inbox (not public social publish).",
    },
  ];
  const openConnector = [
    { id: "gmail", how: "OpenConnector / Connectors", path: "/connectors", use: "Email once linked." },
    { id: "notion", how: "OpenConnector / Connectors", path: "/connectors", use: "Docs when OC app linked." },
    { id: "github", how: "OpenConnector / Connectors", path: "/connectors", use: "Repos when linked." },
    { id: "jira", how: "OpenConnector / Connectors", path: "/connectors", use: "Issues when linked." },
    { id: "google_drive", how: "OpenConnector / Connectors", path: "/connectors", use: "Files when linked." },
    { id: "hubspot", how: "OpenConnector / Connectors", path: "/connectors", use: "CRM when linked." },
    { id: "m365", how: "OpenConnector / Connectors", path: "/connectors", use: "Microsoft 365 when linked." },
    { id: "aws", how: "OpenConnector / Connectors", path: "/connectors", use: "Cloud when linked." },
    { id: "azure", how: "OpenConnector / Connectors", path: "/connectors", use: "Cloud when linked." },
    { id: "ibkr", how: "OpenConnector / Connectors", path: "/connectors", use: "Trading tools — trading companies only." },
  ];

  const lines = [
    "AVAILABLE SYSTEMS (prefer ids from this catalog):",
    "",
    "A) Platform / Browser (prefer for social and core operate):",
    ...platformNative.map(
      (s) => `- id=${s.id} | how=${s.how} | path=${s.path} | ${s.use}`
    ),
    "",
    "B) OpenConnector-style SaaS (path=/connectors — only if useful; CEO links later; never claim connected):",
    ...openConnector.map(
      (s) => `- id=${s.id} | how=${s.how} | path=${s.path} | ${s.use}`
    ),
    "",
    "AVAILABLE CHANNEL PRESETS (public destinations; system_id=browser_session for social/web):",
    ...CHANNEL_PRESETS.map(
      (c) =>
        `- id=${c.id} label=${c.label} path=/browser-session system_id=browser_session — login/publish via Browser Session until native API`
    ),
    "",
    "SELECTION RULES:",
    "1) Always include kanban in systems_run.",
    "2) Social/marketing/publish/community → systems_run browser_session + matching channels with system_id browser_session.",
    "3) OpenConnector ids only for SaaS productivity (gmail/notion/github/...) — NEVER for Facebook/Instagram/LinkedIn as OAuth apps.",
    "4) Prefer CEO setup systems when they appear in this catalog.",
    "5) Max ~8 systems_run and ~8 channels unless multi-surface media.",
    "6) Do not invent systems outside this catalog unless CEO text clearly requires a custom connector (path=/connectors).",
  ];
  return lines.join("\n");
}

/**
 * Markdown block embedded in agent AGENTS.md on Day 1.
 */
export function buildChannelsSystemsMdSection(model, { agentName = "" } = {}) {
  const name = String(agentName || "").trim().toLowerCase();
  const systems = Array.isArray(model?.systems_run) ? model.systems_run : [];
  const channels = Array.isArray(model?.channels) ? model.channels : [];
  const goals = Array.isArray(model?.goals) ? model.goals : [];

  const sysLines = systems.length
    ? systems.map((s) => {
        const ready = s.readiness || "not_ready";
        const req = s.required ? "required" : "optional";
        return `- **${s.label || s.id}** (\`${s.id}\`) — via \`${s.path || "/connectors"}\` · ${req} · readiness: **${ready}**`;
      })
    : ["- (none listed — use Kanban and CEO guidance)"];

  const chLines = channels.length
    ? channels.map((c) => {
        const ready = c.readiness || "not_ready";
        const owner = c.owner_role || "COO";
        const ownerLc = String(owner).toLowerCase();
        const first = (ownerLc.split(/\s+/)[0] || "___");
        const mine =
          !!name &&
          (ownerLc === name || ownerLc.includes(name) || name.includes(first));
        const own = mine ? " **← you own / primary**" : "";
        const via =
          c.system_id ||
          (String(c.path || "").includes("browser") ? "browser_session" : "connectors");
        return `- **${c.label || c.id}** — owner: ${owner}${own} · via **${via}** (\`${c.path || "/browser-session"}\`) · readiness: **${ready}**`;
      })
    : ["- (no public channels listed — do not invent live posts on unknown platforms)"];

  const goalLines = goals.length
    ? goals.map((g) => {
        const ready = g.readiness || "not_ready";
        const owner = g.owner_role || "CEO";
        const ownerLc = String(owner).toLowerCase();
        const first = (ownerLc.split(/\s+/)[0] || "___");
        const mine =
          !!name &&
          (ownerLc === name || ownerLc.includes(name) || name.includes(first) || (name.includes("coo") && ownerLc === "coo"));
        const own = mine ? " **← you own / primary**" : "";
        const req = g.required === false ? "optional" : "required";
        return `- **${g.label || g.id}** (\`${g.id}\`) — owner: ${owner}${own} · ${g.cadence || "weekly"} · ${req} · readiness: **${ready}** · \`${g.path || "/scheduled-goals"}\`${g.note ? ` — ${g.note}` : ""}`;
      })
    : [
        "- (no operate goals listed — for content companies, CEO must still set a weekly content goal before production)",
      ];

  return [
    "### Company systems (Day-1 operate)",
    "These are the systems this company plans to use. Respect readiness: if **not_ready** or **setup_later**, do not assume the integration works — use Kanban / notify_ceo instead of forcing a live action.",
    ...sysLines,
    "",
    "### Company channels / public surfaces (Day-1 operate)",
    "These are the public destinations in the operating model. **Same list for every employee** so handoffs are clear.",
    "- If readiness is not **ready**, treat publish/reply as blocked unless the CEO marks ready or finishes Browser Session / Connectors setup.",
    "- Social / website channels use **Browser Session** tools when ready — not fake OpenConnector OAuth for social networks.",
    "- If you are the **owner**, plan and execute work for that surface (still obey autonomy gates).",
    ...chLines,
    "",
    "### Company goals (Day-1 operate)",
    "Goals are tracked with the same honesty as systems and channels. Content **topics** come from CEO goals — not agent invention.",
    "- **Weekly content goal:** CEO sets via Scheduled goals (`/scheduled-goals`) targeting the **COO**, or an explicit brief.",
    "- **COO:** when a goal is live, **agent_workflow_trigger** the Operate content production loop with the goal as input. Content loops are **manual/event** (no silent cron).",
    "- **Topic memory:** before drafting or publishing, query Master Data **content_topics_history**. Do **not** reuse title, theme, or near-duplicate angle within **20 days**. Log every approved draft / publish attempt with date, platform, title, topic, fingerprint.",
    ...goalLines,
  ].join("\n");
}

/**
 * Thin company blueprints (Phase C) — light packs for non-flagship types.
 */
function pack(id, label, description, departments, agents, workflows, channels) {
  return {
    id,
    label,
    description,
    depth: "thin",
    aliases: [],
    departments,
    agents,
    workflows,
    channels,
    knowledge_tables: [],
    sop_documents: [],
    systems_recommended: [
      { id: "workspace", label: "AI Employees", path: "/workspace" },
      { id: "knowledge", label: "Knowledge (Master Data)", path: "/master-data" },
      { id: "policies", label: "Policies", path: "/policies" },
    ],
    policy_templates: {
      suggest: "## Management style: AI suggests\n- Drafts only; CEO decides.\n- Use notify_ceo for handoffs.",
      after_approval: "## Management style: AI executes after approval\n- Execute after CEO approval on material actions.\n- Use Kanban for gated work.",
      autonomous: "## Management style: AI executes autonomously\n- Execute within tool grants and budgets.\n- Escalate risk via notify_ceo.",
    },
  };
}

export const thinBlueprints = {
  general_ops: pack(
    "general_ops",
    "General operations",
    "Lean AI company for day-to-day research and ops coordination.",
    [
      { name: "Executive", purpose: "Direction, priorities, and approvals." },
      { name: "Research", purpose: "Market and technical research briefs." },
      { name: "Operations", purpose: "Day-to-day execution and coordination." },
    ],
    [
      {
        name: "Research Analyst",
        role: "Research briefs and summaries",
        department: "Research",
        tools: ["learnings_summary", "master_data_rag", "summarize_url", "notify_ceo"],
      },
      {
        name: "Ops Coordinator",
        role: "Track tasks and follow-through",
        department: "Operations",
        tools: ["learnings_summary", "kanban_create_task", "kanban_move_status", "notify_ceo"],
      },
    ],
    ["CEO request -> COO delegate -> Kanban track -> standup rollup"],
    ["Start with Home chat; add WhatsApp when ready.", "Set budgets under Efficiency."]
  ),
  talent: pack(
    "talent",
    "Talent / hiring",
    "Screen and track applicants with AI specialists.",
    [
      { name: "Job Pipeline", purpose: "Sourcing, screening, and candidate tracking." },
      { name: "Operations", purpose: "Scheduling, coordination, and handoffs." },
    ],
    [
      {
        name: "Talent Screener",
        role: "Screen applicants and summarize fit",
        department: "Job Pipeline",
        tools: ["learnings_summary", "master_data_rag", "kanban_create_task", "notify_ceo"],
      },
      {
        name: "Pipeline Coordinator",
        role: "Track stages and follow-ups",
        department: "Operations",
        tools: ["learnings_summary", "kanban_create_task", "kanban_move_status", "email_send"],
      },
    ],
    ["Inbound resume -> screen -> interview pack -> decision"],
    ["Job profiles / Job workflows for full applicant pipeline."]
  ),
  trading_ops: pack(
    "trading_ops",
    "Trading operations",
    "Research and risk monitoring specialists for markets.",
    [
      { name: "Research", purpose: "Market research and signal briefs." },
      { name: "Finance", purpose: "Risk, P&L, and reporting." },
      { name: "Operations", purpose: "Execution coordination and compliance checks." },
    ],
    [
      {
        name: "Market Analyst",
        role: "Research and daily market briefs",
        department: "Research",
        tools: ["learnings_summary", "master_data_rag", "summarize_url", "notify_ceo"],
      },
      {
        name: "Risk Monitor",
        role: "Exposure checks and alerts",
        department: "Finance",
        tools: ["learnings_summary", "notify_ceo", "master_data_rag"],
      },
    ],
    ["Morning brief -> risk check -> COO escalation on breach"],
    ["Store playbooks in Knowledge for RAG."]
  ),
  saas: pack(
    "saas",
    "SaaS startup",
    "Product/growth-oriented AI org (thin starter).",
    [
      { name: "Product", purpose: "Roadmap and customer problem clarity." },
      { name: "Growth", purpose: "Acquisition and messaging." },
      { name: "Operations", purpose: "Process and coordination." },
    ],
    [
      {
        name: "Product Analyst",
        role: "Synthesize user and market signals",
        department: "Product",
        tools: ["learnings_summary", "master_data_rag", "summarize_url", "notify_ceo"],
      },
      {
        name: "Growth Writer",
        role: "Draft GTM and customer messaging",
        department: "Growth",
        tools: ["learnings_summary", "master_data_rag", "generate_image", "notify_ceo"],
      },
    ],
    ["Idea -> research brief -> growth draft -> CEO review"],
    ["Connect product tools via Connectors when ready."]
  ),
  blank: pack(
    "blank",
    "Blank company",
    "Minimal org — you hire AI employees later.",
    [{ name: "Operations", purpose: "General coordination." }],
    [
      {
        name: "Ops Coordinator",
        role: "Track work and follow-through",
        department: "Operations",
        tools: ["learnings_summary", "kanban_create_task", "notify_ceo", "master_data_rag"],
      },
    ],
    ["CEO request -> Kanban -> notify on completion"],
    ["Hire more AI employees under AI Employees."]
  ),
};

export const COMPANY_TYPE_CARDS = [
  { id: "content_creator", label: "Content Creator (Social media)", featured: true, depth: "deep" },
  { id: "saas", label: "SaaS Startup", featured: false, depth: "thin" },
  { id: "general_ops", label: "Consultancy / General ops", featured: false, depth: "thin" },
  { id: "talent", label: "Talent / hiring", featured: false, depth: "thin" },
  { id: "trading_ops", label: "Investment / trading", featured: false, depth: "thin" },
  { id: "blank", label: "Blank company", featured: false, depth: "thin" },
  { id: "restaurant", label: "Restaurant", featured: false, depth: "thin", maps_to: "general_ops" },
  { id: "retail", label: "Retail store", featured: false, depth: "thin", maps_to: "general_ops" },
  { id: "real_estate", label: "Real estate", featured: false, depth: "thin", maps_to: "general_ops" },
  { id: "education", label: "Education", featured: false, depth: "thin", maps_to: "general_ops" },
  { id: "healthcare", label: "Healthcare clinic", featured: false, depth: "thin", maps_to: "general_ops" },
  { id: "bank", label: "Bank", featured: false, depth: "thin", maps_to: "general_ops" },
];

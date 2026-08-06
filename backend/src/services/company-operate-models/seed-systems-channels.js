/**
 * Seed / enrich systems_run + channels for operating models.
 * Template packs already define lists; LLM path uses LLM output, then
 * Company Setup systems + design-time channel names as fillers.
 */

const KNOWN_SYSTEMS = {
  browser_session: {
    id: "browser_session",
    label: "Browser Session (social / site logins)",
    path: "/browser-session",
    required: true,
  },
  kanban: {
    id: "kanban",
    label: "Kanban board (agent tasks / approvals)",
    path: "/kanban",
    required: true,
  },
  replicate: {
    id: "replicate",
    label: "Image / video gen (Replicate BYOK)",
    path: "/api-keys",
    required: false,
  },
  gmail: { id: "gmail", label: "Gmail / Email", path: "/connectors", required: false },
  slack: {
    id: "slack",
    label: "Slack (agent channels)",
    path: "/ai-employees",
    required: false,
  },
  notion: { id: "notion", label: "Notion", path: "/connectors", required: false },
  github: { id: "github", label: "GitHub", path: "/connectors", required: false },
  jira: { id: "jira", label: "Jira", path: "/connectors", required: false },
  google_drive: {
    id: "google_drive",
    label: "Google Drive",
    path: "/connectors",
    required: false,
  },
  hubspot: { id: "hubspot", label: "HubSpot", path: "/connectors", required: false },
  m365: { id: "m365", label: "Microsoft 365", path: "/connectors", required: false },
  aws: { id: "aws", label: "AWS", path: "/connectors", required: false },
  azure: { id: "azure", label: "Azure", path: "/connectors", required: false },
  ibkr: { id: "ibkr", label: "IBKR / trading tools", path: "/connectors", required: false },
  master_data: {
    id: "master_data",
    label: "Master Data / knowledge",
    path: "/master-data",
    required: false,
  },
  policies: {
    id: "policies",
    label: "Company Policies",
    path: "/policies",
    required: false,
  },
};

const SOCIAL_CHANNEL_HINTS = [
  { id: "facebook", label: "Facebook", keywords: ["facebook", "fb", "meta"] },
  { id: "instagram", label: "Instagram", keywords: ["instagram", "ig"] },
  { id: "linkedin", label: "LinkedIn", keywords: ["linkedin", "li"] },
  { id: "blog", label: "Blog CMS", keywords: ["blog", "wordpress", "cms", "webflow"] },
  { id: "twitter", label: "X / Twitter", keywords: ["twitter", "x.com", " x "] },
  { id: "tiktok", label: "TikTok", keywords: ["tiktok"] },
  { id: "youtube", label: "YouTube", keywords: ["youtube", "yt"] },
];

function slugify(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || `item_${Date.now().toString(36)}`;
}

function systemFromId(id, labelHint = "") {
  const key = String(id || "").trim().toLowerCase();
  if (KNOWN_SYSTEMS[key]) {
    return { ...KNOWN_SYSTEMS[key], readiness: "not_ready" };
  }
  if (!key) return null;
  const isBrowser =
    key.includes("browser") || key.includes("chrome") || key.includes("session");
  return {
    id: key.slice(0, 40),
    label: String(labelHint || key).replace(/_/g, " ").slice(0, 80),
    path: isBrowser ? "/browser-session" : "/connectors",
    required: false,
    readiness: "not_ready",
  };
}

function channelFromName(name, ownerRole = "COO") {
  const label = String(name || "").trim().slice(0, 80);
  if (!label) return null;
  const lower = ` ${label.toLowerCase()} `;
  for (const hint of SOCIAL_CHANNEL_HINTS) {
    if (hint.keywords.some((k) => lower.includes(k) || label.toLowerCase() === k)) {
      return {
        id: hint.id,
        label: hint.label,
        owner_role: ownerRole,
        path: "/browser-session",
        system_id: "browser_session",
        readiness: "not_ready",
      };
    }
  }
  const id = slugify(label);
  return {
    id,
    label,
    owner_role: ownerRole,
    path: "/browser-session",
    system_id: "browser_session",
    readiness: "not_ready",
  };
}

function mergeSystems(list, extra) {
  const out = [];
  const seen = new Set();
  for (const s of [...(list || []), ...(extra || [])]) {
    if (!s?.id) continue;
    const id = String(s.id).slice(0, 40);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: String(s.label || id).slice(0, 80),
      path: String(s.path || "/connectors").slice(0, 120),
      required: !!s.required,
      readiness: ["not_ready", "setup_later", "ready"].includes(s.readiness)
        ? s.readiness
        : "not_ready",
    });
  }
  return out.slice(0, 20);
}

function mergeChannels(list, extra) {
  const out = [];
  const seen = new Set();
  for (const c of [...(list || []), ...(extra || [])]) {
    if (!c?.id && !c?.label) continue;
    const id = String(c.id || slugify(c.label)).slice(0, 40);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: String(c.label || id).slice(0, 80),
      owner_role: String(c.owner_role || "COO").slice(0, 80),
      path: String(c.path || "/browser-session").slice(0, 120),
      system_id: String(c.system_id || "browser_session").slice(0, 40),
      readiness: ["not_ready", "setup_later", "ready"].includes(c.readiness)
        ? c.readiness
        : "not_ready",
    });
  }
  return out.slice(0, 16);
}

/**
 * @param {object} model
 * @param {object} ctx
 * @param {string} [ctx.design_source] - template | llm | template_fallback | ...
 * @param {string[]} [ctx.setup_systems] - strategic.systems from company setup
 * @param {string[]|object[]} [ctx.org_channels] - channels from company setup design
 * @param {string} [ctx.company_type]
 * @param {boolean} [ctx.force_setup_merge] - also merge when source is template
 */
export function seedSystemsAndChannels(model, ctx = {}) {
  const m = model && typeof model === "object" ? { ...model } : {};
  const designSource = String(ctx.design_source || "").toLowerCase();
  const fromLlm = designSource.startsWith("llm");
  const mergeSetup = fromLlm || ctx.force_setup_merge === true;

  let systems = Array.isArray(m.systems_run) ? [...m.systems_run] : [];
  let channels = Array.isArray(m.channels) ? [...m.channels] : [];

  if (mergeSetup) {
    const setupSystems = (Array.isArray(ctx.setup_systems) ? ctx.setup_systems : [])
      .map((id) => systemFromId(id))
      .filter(Boolean);
    // Always keep baseline kanban for operate
    setupSystems.push(systemFromId("kanban"));
    systems = mergeSystems(systems, setupSystems);

    const orgChannelNames = Array.isArray(ctx.org_channels) ? ctx.org_channels : [];
    const channelSeeds = orgChannelNames
      .map((c) => {
        if (c && typeof c === "object") {
          return channelFromName(c.label || c.id || c.name, c.owner_role);
        }
        return channelFromName(c);
      })
      .filter(Boolean);

    // LLM-primary: if model already has channels, keep and only append setup names not present.
    // If empty after LLM, seed from org design channel names + browser_session presence.
    if (fromLlm && channels.length === 0) {
      channels = mergeChannels([], channelSeeds);
      if (
        channels.length === 0 &&
        systems.some((s) => s.id === "browser_session")
      ) {
        // Soft default social/web pack when LLM forgot channels but asked for browser session
        channels = mergeChannels(
          [],
          ["Facebook", "Instagram", "LinkedIn", "Blog CMS"].map((n) => channelFromName(n, "Channel Publisher"))
        );
      }
    } else if (fromLlm && channelSeeds.length) {
      channels = mergeChannels(channels, channelSeeds);
    }
  }

  m.systems_run = mergeSystems(systems, []);
  m.channels = mergeChannels(channels, []);
  return m;
}

export { KNOWN_SYSTEMS, systemFromId, channelFromName };

/**
 * Operating model templates registry (Phase D Day 0).
 */
import { contentCreatorOperatingModel } from "./content-creator.js";
import { buildGenericOperatingModel } from "./generic.js";
import {
  getBlueprint,
  hasDedicatedCompanyTemplate,
  resolveCompanyTypeId,
} from "../company-blueprints/index.js";

const DEEP = {
  content_creator: contentCreatorOperatingModel,
  content_studio: contentCreatorOperatingModel,
  youtube_creator: contentCreatorOperatingModel,
  social_media: contentCreatorOperatingModel,
  marketing_agency: contentCreatorOperatingModel,
};

/**
 * Clone template and attach default readiness fields.
 */
export function getOperatingModelTemplate(companyType, { management_style } = {}) {
  const key = resolveCompanyTypeId(companyType);
  const bp = getBlueprint(key);
  let base;
  if (DEEP[key] || DEEP[bp?.id]) {
    base = structuredClone(DEEP[key] || DEEP[bp.id]);
  } else {
    base = buildGenericOperatingModel({
      companyType: key,
      label: `${bp?.label || key} operations`,
    });
  }
  // apply management style bias lightly
  const style = String(management_style || "").trim();
  if (style && Array.isArray(base.autonomy_matrix)) {
    base.autonomy_matrix = base.autonomy_matrix.map((row) => {
      if (style === "suggest" && (row.action === "publish" || row.action === "reply_public")) {
        return { ...row, level: "require_ceo" };
      }
      if (style === "autonomous" && row.action === "publish") {
        return { ...row, level: "recommend" };
      }
      return row;
    });
  }
  return attachReadinessDefaults(base);
}

export function attachReadinessDefaults(model) {
  const m = model && typeof model === "object" ? structuredClone(model) : {};
  m.channels = (m.channels || []).map((c) => ({
    ...c,
    readiness: c.readiness || "not_ready",
  }));
  m.systems_run = (m.systems_run || []).map((s) => ({
    ...s,
    readiness: s.readiness || "not_ready",
  }));
  return m;
}

export function hasOperateTemplate(companyType) {
  const key = resolveCompanyTypeId(companyType);
  if (DEEP[key]) return true;
  // thin packs still get template skeletons
  if (hasDedicatedCompanyTemplate(key)) return true;
  return true; // generic always available
}

export function shouldUseLlmOperateDesign(companyType, { force } = {}) {
  if (force === "llm") return true;
  if (force === "template") return false;
  const key = resolveCompanyTypeId(companyType);
  // Content creator + deep/thin dedicated packs prefer template
  if (DEEP[key] || hasDedicatedCompanyTemplate(key)) return false;
  // Custom/general: prefer LLM for richer operate design
  return key === "general_ops" || key === "blank";
}

export function sanitizeOperatingModel(raw, fallback) {
  const base = fallback || getOperatingModelTemplate("general_ops");
  const src = raw && typeof raw === "object" ? raw : {};
  const levels = new Set(["auto", "recommend", "require_ceo"]);

  const loops = (Array.isArray(src.loops) ? src.loops : base.loops || [])
    .slice(0, 12)
    .map((l, i) => ({
      id: String(l?.id || `loop_${i + 1}`).slice(0, 64),
      name: String(l?.name || `Loop ${i + 1}`).slice(0, 120),
      description: String(l?.description || "").slice(0, 500),
      cadence: ["daily", "weekly", "event"].includes(l?.cadence) ? l.cadence : "daily",
      owner_roles: (Array.isArray(l?.owner_roles) ? l.owner_roles : [])
        .map((r) => String(r).slice(0, 80))
        .filter(Boolean)
        .slice(0, 8),
      steps: (Array.isArray(l?.steps) ? l.steps : [])
        .map((s) => String(s).slice(0, 80))
        .filter(Boolean)
        .slice(0, 12),
      critical_day1: l?.critical_day1 === false ? false : l?.critical_day1 === true ? true : true,
      primary_agent_role: String(l?.primary_agent_role || l?.owner_roles?.[0] || "COO").slice(0, 80),
    }));

  const daily_tasks = (Array.isArray(src.daily_tasks) ? src.daily_tasks : base.daily_tasks || [])
    .slice(0, 20)
    .map((d) => ({
      agent_name: String(d?.agent_name || d?.name || "").slice(0, 80),
      tasks: (Array.isArray(d?.tasks) ? d.tasks : [])
        .map((t) => String(t).slice(0, 240))
        .filter(Boolean)
        .slice(0, 12),
    }))
    .filter((d) => d.agent_name);

  const autonomy_matrix = (Array.isArray(src.autonomy_matrix) ? src.autonomy_matrix : base.autonomy_matrix || [])
    .slice(0, 16)
    .map((a) => ({
      action: String(a?.action || "").slice(0, 40),
      label: String(a?.label || a?.action || "").slice(0, 80),
      level: levels.has(a?.level) ? a.level : "require_ceo",
    }))
    .filter((a) => a.action);

  const channels = (Array.isArray(src.channels) ? src.channels : base.channels || []).slice(0, 16).map((c) => ({
    id: String(c?.id || "").slice(0, 40),
    label: String(c?.label || c?.id || "").slice(0, 80),
    owner_role: String(c?.owner_role || "").slice(0, 80),
    path: String(c?.path || "/browser-session").slice(0, 120),
    system_id: String(c?.system_id || "browser_session").slice(0, 40),
    readiness: ["not_ready", "setup_later", "ready"].includes(c?.readiness) ? c.readiness : "not_ready",
  }));

  const systems_run = (Array.isArray(src.systems_run) ? src.systems_run : base.systems_run || [])
    .slice(0, 20)
    .map((s) => ({
      id: String(s?.id || "").slice(0, 40),
      label: String(s?.label || s?.id || "").slice(0, 80),
      path: String(s?.path || "/connectors").slice(0, 120),
      required: !!s?.required,
      readiness: ["not_ready", "setup_later", "ready"].includes(s?.readiness) ? s.readiness : "not_ready",
    }));

  return attachReadinessDefaults({
    id: String(src.id || base.id || "ops").slice(0, 64),
    label: String(src.label || base.label || "Operating model").slice(0, 120),
    loops: loops.length ? loops : base.loops,
    daily_tasks: daily_tasks.length ? daily_tasks : base.daily_tasks,
    weekly_rituals: (Array.isArray(src.weekly_rituals) ? src.weekly_rituals : base.weekly_rituals || [])
      .map((x) => String(x).slice(0, 200))
      .filter(Boolean)
      .slice(0, 12),
    autonomy_matrix: autonomy_matrix.length ? autonomy_matrix : base.autonomy_matrix,
    channels,
    systems_run,
    quality_bars: (Array.isArray(src.quality_bars) ? src.quality_bars : base.quality_bars || [])
      .map((x) => String(x).slice(0, 200))
      .filter(Boolean)
      .slice(0, 12),
    raci: (Array.isArray(src.raci) ? src.raci : base.raci || []).slice(0, 12).map((r) => ({
      activity: String(r?.activity || "").slice(0, 80),
      responsible: String(r?.responsible || "").slice(0, 80),
      accountable: String(r?.accountable || "").slice(0, 80),
      consulted: String(r?.consulted || "").slice(0, 80),
      informed: String(r?.informed || "").slice(0, 80),
    })),
    knowledge_seeds: Array.isArray(src.knowledge_seeds) ? src.knowledge_seeds : base.knowledge_seeds || [],
    digest: src.digest && typeof src.digest === "object" ? src.digest : base.digest || { mode: "daily", channel: "in_app" },
    escalations: src.escalations && typeof src.escalations === "object" ? src.escalations : base.escalations || {},
  });
}

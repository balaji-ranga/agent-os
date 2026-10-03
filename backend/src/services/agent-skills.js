import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const PLATFORM_OWNER = '__platform__';
const MAX_SKILL_MD_BYTES = 128 * 1024;
const MANAGED_MARKER = '.flolah-skill.json';
let schemaReady = false;
let platformSeeded = false;

function db() {
  ensureAgentSkillsSchema();
  return getDb();
}

function json(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function stringList(value, limit = 64) {
  const rows = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]/);
  return [...new Set(rows.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, limit);
}

function slugify(value) {
  const slug = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!slug) throw new Error('Skill slug or name is required');
  return slug;
}

function validateSkillMarkdown(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('SKILL.md content is required');
  if (Buffer.byteLength(text, 'utf8') > MAX_SKILL_MD_BYTES) {
    throw new Error(`SKILL.md exceeds ${MAX_SKILL_MD_BYTES / 1024} KB`);
  }
  if (text.includes('\0')) throw new Error('SKILL.md contains invalid null bytes');
  return `${text}\n`;
}

function checksum(text) {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function frontmatter(text) {
  const block = String(text || '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---/i)?.[1] || '';
  const pick = (key) => block.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'im'))?.[1]?.trim() || '';
  return { name: pick('name'), description: pick('description') };
}

export function ensureAgentSkillsSchema() {
  if (schemaReady) return;
  const conn = getDb();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS agent_skills (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'company' CHECK (scope IN ('platform','company')),
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
      source_kind TEXT NOT NULL DEFAULT 'company' CHECK (source_kind IN ('platform','company','imported')),
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, slug)
    );
    CREATE TABLE IF NOT EXISTS agent_skill_versions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      skill_md TEXT NOT NULL,
      trigger_hints_json TEXT DEFAULT '[]',
      required_tools_json TEXT DEFAULT '[]',
      required_connector_actions_json TEXT DEFAULT '[]',
      required_mcp_tools_json TEXT DEFAULT '[]',
      checksum TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(skill_id, version),
      FOREIGN KEY (skill_id) REFERENCES agent_skills(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS agent_skill_assignments (
      owner_user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      version_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 100,
      auto_select INTEGER NOT NULL DEFAULT 1,
      assigned_by TEXT DEFAULT '',
      assigned_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_user_id, agent_id, skill_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES agent_skills(id) ON DELETE CASCADE,
      FOREIGN KEY (version_id) REFERENCES agent_skill_versions(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS agent_skill_execution_audit (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      work_unit_id TEXT,
      goal_run_id TEXT,
      goal_step_id TEXT,
      delegation_task_id INTEGER,
      selected_by TEXT NOT NULL DEFAULT 'agent',
      skill_refs_json TEXT NOT NULL DEFAULT '[]',
      selection_reason TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'selected',
      evidence_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_skills_owner ON agent_skills(owner_user_id, status, name);
    CREATE INDEX IF NOT EXISTS idx_agent_skill_assignments_agent ON agent_skill_assignments(owner_user_id, agent_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_agent_skill_audit_work ON agent_skill_execution_audit(owner_user_id, agent_id, created_at DESC);
  `);
  const versionColumns = new Set(conn.prepare('PRAGMA table_info(agent_skill_versions)').all().map((row) => row.name));
  if (!versionColumns.has('required_mcp_tools_json')) {
    conn.exec("ALTER TABLE agent_skill_versions ADD COLUMN required_mcp_tools_json TEXT DEFAULT '[]'");
  }
  schemaReady = true;
}

function platformSkillDirs() {
  const dirs = [];
  const sharedRoot = join(REPO_ROOT, 'openclaw-skills');
  if (existsSync(sharedRoot)) {
    for (const entry of readdirSync(sharedRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(sharedRoot, entry.name, 'SKILL.md'))) {
        dirs.push({ slug: entry.name, path: join(sharedRoot, entry.name, 'SKILL.md') });
      }
    }
  }
  const ibkr = join(REPO_ROOT, '.cursor', 'skills', 'ibkrnew-trade-strategy', 'SKILL.md');
  if (existsSync(ibkr)) dirs.push({ slug: 'ibkrnew-trade-strategy', path: ibkr });
  return dirs;
}

export function seedPlatformAgentSkills({ force = false } = {}) {
  ensureAgentSkillsSchema();
  if (platformSeeded && !force) return { seeded: 0, unchanged: 0 };
  const conn = getDb();
  let seeded = 0;
  let unchanged = 0;
  const tx = conn.transaction(() => {
    for (const source of platformSkillDirs()) {
      const skillMd = validateSkillMarkdown(readFileSync(source.path, 'utf8'));
      const meta = frontmatter(skillMd);
      const slug = slugify(source.slug);
      const id = `platform:${slug}`;
      const found = conn.prepare('SELECT * FROM agent_skills WHERE id=?').get(id);
      if (!found) {
        conn.prepare(`INSERT INTO agent_skills
          (id,owner_user_id,scope,slug,name,description,status,source_kind,created_by)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(
            id, PLATFORM_OWNER, 'platform', slug, meta.name || slug, meta.description || '', 'active', 'platform', 'source'
          );
      } else {
        conn.prepare(`UPDATE agent_skills SET name=?,description=?,status='active',updated_at=datetime('now') WHERE id=?`)
          .run(meta.name || found.name, meta.description || found.description || '', id);
      }
      const digest = checksum(skillMd);
      const latest = conn.prepare('SELECT * FROM agent_skill_versions WHERE skill_id=? ORDER BY version DESC LIMIT 1').get(id);
      if (latest?.checksum === digest) {
        unchanged += 1;
        continue;
      }
      const version = Number(latest?.version || 0) + 1;
      conn.prepare(`INSERT INTO agent_skill_versions
        (id,skill_id,version,skill_md,trigger_hints_json,required_tools_json,required_connector_actions_json,required_mcp_tools_json,checksum,status,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
          `${id}:v${version}`, id, version, skillMd, '[]', '[]', '[]', '[]', digest, 'active', 'source'
        );
      seeded += 1;
    }
  });
  tx();
  platformSeeded = true;
  return { seeded, unchanged };
}

function ensureSeeded() {
  ensureAgentSkillsSchema();
  seedPlatformAgentSkills();
}

function assertAgentForOwner(ownerUserId, agentId) {
  const row = db().prepare(`SELECT a.* FROM agents a
    JOIN user_agents ua ON ua.agent_id=a.id AND ua.user_id=? AND ua.enabled=1
    WHERE a.id=?`).get(ownerUserId, agentId);
  if (!row) {
    const error = new Error('Agent not found for this company');
    error.status = 404;
    throw error;
  }
  return row;
}

function skillAccessible(ownerUserId, skillId) {
  return db().prepare(`SELECT * FROM agent_skills
    WHERE id=? AND (owner_user_id=? OR scope='platform')`).get(skillId, ownerUserId);
}

function latestVersion(skillId, { activeOnly = true } = {}) {
  return db().prepare(`SELECT * FROM agent_skill_versions WHERE skill_id=? ${activeOnly ? "AND status='active'" : ''} ORDER BY version DESC LIMIT 1`).get(skillId);
}

function versionForAssignment(row) {
  if (row.version_id) {
    const pinned = db().prepare(`SELECT * FROM agent_skill_versions WHERE id=? AND skill_id=? AND status='active'`).get(row.version_id, row.skill_id);
    if (pinned) return pinned;
  }
  return latestVersion(row.skill_id);
}

function serializeSkill(skill, version = null) {
  return {
    id: skill.id,
    owner_user_id: skill.owner_user_id,
    scope: skill.scope,
    slug: skill.slug,
    name: skill.name,
    description: skill.description || '',
    status: skill.status,
    source_kind: skill.source_kind,
    version: version ? Number(version.version) : null,
    version_id: version?.id || null,
    skill_md: version?.skill_md || '',
    trigger_hints: json(version?.trigger_hints_json, []),
    required_tools: json(version?.required_tools_json, []),
    required_connector_actions: json(version?.required_connector_actions_json, []),
    required_mcp_tools: json(version?.required_mcp_tools_json, []),
    checksum: version?.checksum || null,
  };
}

export function listAgentSkillsCatalog(ownerUserId, { includeMarkdown = false } = {}) {
  ensureSeeded();
  const rows = db().prepare(`SELECT * FROM agent_skills
    WHERE (scope='platform' OR owner_user_id=?) AND status<>'retired'
    ORDER BY scope DESC,name`).all(ownerUserId);
  return rows.map((row) => {
    const value = serializeSkill(row, latestVersion(row.id));
    if (!includeMarkdown) delete value.skill_md;
    return value;
  });
}

export function createCompanySkill(ownerUserId, body = {}, actorId = '') {
  ensureSeeded();
  const name = String(body.name || '').trim().slice(0, 160);
  if (!name) throw new Error('Skill name is required');
  const slug = slugify(body.slug || name);
  const skillMd = validateSkillMarkdown(body.skill_md || body.skillMd);
  const id = `skill-${randomUUID()}`;
  const versionId = `${id}:v1`;
  const conn = db();
  conn.transaction(() => {
    conn.prepare(`INSERT INTO agent_skills
      (id,owner_user_id,scope,slug,name,description,status,source_kind,created_by)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
        id, ownerUserId, 'company', slug, name, String(body.description || '').trim().slice(0, 1000),
        body.status === 'draft' ? 'draft' : 'active', 'company', actorId
      );
    conn.prepare(`INSERT INTO agent_skill_versions
      (id,skill_id,version,skill_md,trigger_hints_json,required_tools_json,required_connector_actions_json,required_mcp_tools_json,checksum,status,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
        versionId, id, 1, skillMd,
        JSON.stringify(stringList(body.trigger_hints || body.triggerHints)),
        JSON.stringify(stringList(body.required_tools || body.requiredTools)),
        JSON.stringify(stringList(body.required_connector_actions || body.requiredConnectorActions)),
        JSON.stringify(stringList(body.required_mcp_tools || body.requiredMcpTools)),
        checksum(skillMd), body.status === 'draft' ? 'draft' : 'active', actorId
      );
  })();
  return serializeSkill(conn.prepare('SELECT * FROM agent_skills WHERE id=?').get(id), conn.prepare('SELECT * FROM agent_skill_versions WHERE id=?').get(versionId));
}

export function addCompanySkillVersion(ownerUserId, skillId, body = {}, actorId = '') {
  ensureSeeded();
  const skill = skillAccessible(ownerUserId, skillId);
  if (!skill || skill.scope !== 'company' || skill.owner_user_id !== ownerUserId) {
    const error = new Error('Company skill not found');
    error.status = 404;
    throw error;
  }
  const skillMd = validateSkillMarkdown(body.skill_md || body.skillMd);
  const prior = latestVersion(skillId, { activeOnly: false });
  const version = Number(prior?.version || 0) + 1;
  const versionId = `${skillId}:v${version}`;
  db().prepare(`INSERT INTO agent_skill_versions
    (id,skill_id,version,skill_md,trigger_hints_json,required_tools_json,required_connector_actions_json,required_mcp_tools_json,checksum,status,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      versionId, skillId, version, skillMd,
      JSON.stringify(stringList(body.trigger_hints || body.triggerHints)),
      JSON.stringify(stringList(body.required_tools || body.requiredTools)),
      JSON.stringify(stringList(body.required_connector_actions || body.requiredConnectorActions)),
      JSON.stringify(stringList(body.required_mcp_tools || body.requiredMcpTools)),
      checksum(skillMd), body.status === 'draft' ? 'draft' : 'active', actorId
    );
  db().prepare(`UPDATE agent_skills SET description=COALESCE(NULLIF(?,''),description),status=?,updated_at=datetime('now') WHERE id=?`)
    .run(String(body.description || '').trim().slice(0, 1000), body.status === 'draft' ? 'draft' : 'active', skillId);
  return serializeSkill(db().prepare('SELECT * FROM agent_skills WHERE id=?').get(skillId), db().prepare('SELECT * FROM agent_skill_versions WHERE id=?').get(versionId));
}

export function listAgentSkillAssignments(ownerUserId, agentId, { includeMarkdown = false } = {}) {
  ensureSeeded();
  assertAgentForOwner(ownerUserId, agentId);
  const assigned = db().prepare(`SELECT asa.*,s.slug,s.name,s.description,s.scope,s.status AS skill_status,s.owner_user_id AS skill_owner
    FROM agent_skill_assignments asa JOIN agent_skills s ON s.id=asa.skill_id
    WHERE asa.owner_user_id=? AND asa.agent_id=? ORDER BY asa.priority,s.name`).all(ownerUserId, agentId);
  const toolSet = new Set(db().prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id=?').all(agentId).map((r) => r.tool_name));
  const actionSet = new Set(db().prepare('SELECT action_id FROM agent_connector_action_grants WHERE agent_id=?').all(agentId).map((r) => r.action_id));
  const mcpToolSet = new Set(db().prepare('SELECT server_id,tool_name FROM agent_mcp_tool_grants WHERE owner_user_id=? AND agent_id=?')
    .all(ownerUserId, agentId).map((r) => `${r.server_id}::${r.tool_name}`));
  return assigned.map((row) => {
    const version = versionForAssignment(row);
    const requiredTools = json(version?.required_tools_json, []);
    const requiredActions = json(version?.required_connector_actions_json, []);
    const requiredMcpTools = json(version?.required_mcp_tools_json, []);
    const value = {
      skill_id: row.skill_id,
      slug: row.slug,
      name: row.name,
      description: row.description || '',
      scope: row.scope,
      enabled: !!row.enabled,
      auto_select: !!row.auto_select,
      priority: Number(row.priority || 100),
      pinned: !!row.version_id,
      version_id: version?.id || null,
      version: version ? Number(version.version) : null,
      trigger_hints: json(version?.trigger_hints_json, []),
      required_tools: requiredTools,
      required_connector_actions: requiredActions,
      required_mcp_tools: requiredMcpTools,
      missing_tools: requiredTools.filter((item) => !toolSet.has(item)),
      missing_connector_actions: requiredActions.filter((item) => !actionSet.has(item)),
      missing_mcp_tools: requiredMcpTools.filter((item) => !mcpToolSet.has(item)),
      checksum: version?.checksum || null,
      status: row.skill_status,
    };
    value.ready = !!version && !value.missing_tools.length && !value.missing_connector_actions.length && !value.missing_mcp_tools.length && row.skill_status === 'active';
    if (includeMarkdown) value.skill_md = version?.skill_md || '';
    return value;
  });
}

export function setAgentSkillAssignments(ownerUserId, agentId, assignments = [], actorId = '') {
  ensureSeeded();
  assertAgentForOwner(ownerUserId, agentId);
  const normalized = (Array.isArray(assignments) ? assignments : []).map((raw, index) => {
    const row = typeof raw === 'string' ? { skill_id: raw } : raw || {};
    const skillId = String(row.skill_id || row.id || '').trim();
    const skill = skillAccessible(ownerUserId, skillId);
    if (!skill || skill.status === 'retired') throw new Error(`Skill is unavailable: ${skillId}`);
    let version = null;
    if (row.version_id) {
      version = db().prepare(`SELECT * FROM agent_skill_versions WHERE id=? AND skill_id=? AND status='active'`).get(String(row.version_id), skillId);
      if (!version) throw new Error(`Skill version is unavailable: ${row.version_id}`);
    } else {
      version = latestVersion(skillId);
      if (!version) throw new Error(`Skill has no active version: ${skillId}`);
    }
    return {
      skill_id: skillId,
      version_id: row.pin_version === false ? null : version.id,
      enabled: row.enabled === false ? 0 : 1,
      auto_select: row.auto_select === false ? 0 : 1,
      priority: Number.isFinite(Number(row.priority)) ? Math.max(0, Math.min(1000, Number(row.priority))) : 100 + index,
    };
  });
  const conn = db();
  conn.transaction(() => {
    conn.prepare('DELETE FROM agent_skill_assignments WHERE owner_user_id=? AND agent_id=?').run(ownerUserId, agentId);
    const insert = conn.prepare(`INSERT INTO agent_skill_assignments
      (owner_user_id,agent_id,skill_id,version_id,enabled,priority,auto_select,assigned_by)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const row of normalized) insert.run(ownerUserId, agentId, row.skill_id, row.version_id, row.enabled, row.priority, row.auto_select, actorId);
  })();
  return listAgentSkillAssignments(ownerUserId, agentId, { includeMarkdown: false });
}

export function compactAgentSkillManifest(ownerUserId, agentId) {
  try {
    return listAgentSkillAssignments(ownerUserId, agentId).filter((item) => item.enabled).map((item) => ({
      id: item.skill_id,
      slug: item.slug,
      name: item.name,
      description: item.description,
      version: item.version,
      version_id: item.version_id,
      trigger_hints: item.trigger_hints,
      required_tools: item.required_tools,
      required_connector_actions: item.required_connector_actions,
      required_mcp_tools: item.required_mcp_tools,
      ready: item.ready,
      auto_select: item.auto_select,
    }));
  } catch {
    return [];
  }
}

const COMMON_WORDS = new Set(['the','and','for','with','from','this','that','into','your','you','please','need','want','using','use','work','task','agent','skill']);
function words(value) {
  return new Set(String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g)?.filter((word) => !COMMON_WORDS.has(word)) || []);
}

export function recommendAgentSkills(ownerUserId, agentId, prompt, { limit = 3 } = {}) {
  const wanted = words(prompt);
  return compactAgentSkillManifest(ownerUserId, agentId)
    .filter((skill) => skill.ready && skill.auto_select)
    .map((skill) => {
      const haystack = words([skill.slug, skill.name, skill.description, ...(skill.trigger_hints || [])].join(' '));
      let score = 0;
      for (const token of wanted) if (haystack.has(token)) score += token.includes('-') ? 4 : 1;
      if (String(prompt || '').toLowerCase().includes(String(skill.slug || '').toLowerCase())) score += 10;
      if (String(prompt || '').toLowerCase().includes(String(skill.name || '').toLowerCase())) score += 10;
      return { ...skill, score };
    })
    .filter((skill) => skill.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(5, Number(limit) || 3)));
}

export function normalizeSkillRefsForAgent(ownerUserId, agentId, refs = [], { requireReady = true } = {}) {
  const allowed = new Map(compactAgentSkillManifest(ownerUserId, agentId).map((item) => [item.id, item]));
  return [...new Set((Array.isArray(refs) ? refs : []).map((ref) => typeof ref === 'string' ? ref : ref?.skill_id || ref?.id).filter(Boolean))]
    .map((id) => allowed.get(String(id)))
    .filter((item) => item && (!requireReady || item.ready))
    .map((item) => ({ skill_id: item.id, version_id: item.version_id, version: item.version, slug: item.slug, name: item.name }));
}

export function buildAgentSkillRuntimeInstruction(ownerUserId, agentId, prompt, { pinnedRefs = null } = {}) {
  const allowed = compactAgentSkillManifest(ownerUserId, agentId).filter((item) => item.enabled !== false);
  if (!allowed.length) return { instruction: '', allowed: [], recommended: [] };
  const pinned = Array.isArray(pinnedRefs) && pinnedRefs.length
    ? normalizeSkillRefsForAgent(ownerUserId, agentId, pinnedRefs)
    : [];
  const recommended = pinned.length ? pinned : recommendAgentSkills(ownerUserId, agentId, prompt);
  const lines = allowed.map((skill) =>
    `- ${skill.id}@v${skill.version} | ${skill.name} | path=skills/${skill.slug}/SKILL.md | ready=${skill.ready ? 'yes' : 'no'} | ${skill.description || (skill.trigger_hints || []).join('; ')}`
  );
  const recommendation = recommended.length
    ? `Recommended for this request: ${recommended.map((item) => `${item.skill_id || item.id}@v${item.version}`).join(', ')}.`
    : 'No skill is preselected. Choose a skill only when its stated purpose genuinely matches the request.';
  return {
    allowed,
    recommended,
    instruction: `\n\n[FLOLAH SKILL CONTRACT]\nYou may use only the assigned skills below. Skills are operating instructions, not tool permissions. Determine which zero, one, or multiple skills apply to the current request. Before executing, load each selected SKILL.md from its listed workspace path and follow it. Never use an unassigned skill, and never claim a missing tool is granted. ${recommendation}\nAssigned skills:\n${lines.join('\n')}\nAt the very end of your response add one machine-readable line exactly as [FLOLAH_SKILLS_USED: skill-id@vN, ...] or [FLOLAH_SKILLS_USED: none]. The platform removes this line before showing the response.`,
  };
}

export function extractSkillUsageMarker(reply, allowedSkills = []) {
  const text = String(reply || '');
  const matches = [...text.matchAll(/\[FLOLAH_SKILLS_USED:\s*([^\]]+)\]/gi)];
  const raw = matches.at(-1)?.[1]?.trim() || '';
  const allowed = new Map((allowedSkills || []).map((skill) => [`${skill.id}@v${skill.version}`.toLowerCase(), skill]));
  const used = raw && raw.toLowerCase() !== 'none'
    ? raw.split(',').map((item) => item.trim().toLowerCase()).map((key) => allowed.get(key)).filter(Boolean)
    : [];
  return {
    reply: text.replace(/\s*\[FLOLAH_SKILLS_USED:\s*[^\]]+\]\s*/gi, '\n').trim(),
    used: used.map((skill) => ({ skill_id: skill.id, version_id: skill.version_id, version: skill.version, slug: skill.slug, name: skill.name })),
    marker_present: matches.length > 0,
  };
}

export function recordSkillExecutionSelection({ ownerUserId, agentId, skillRefs = [], selectedBy = 'agent', selectionReason = '', workUnitId = null, goalRunId = null, goalStepId = null, delegationTaskId = null, status = 'selected' }) {
  ensureAgentSkillsSchema();
  if (!skillRefs.length) return null;
  const id = `skill-audit-${randomUUID()}`;
  db().prepare(`INSERT INTO agent_skill_execution_audit
    (id,owner_user_id,agent_id,work_unit_id,goal_run_id,goal_step_id,delegation_task_id,selected_by,skill_refs_json,selection_reason,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, ownerUserId, agentId, workUnitId, goalRunId, goalStepId, delegationTaskId,
      selectedBy, JSON.stringify(skillRefs), String(selectionReason || '').slice(0, 1000), status
    );
  return id;
}

export function listSkillExecutionAudit(ownerUserId, agentId, { limit = 30 } = {}) {
  ensureAgentSkillsSchema();
  return db().prepare(`SELECT * FROM agent_skill_execution_audit WHERE owner_user_id=? AND agent_id=? ORDER BY created_at DESC LIMIT ?`)
    .all(ownerUserId, agentId, Math.max(1, Math.min(200, Number(limit) || 30)))
    .map((row) => ({ ...row, skill_refs: json(row.skill_refs_json, []), evidence: json(row.evidence_json, {}) }));
}

function writeIfChanged(path, text) {
  const next = String(text || '');
  if (existsSync(path) && readFileSync(path, 'utf8') === next) return false;
  writeFileSync(path, next, 'utf8');
  return true;
}

export function syncAgentSkillsToWorkspace(ownerUserId, agentId, workspacePath) {
  ensureSeeded();
  assertAgentForOwner(ownerUserId, agentId);
  const assignments = listAgentSkillAssignments(ownerUserId, agentId, { includeMarkdown: true }).filter((item) => item.enabled && item.status === 'active');
  const skillsRoot = join(workspacePath, 'skills');
  mkdirSync(skillsRoot, { recursive: true });
  const expected = new Set();
  let written = 0;
  for (const skill of assignments) {
    const folder = slugify(skill.slug);
    expected.add(folder);
    const dest = join(skillsRoot, folder);
    mkdirSync(dest, { recursive: true });
    if (writeIfChanged(join(dest, 'SKILL.md'), validateSkillMarkdown(skill.skill_md))) written += 1;
    writeIfChanged(join(dest, MANAGED_MARKER), `${JSON.stringify({ owner_user_id: ownerUserId, agent_id: agentId, skill_id: skill.skill_id, version_id: skill.version_id, checksum: skill.checksum }, null, 2)}\n`);
  }
  let removed = 0;
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || expected.has(entry.name)) continue;
    const markerPath = join(skillsRoot, entry.name, MANAGED_MARKER);
    if (!existsSync(markerPath)) continue;
    const marker = json(readFileSync(markerPath, 'utf8'), {});
    if (marker.owner_user_id === ownerUserId && marker.agent_id === agentId) {
      rmSync(join(skillsRoot, entry.name), { recursive: true, force: true });
      removed += 1;
    }
  }
  const manifest = [
    '# Assigned Skills',
    '',
    'This file is managed by Flolah. Use only these assigned skill packages; tool and connector permissions remain independently enforced.',
    '',
    ...assignments.map((skill) => `- **${skill.name}** — \`${skill.skill_id}@v${skill.version}\` — \`skills/${skill.slug}/SKILL.md\`${skill.ready ? '' : ' — not ready: missing required capability'}`),
    '',
  ].join('\n');
  if (writeIfChanged(join(workspacePath, 'SKILLS.md'), manifest)) written += 1;
  return { assigned: assignments.length, written, removed, workspace_path: workspacePath };
}

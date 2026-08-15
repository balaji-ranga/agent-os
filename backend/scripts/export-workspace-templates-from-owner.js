/**
 * Snap SOURCE_OWNER lean + CRM/ERP + video workspaces into
 * openclaw-workspace-templates/ for redeployable source of truth.
 *
 * node scripts/export-workspace-templates-from-owner.js
 * Env: SOURCE_OWNER_USER_ID=ceo-demo-brightbox-744921
 *      OUT_ROOT=...  (default: repo openclaw-workspace-templates)
 *      INCLUDE_VIDEO=1  (default 1 — also export video-orchestrator/story/scene/prompt)
 *      KEEP_BETTER=1    (default 1 — do not overwrite source MD that is already longer/richer)
 *      DRY_RUN=1
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDb, getDb } from '../src/db/schema.js';
import { ownerSlug, getVideoAgentDefs } from '../src/services/company-blueprints/standard-prefabs.js';
import { getAgentToolGrants } from '../src/services/openclaw-agent-tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OWNER = process.env.SOURCE_OWNER_USER_ID || 'ceo-demo-brightbox-744921';
const DRY = process.env.DRY_RUN === '1';
const INCLUDE_VIDEO = process.env.INCLUDE_VIDEO !== '0';
const KEEP_BETTER = process.env.KEEP_BETTER !== '0';
const REPO_ROOT = process.env.AGENT_OS_ROOT || join(__dirname, '..', '..');
const OUT_ROOT = process.env.OUT_ROOT || join(REPO_ROOT, 'openclaw-workspace-templates');
const EXPORT_FILES = ['TOOLS.md', 'AGENTS.md', 'SOUL.md', 'MEMORY.md', 'IDENTITY.md'];
const MD_NAMES = [...EXPORT_FILES, 'AGENT-OS-OPS.md', 'ORG.md', 'POLICY.md'];
const PRODUCT_MARKERS = [
  'never bounce the CEO',
  'run video storyboard',
  'BrightBox policy',
  'character_id',
  'video_story_status',
  'entry_discount_pct_max',
];

function openclawHome() {
  return process.env.OPENCLAW_HOME || process.env.OPENCLAW_STATE_DIR || join(process.env.HOME || '/root', '.openclaw');
}

function sanitizeTemplate(content) {
  if (!content) return content;
  let s = content;
  s = s.replace(/t-ceo-demo-brightbox-\d+--/gi, '');
  s = s.replace(/t-ceo-bala--/gi, '');
  s = s.replace(/ceo-demo-brightbox-\d+/gi, '{ceo_user_id}');
  s = s.replace(/\bceo-bala\b/gi, '{ceo_user_id}');
  s = s.replace(/crm-(s1|s2|ap)-[a-z0-9]{4,16}/gi, 'crm-$1-{ownerSlug}');
  s = s.replace(/erp-(s1|s2|ap|pnl|inv|pm)-[a-z0-9]{4,16}/gi, 'erp-$1-{ownerSlug}');
  s = s.replace(/video-(orch|story|scene|prompt|reasoning|media|assembly)-[a-z0-9-]{3,40}/gi, 'video-$1-{ownerSlug}');
  s = s.replace(/ceodemobrigh/gi, '{ownerSlug}');
  s = s.replace(/\bceobala\b/gi, '{ownerSlug}');
  s = s.replace(/BrightBox Gifts/gi, '{company_name}');
  s = s.replace(/BalajiDemoCompany/gi, '{company_name}');
  s = s.replace(/BrightBox Demo CEO/gi, '{ceo_name}');
  s = s.replace(/Balaji Ranganathan/gi, '{ceo_name}');
  return s;
}

function headingCount(text) {
  return (String(text || '').match(/^#{1,3} /gm) || []).length;
}

function markerScore(text) {
  const s = String(text || '');
  return PRODUCT_MARKERS.reduce((n, m) => n + (s.includes(m) ? 1 : 0), 0);
}

function isOperationalMemory(text) {
  const s = String(text || '');
  return /standup|delegation-\d+|task #\d+|2026-0[0-9]-/i.test(s) && /## Recent/i.test(s);
}

function isDefaultIdentity(text) {
  return /_Fill this in during your first conversation/i.test(String(text || ''));
}

function shouldKeepExisting(name, existing, incoming) {
  if (!KEEP_BETTER || !existing) return false;
  if (name === 'IDENTITY.md' && isDefaultIdentity(incoming)) return true;
  if (name === 'MEMORY.md' && isOperationalMemory(incoming) && !isOperationalMemory(existing)) return true;
  if (name === 'MEMORY.md' && isOperationalMemory(incoming) && isOperationalMemory(existing)) return true;
  const existLen = existing.length;
  const inLen = incoming.length;
  const existHead = headingCount(existing);
  const inHead = headingCount(incoming);
  const existMark = markerScore(existing);
  const inMark = markerScore(incoming);
  if (existMark > inMark) return true;
  if (existMark === inMark && existHead > inHead && existLen > inLen * 1.05) return true;
  if (existMark === inMark && existLen > inLen * 1.15 && inHead <= existHead) return true;
  return false;
}

function writeTemplate(templateId, files, meta = {}) {
  const dest = join(OUT_ROOT, templateId);
  mkdirSync(dest, { recursive: true });
  const written = [];
  const skipped = [];
  for (const [name, raw] of Object.entries(files)) {
    if (!EXPORT_FILES.includes(name)) continue;
    if (!raw || !String(raw).trim()) continue;
    const body = sanitizeTemplate(raw);
    const destPath = join(dest, name);
    const existing = existsSync(destPath) ? readFileSync(destPath, 'utf8') : '';
    if (shouldKeepExisting(name, existing, body)) {
      skipped.push({ name, reason: 'source_better', existing_bytes: existing.length, live_bytes: body.length });
      continue;
    }
    if (DRY) {
      written.push({ name, bytes: body.length, dry: true });
      continue;
    }
    writeFileSync(destPath, body.endsWith('\n') ? body : body + '\n', 'utf8');
    written.push({ name, bytes: body.length });
  }
  if (!DRY) {
    writeFileSync(
      join(dest, '.template-source.json'),
      JSON.stringify(
        {
          source_owner: OWNER,
          template_id: templateId,
          exported_at: new Date().toISOString(),
          keep_better: KEEP_BETTER,
          skipped,
          ...meta,
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
  }
  return { dest, written, skipped };
}

function agentByExactId(id) {
  return getDb().prepare('SELECT * FROM agents WHERE id = ? OR openclaw_agent_id = ?').get(id, id);
}

function readMdTree(ws) {
  const out = {};
  for (const name of MD_NAMES) {
    const p = join(ws, name);
    if (!existsSync(p)) continue;
    try {
      out[name] = readFileSync(p, 'utf8');
    } catch (_) {}
  }
  return out;
}

function resolveWorkspace(row) {
  if (row.workspace_path && existsSync(row.workspace_path)) return row.workspace_path;
  const id = row.openclaw_agent_id || row.id;
  const tenant = join(openclawHome(), 'tenants', OWNER, `workspace-${id}`);
  if (existsSync(tenant)) return tenant;
  const shared = join(openclawHome(), `workspace-${id}`);
  if (existsSync(shared)) return shared;
  return null;
}

initDb();
const slug = ownerSlug(OWNER);
console.info('[export-templates] owner=%s slug=%s out=%s dry=%s', OWNER, slug, OUT_ROOT, DRY);

const plan = [];
for (const id of ['balserve', 'workflowbuilder', 'platformhelp']) {
  plan.push({ templateId: id, row: agentByExactId(id), role: id });
}
const crmSpecs = [
  { templateId: 'crm-maker-a', id: `crm-s1-${slug}`.slice(0, 40), role: 'crm_maker' },
  { templateId: 'crm-maker-b', id: `crm-s2-${slug}`.slice(0, 40), role: 'crm_maker' },
  { templateId: 'crm-checker', id: `crm-ap-${slug}`.slice(0, 40), role: 'crm_checker' },
];
for (const s of crmSpecs) plan.push({ templateId: s.templateId, row: agentByExactId(s.id), role: s.role, label: s.id });
const erpSpecs = [
  { templateId: 'erp-maker-a', id: `erp-s1-${slug}`.slice(0, 40), role: 'erp_maker' },
  { templateId: 'erp-maker-b', id: `erp-s2-${slug}`.slice(0, 40), role: 'erp_maker' },
  { templateId: 'erp-checker', id: `erp-ap-${slug}`.slice(0, 40), role: 'erp_checker' },
  { templateId: 'erp-pnl', id: `erp-pnl-${slug}`.slice(0, 40), role: 'erp_pnl' },
  { templateId: 'erp-invoice', id: `erp-inv-${slug}`.slice(0, 40), role: 'erp_invoice' },
  { templateId: 'erp-project', id: `erp-pm-${slug}`.slice(0, 40), role: 'erp_project' },
];
for (const s of erpSpecs) plan.push({ templateId: s.templateId, row: agentByExactId(s.id), role: s.role, label: s.id });
if (INCLUDE_VIDEO) {
  const videoDefs = getVideoAgentDefs(OWNER);
  for (const def of videoDefs) {
    plan.push({
      templateId: def.template_base_id || def.workspace_template_base || def.key,
      row: agentByExactId(def.id),
      role: def.role_key || def.key,
      label: def.id,
    });
  }
}

const report = [];
for (const item of plan) {
  if (!item.row) {
    report.push({ templateId: item.templateId, ok: false, error: `agent not found: ${item.label || item.templateId}` });
    console.warn('[export-templates] missing', item.templateId, item.label);
    continue;
  }
  const ws = resolveWorkspace(item.row);
  if (!ws) {
    report.push({ templateId: item.templateId, ok: false, error: 'workspace not found', agent: item.row.id });
    console.warn('[export-templates] no ws', item.templateId, item.row.workspace_path);
    continue;
  }
  const files = readMdTree(ws);
  const result = writeTemplate(item.templateId, files, {
    source_agent_id: item.row.id,
    source_workspace: ws,
    tools: getAgentToolGrants(item.row.id),
    role: item.role,
  });
  report.push({
    templateId: item.templateId,
    ok: true,
    workspace: ws,
    written: result.written.map((w) => w.name),
    skipped: (result.skipped || []).map((s) => s.name),
    tools: (getAgentToolGrants(item.row.id) || []).length,
  });
  console.info(
    '[export-templates] %s <- %s wrote=%s skip=%s',
    item.templateId,
    ws,
    result.written.map((w) => w.name).join(',') || '(none)',
    (result.skipped || []).map((s) => s.name).join(',') || '(none)'
  );
}

const map = {
  source_owner: OWNER,
  slug,
  exported_at: new Date().toISOString(),
  keep_better: KEEP_BETTER,
  include_video: INCLUDE_VIDEO,
  lean: ['balserve', 'workflowbuilder', 'platformhelp'],
  crm: { twenty: { maker_a: 'crm-maker-a', maker_b: 'crm-maker-b', checker: 'crm-checker' }, erpnext: { maker_a: 'erp-maker-a', maker_b: 'erp-maker-b', checker: 'erp-checker' } },
  erp: { maker_a: 'erp-maker-a', maker_b: 'erp-maker-b', checker: 'erp-checker', pnl: 'erp-pnl', invoice: 'erp-invoice', project: 'erp-project' },
  video: INCLUDE_VIDEO
    ? {
        orchestrator: 'video-orchestrator',
        story: 'video-story',
        scene: 'video-scene',
        prompt: 'video-prompt',
      }
    : undefined,
  report,
};
const writeMap =
  process.env.WRITE_TEMPLATE_MAP === '1' ||
  (!process.env.WRITE_TEMPLATE_MAP && !/^ceo-bala$/i.test(OWNER));
if (!DRY && writeMap) {
  writeFileSync(join(OUT_ROOT, 'business-core-template-map.json'), JSON.stringify(map, null, 2) + '\n', 'utf8');
} else if (!DRY) {
  writeFileSync(join(OUT_ROOT, `template-export-${slug}.json`), JSON.stringify(map, null, 2) + '\n', 'utf8');
}
console.log('EXPORT_SUMMARY', JSON.stringify({ out: OUT_ROOT, ok: report.filter((r) => r.ok).length, fail: report.filter((r) => !r.ok).length, report }, null, 2));
process.exit(report.some((r) => !r.ok && r.templateId.startsWith('crm-')) ? 2 : 0);
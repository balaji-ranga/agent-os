/**
 * Snap BrightBox (or SOURCE_OWNER) lean + CRM/ERP maker-checker workspaces into
 * openclaw-workspace-templates/ for redeployable source of truth.
 *
 * node scripts/export-workspace-templates-from-owner.js
 * Env: SOURCE_OWNER_USER_ID=ceo-demo-brightbox-744921
 *      OUT_ROOT=...  (default: repo openclaw-workspace-templates)
 *      DRY_RUN=1
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDb, getDb } from '../src/db/schema.js';
import { ownerSlug } from '../src/services/company-blueprints/standard-prefabs.js';
import { getAgentToolGrants } from '../src/services/openclaw-agent-tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OWNER = process.env.SOURCE_OWNER_USER_ID || 'ceo-demo-brightbox-744921';
const DRY = process.env.DRY_RUN === '1';
const REPO_ROOT = process.env.AGENT_OS_ROOT || join(__dirname, '..', '..');
const OUT_ROOT = process.env.OUT_ROOT || join(REPO_ROOT, 'openclaw-workspace-templates');
const EXPORT_FILES = ['TOOLS.md', 'AGENTS.md', 'SOUL.md', 'MEMORY.md', 'IDENTITY.md'];
const MD_NAMES = [...EXPORT_FILES, 'AGENT-OS-OPS.md', 'ORG.md', 'POLICY.md'];

function openclawHome() {
  return process.env.OPENCLAW_HOME || process.env.OPENCLAW_STATE_DIR || join(process.env.HOME || '/root', '.openclaw');
}

function sanitizeTemplate(content) {
  if (!content) return content;
  let s = content;
  s = s.replace(/t-ceo-demo-brightbox-\d+--/gi, '');
  s = s.replace(/ceo-demo-brightbox-\d+/gi, '{ceo_user_id}');
  s = s.replace(/crm-(s1|s2|ap)-[a-z0-9]{4,16}/gi, 'crm-$1-{ownerSlug}');
  s = s.replace(/erp-(s1|s2|ap|pnl|inv|pm)-[a-z0-9]{4,16}/gi, 'erp-$1-{ownerSlug}');
  s = s.replace(/ceodemobrigh/gi, '{ownerSlug}');
  s = s.replace(/BrightBox Gifts/gi, '{company_name}');
  s = s.replace(/BrightBox Demo CEO/gi, '{ceo_name}');
  return s;
}

function writeTemplate(templateId, files, meta = {}) {
  const dest = join(OUT_ROOT, templateId);
  mkdirSync(dest, { recursive: true });
  const written = [];
  for (const [name, raw] of Object.entries(files)) {
    if (!EXPORT_FILES.includes(name)) continue;
    if (!raw || !String(raw).trim()) continue;
    const body = sanitizeTemplate(raw);
    if (DRY) {
      written.push({ name, bytes: body.length, dry: true });
      continue;
    }
    writeFileSync(join(dest, name), body.endsWith('\n') ? body : body + '\n', 'utf8');
    written.push({ name, bytes: body.length });
  }
  if (!DRY) {
    writeFileSync(
      join(dest, '.template-source.json'),
      JSON.stringify({ source_owner: OWNER, template_id: templateId, exported_at: new Date().toISOString(), ...meta }, null, 2) + '\n',
      'utf8'
    );
  }
  return { dest, written };
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
    tools: (getAgentToolGrants(item.row.id) || []).length,
  });
  console.info('[export-templates] %s <- %s (%s)', item.templateId, ws, result.written.map((w) => w.name).join(','));
}

const map = {
  source_owner: OWNER,
  slug,
  exported_at: new Date().toISOString(),
  lean: ['balserve', 'workflowbuilder', 'platformhelp'],
  crm: { twenty: { maker_a: 'crm-maker-a', maker_b: 'crm-maker-b', checker: 'crm-checker' }, erpnext: { maker_a: 'erp-maker-a', maker_b: 'erp-maker-b', checker: 'erp-checker' } },
  erp: { maker_a: 'erp-maker-a', maker_b: 'erp-maker-b', checker: 'erp-checker', pnl: 'erp-pnl', invoice: 'erp-invoice', project: 'erp-project' },
  report,
};
if (!DRY) writeFileSync(join(OUT_ROOT, 'business-core-template-map.json'), JSON.stringify(map, null, 2) + '\n', 'utf8');
console.log('EXPORT_SUMMARY', JSON.stringify({ out: OUT_ROOT, ok: report.filter((r) => r.ok).length, fail: report.filter((r) => !r.ok).length, report }, null, 2));
process.exit(report.some((r) => !r.ok && r.templateId.startsWith('crm-')) ? 2 : 0);
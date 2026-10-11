import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeSkillPackage} from './skill-package.js';

const catalogRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../skills-catalog');
const fail = (message,status=400) => {throw Object.assign(new Error(message),{status});};
const parse = (text,fallback={}) => {try{return JSON.parse(text || '');}catch{return fallback;}};

export function ensurePlatformSkillCatalogSchema(db) {
  for (const [table,definitions] of Object.entries({
    agent_skills:{catalog_managed:'INTEGER NOT NULL DEFAULT 0',category:"TEXT DEFAULT ''"},
    agent_skill_versions:{package_json:"TEXT DEFAULT '{}'",review_json:"TEXT DEFAULT '{}'"},
  })) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name));
    for (const [name,definition] of Object.entries(definitions)) if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS platform_skill_audit(id TEXT PRIMARY KEY,skill_id TEXT NOT NULL,version_id TEXT,actor_id TEXT NOT NULL,action TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT DEFAULT (datetime('now')))`);
}

export function createPlatformSkillCatalogStore(db) {
  const audit = (id,version,actor,action,details={}) => db.prepare('INSERT INTO platform_skill_audit(id,skill_id,version_id,actor_id,action,details_json) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,version,actor,action,JSON.stringify(details));
  const row = id => db.prepare("SELECT * FROM agent_skills WHERE id=? AND owner_user_id='__platform__' AND scope='platform'").get(id);
  const detail = id => {
    const skill=row(id); if (!skill) fail('Platform skill not found',404);
    const versions=db.prepare('SELECT * FROM agent_skill_versions WHERE skill_id=? ORDER BY version DESC').all(id).map(v=>({...v,...parse(v.package_json),review:parse(v.review_json),required_tools:parse(v.required_tools_json,[]),required_connector_actions:parse(v.required_connector_actions_json,[]),required_mcp_tools:parse(v.required_mcp_tools_json,[]),trigger_hints:parse(v.trigger_hints_json,[])}));
    return {...skill,versions};
  };
  const save = (body,actor,id=null,{seed=false}={}) => {
    const pkg=normalizeSkillPackage(body);
    if (!actor) fail('Authenticated admin required',403);
    const existing=id ? row(id) : db.prepare("SELECT * FROM agent_skills WHERE scope='platform' AND slug=?").get(pkg.slug);
    if (id && !existing) fail('Platform skill not found',404);
    if (!id && existing) fail('Slug already exists; create a new version on that skill',409);
    if (existing && existing.slug!==pkg.slug) fail('Slug is immutable; use the existing slug');
    const skillId=existing?.id || `platform:${pkg.slug}`;
    return db.transaction(()=>{
      if (!existing) db.prepare("INSERT INTO agent_skills(id,owner_user_id,scope,slug,name,description,status,source_kind,created_by,catalog_managed,category) VALUES(?,'__platform__','platform',?,?,?,'draft','imported',?,1,?)").run(skillId,pkg.slug,pkg.name,pkg.description,actor,pkg.category);
      else db.prepare('UPDATE agent_skills SET catalog_managed=1 WHERE id=?').run(skillId);
      const version=Number(db.prepare('SELECT MAX(version) AS n FROM agent_skill_versions WHERE skill_id=?').get(skillId).n || 0)+1;
      const versionId=`${skillId}:v${version}`;
      db.prepare("INSERT INTO agent_skill_versions(id,skill_id,version,skill_md,trigger_hints_json,required_tools_json,required_connector_actions_json,required_mcp_tools_json,checksum,status,created_by,package_json) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?)").run(versionId,skillId,version,pkg.skill_md,JSON.stringify(pkg.trigger_hints),JSON.stringify(pkg.required_tools),JSON.stringify(pkg.required_connector_actions),JSON.stringify(pkg.required_mcp_tools),pkg.checksum,actor,JSON.stringify(pkg));
      audit(skillId,versionId,actor,seed?'seed':'draft_created',{package_checksum:pkg.package_checksum});
      return detail(skillId);
    })();
  };
  const publish = (id,body,actor) => db.transaction(()=>{
    if (!actor) fail('Authenticated admin required',403);
    const skill=row(id); if (!skill) fail('Platform skill not found',404);
    const version=db.prepare('SELECT * FROM agent_skill_versions WHERE skill_id=? AND id=?').get(id,body.version_id);
    if (!version) fail('Choose the exact reviewed version',404);
    const pkg=parse(version.package_json);
    if (!pkg.package_checksum || body.package_checksum!==pkg.package_checksum) fail('Package changed; reload and review the exact checksum',409);
    if (body.reviewed!==true || String(body.review_notes || '').trim().length<15) fail('Review instructions, license, dependencies and safety; record review notes');
    if (!['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC','CC0-1.0','Proprietary-authorized'].includes(pkg.provenance?.license)) fail('Document a supported license or explicit redistribution permission before publishing');
    if (!pkg.provenance?.license_text?.trim()) fail('Include the license/permission text');
    const latest=db.prepare('SELECT MAX(version) AS n FROM agent_skill_versions WHERE skill_id=? AND status=\'active\'').get(id);
    if (latest.n && version.version<latest.n) fail('Cannot replace the published version with an older draft',409);
    const review={actor_id:actor,checked_at:new Date().toISOString(),notes:String(body.review_notes).trim().slice(0,4000),package_checksum:pkg.package_checksum};
    db.prepare("UPDATE agent_skill_versions SET status='active',review_json=? WHERE id=?").run(JSON.stringify(review),version.id);
    db.prepare("UPDATE agent_skills SET status='active',catalog_managed=1,name=?,description=?,category=?,updated_at=datetime('now') WHERE id=?").run(pkg.name,pkg.description,pkg.category,id);
    audit(id,version.id,actor,'published',review);
    return detail(id);
  })();
  const unpublish = (id,actor) => {
    if (!actor) fail('Authenticated admin required',403);
    if (!row(id)) fail('Platform skill not found',404);
    db.transaction(()=>{db.prepare("UPDATE agent_skills SET status='draft',catalog_managed=1,updated_at=datetime('now') WHERE id=?").run(id);audit(id,null,actor,'unpublished');})();
    return detail(id);
  };
  return {save,publish,unpublish,detail,list:()=>db.prepare("SELECT s.*, (SELECT MAX(version) FROM agent_skill_versions WHERE skill_id=s.id AND status='active') AS published_version, (SELECT MAX(version) FROM agent_skill_versions WHERE skill_id=s.id) AS latest_version FROM agent_skills s WHERE scope='platform' ORDER BY category,name").all(),audit:id=>db.prepare('SELECT * FROM platform_skill_audit WHERE skill_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(id)};
}

export function seedCompanyAutomationCatalog(db) {
  const manifestPath=join(catalogRoot,'catalog.json');
  if (!existsSync(manifestPath)) return;
  const entries=JSON.parse(readFileSync(manifestPath,'utf8')).skills;
  const store=createPlatformSkillCatalogStore(db);
  for (const entry of entries) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.slug)) fail('Invalid source catalog slug');
    const id=`platform:${entry.slug}`;
    const existing=db.prepare('SELECT * FROM agent_skills WHERE id=?').get(id);
    if (existing?.catalog_managed) continue; // Never resurrect or replace an admin revision.
    const pkg={...entry,skill_md:readFileSync(join(catalogRoot,entry.slug,'SKILL.md'),'utf8'),resources:{}};
    if (existing) {
      const prior=db.prepare("SELECT skill_md FROM agent_skill_versions WHERE skill_id=? AND status='active' ORDER BY version DESC LIMIT 1").get(id);
      if (existing.status!=='active' || !prior || prior.skill_md.replaceAll('\r\n','\n').trim()!==pkg.skill_md.replaceAll('\r\n','\n').trim()) continue;
    }
    for (const path of entry.resource_paths || []) {
      normalizeSkillPackage({...pkg,resources:{[path]:''}}); // Validate before resolving a source resource.
      pkg.resources[path]=readFileSync(join(catalogRoot,entry.slug,path),'utf8');
    }
    const result=store.save(pkg,'source',existing?.id || null,{seed:true});
    // Curated native procedures are source-reviewed; third-party packages await explicit admin review.
    if (entry.publish_by_default) store.publish(id,{version_id:result.versions[0].id,package_checksum:result.versions[0].package_checksum,reviewed:true,review_notes:'Source-reviewed Flolah procedure; owner-scoped capabilities and approval boundaries preserved.'},'source');
  }
}

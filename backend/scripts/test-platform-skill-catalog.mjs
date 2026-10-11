import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import express from 'express';

const fixtureRoot=mkdtempSync(join(tmpdir(),'flolah-catalog-test-'));
process.env.AGENT_OS_DATA_DIR=join(fixtureRoot,'data');
process.env.OPENCLAW_DIR=join(fixtureRoot,'openclaw');
process.env.OPENCLAW_CONFIG_PATH=join(fixtureRoot,'openclaw','openclaw.json');
process.env.OPENSEARCH_ENABLED='0';
let database,server;
try {
  const {normalizeSkillPackage,parseGithubSkillUrl,previewGithubSkill}=await import('../src/services/skill-package.js');
  const pkg={slug:'review-fixture',name:'Review fixture',skill_md:'---\nname: review-fixture\ndescription: Review approved evidence.\n---\n\nUse approved evidence.',resources:{'references/checklist.md':'Reviewed reference'},provenance:{license:'MIT',license_text:'MIT License\nPermission is hereby granted, free of charge.'}};
  const normalized=normalizeSkillPackage(pkg);
  assert.notEqual(normalizeSkillPackage({...pkg,name:'Changed'}).package_checksum,normalized.package_checksum,'Review identity binds display metadata');
  for(const path of ['references/../outside.md','references/script.js','scripts/run.py','C:/escape.md','references/../../x.md','references\\bad.md']) assert.throws(()=>normalizeSkillPackage({...pkg,resources:{[path]:'x'}}),/Resource/);
  assert.throws(()=>normalizeSkillPackage({...pkg,resources:{'references/x.md':'\0'}}),/text resources/);
  assert.throws(()=>normalizeSkillPackage({...pkg,skill_md:'x'.repeat(140000)}),/128 KB/);
  assert.throws(()=>normalizeSkillPackage({...pkg,resources:{'references/x.md':'x'.repeat(1024*1024)}}),/1 MB/);
  for(const url of ['http://127.0.0.1/secret','https://raw.githubusercontent.com/a/b/x/SKILL.md','https://github.com/a/b/blob/main/skills/x/SKILL.md','https://github.com/a/b/blob/'+'a'.repeat(40)+'/../SKILL.md']) assert.throws(()=>parseGithubSkillUrl(url),/immutable/);
  let calls=[];
  const url='https://github.com/owner/repo/blob/'+'a'.repeat(40)+'/skills/example/SKILL.md';
  const preview=await previewGithubSkill(url,{fetchImpl:async (target,options)=>{
    calls.push(target);assert.equal(options.redirect,'error');
    return new Response(target.endsWith('SKILL.md')?pkg.skill_md:pkg.provenance.license_text);
  }});
  assert.equal(preview.provenance.commit,'a'.repeat(40));assert.equal(preview.provenance.license,'MIT');assert(preview.external_requirements.length);
  assert(calls.every(x=>x.startsWith('https://raw.githubusercontent.com/owner/repo/'+'a'.repeat(40)+'/')));

  const {initDb}=await import('../src/db/schema.js');database=initDb();
  for(const [id,role] of [['catalog-admin','admin'],['catalog-a','ceo'],['catalog-b','ceo']]) database.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)').run(id,id+'@example.invalid','test-only',id,role);
  database.prepare("INSERT INTO agents(id,name,openclaw_agent_id) VALUES('catalog-agent','Catalog agent','catalog-agent')").run();
  for(const owner of ['catalog-a','catalog-b']) database.prepare('INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)').run(owner,'catalog-agent');
  const svc=await import('../src/services/agent-skills.js');
  svc.seedPlatformAgentSkills();
  const manifest=JSON.parse(readFileSync(new URL('../../skills-catalog/catalog.json',import.meta.url),'utf8'));
  assert.equal(manifest.skills.length,50);assert.equal(new Set(manifest.skills.map(s=>s.slug)).size,50);
  assert.equal(manifest.skills.filter(s=>s.publish_by_default).length,30);
  for(const entry of manifest.skills) {
    const md=readFileSync(new URL('../../skills-catalog/'+entry.slug+'/SKILL.md',import.meta.url),'utf8');
    normalizeSkillPackage({...entry,skill_md:md});
    const row=database.prepare('SELECT * FROM agent_skills WHERE id=?').get('platform:'+entry.slug);
    assert(row,'Seeded '+entry.slug);assert.equal(row.status,entry.publish_by_default?'active':'draft',entry.slug);
  }
  const publicA=svc.listAgentSkillsCatalog('catalog-a'),publicB=svc.listAgentSkillsCatalog('catalog-b');
  assert(publicA.some(s=>s.slug==='gmail-operations'));assert(publicB.some(s=>s.slug==='gmail-operations'));
  assert(publicA.some(s=>s.slug==='ibkr-portfolio-strategy-sme' && s.provenance.license==='Apache-2.0'));
  assert(!publicA.some(s=>s.slug.startsWith('oss-')),'Unreviewed upstream drafts are hidden');
  const company=svc.createCompanySkill('catalog-a',{...pkg,name:'Private company skill',scope:'platform',owner_user_id:'catalog-b',status:'active'},'catalog-a');
  assert.equal(company.scope,'company');assert.equal(company.owner_user_id,'catalog-a');
  assert(svc.listAgentSkillsCatalog('catalog-a').some(s=>s.id===company.id));
  assert(!svc.listAgentSkillsCatalog('catalog-b').some(s=>s.id===company.id));
  assert.throws(()=>svc.addCompanySkillVersion('catalog-b',company.id,pkg,'catalog-b'),/not found/);
  assert.throws(()=>svc.addCompanySkillVersion('catalog-a','platform:gmail-operations',pkg,'catalog-a'),/not found/);
  assert.throws(()=>svc.setAgentSkillAssignments('catalog-b','catalog-agent',[{skill_id:company.id}],'catalog-b'),/not found|unavailable/i);

  const {createPlatformSkillCatalogStore}=await import('../src/services/platform-skill-catalog.js');
  const store=createPlatformSkillCatalogStore(database);
  let saved=store.save(pkg,'catalog-admin');
  assert(!svc.listAgentSkillsCatalog('catalog-a').some(s=>s.id===saved.id));
  assert.throws(()=>svc.setAgentSkillAssignments('catalog-a','catalog-agent',[{skill_id:saved.id}],'catalog-a'),/not active|unavailable/i);
  const publish=skill=>store.publish(skill.id,{version_id:skill.versions[0].id,package_checksum:skill.versions[0].package_checksum,reviewed:true,review_notes:'Verified instructions, license and requirements.'},'catalog-admin');
  assert.throws(()=>store.publish(saved.id,{version_id:saved.versions[0].id,package_checksum:'wrong',reviewed:true,review_notes:'Reviewed requirements.'},'catalog-admin'),/changed/);
  assert.throws(()=>store.publish(saved.id,{version_id:saved.versions[0].id,package_checksum:saved.versions[0].package_checksum,reviewed:false,review_notes:'Reviewed requirements.'},'catalog-admin'),/Review/);
  publish(saved);
  let assignments=svc.setAgentSkillAssignments('catalog-a','catalog-agent',[{skill_id:saved.id}],'catalog-a');
  assert(assignments[0].ready);
  const workspace=join(fixtureRoot,'workspace');
  assert.equal(svc.syncAgentSkillsToWorkspace('catalog-a','catalog-agent',workspace).assigned,1);
  assert.equal(readFileSync(join(workspace,'skills','review-fixture','references','checklist.md'),'utf8'),'Reviewed reference');
  assert(existsSync(join(workspace,'skills','review-fixture','LICENSE.txt')));
  saved=store.save({...pkg,skill_md:pkg.skill_md+'\nVersion two.'},'catalog-admin',saved.id);
  assert.equal(svc.listAgentSkillsCatalog('catalog-a').find(s=>s.id===saved.id).version,1,'Draft version does not leak');
  publish(saved);
  assert.equal(svc.listAgentSkillsCatalog('catalog-b').find(s=>s.id===saved.id).version,2);
  assert.equal(svc.listAgentSkillAssignments('catalog-a','catalog-agent')[0].version,1,'Published upgrades preserve pinned assignments');
  store.unpublish(saved.id,'catalog-admin');
  assert(!svc.listAgentSkillsCatalog('catalog-b').some(s=>s.id===saved.id));
  assert.equal(svc.listAgentSkillAssignments('catalog-a','catalog-agent')[0].ready,false);
  assert.equal(svc.buildAgentSkillRuntimeInstruction('catalog-a','catalog-agent','review').allowed.length,0);
  assert.equal(svc.syncAgentSkillsToWorkspace('catalog-a','catalog-agent',workspace).removed,1,'Revoked packages are removed on next sync');
  assert(!existsSync(join(workspace,'skills','review-fixture')));
  store.unpublish('platform:gmail-operations','catalog-admin');svc.seedPlatformAgentSkills({force:true});
  assert.equal(database.prepare("SELECT status FROM agent_skills WHERE id='platform:gmail-operations'").get().status,'draft','Reseeding never resurrects admin-unpublished skills');

  const blocked=store.save({...pkg,slug:'blocked-fixture',external_requirements:['Adapt missing runtime']},'catalog-admin');
  publish(blocked);svc.setAgentSkillAssignments('catalog-a','catalog-agent',[{skill_id:blocked.id}],'catalog-a');
  assert.equal(svc.listAgentSkillAssignments('catalog-a','catalog-agent')[0].ready,false);
  assert.equal(svc.syncAgentSkillsToWorkspace('catalog-a','catalog-agent',workspace).assigned,0,'Unresolved packages never synced as executable skills');
  const {commandSkillCatalog}=await import('../src/services/agent-command-runtime.js');
  assert(commandSkillCatalog('catalog-a','catalog-agent')[0].missing.includes('Adapt missing runtime'));
  assert.equal(database.prepare('SELECT count(*) n FROM agent_tool_grants').get().n,0,'Publication never grants tools');
  const noLicense=store.save({...pkg,slug:'no-license',provenance:{}},'catalog-admin');
  assert.throws(()=>publish(noLicense),/license|permission/i);

  publish(store.detail(saved.id));svc.setAgentSkillAssignments('catalog-a','catalog-agent',[{skill_id:saved.id}],'catalog-a');
  svc.syncAgentSkillsToWorkspace('catalog-a','catalog-agent',workspace);
  const outside=join(fixtureRoot,'outside.md');writeFileSync(outside,'sentinel');
  const skillFile=join(workspace,'skills','review-fixture','SKILL.md');rmSync(skillFile);
  try {
    symlinkSync(outside,skillFile,'file');
    assert.throws(()=>svc.syncAgentSkillsToWorkspace('catalog-a','catalog-agent',workspace),/symlinks/);
    assert.equal(readFileSync(outside,'utf8'),'sentinel');
    console.log('PASS: actual filesystem symlink cannot overwrite outside the managed skill directory.');
  } catch(e) {if(process.env.REQUIRE_SYMLINK_TEST==='1' || !['EPERM','EACCES'].includes(e.code)) throw e;console.log('Windows symlink fixture unavailable; Linux release gate must run REQUIRE_SYMLINK_TEST=1.');}

  const {createSession}=await import('../src/services/auth/session.js');
  const {attachAuthUser}=await import('../src/middleware/auth.js');
  const {default:router}=await import('../src/routes/admin-skills.js');
  const {default:companyRouter}=await import('../src/routes/agents.js');
  const app=express();app.use(express.json({limit:'2mb'}),attachAuthUser);app.use('/api/admin/skills',router);app.use('/api/agents',companyRouter);
  server=await new Promise(done=>{const s=app.listen(0,'127.0.0.1',()=>done(s));});
  const base='http://127.0.0.1:'+server.address().port+'/api/admin/skills';
  const adminToken=createSession('catalog-admin').token,ceoToken=createSession('catalog-a').token;
  const request=async(path,body,token)=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  for(const [path,body] of [['',null],['',pkg],['/github-preview',{url}],['/'+saved.id+'/versions',pkg],['/'+saved.id+'/publish',{}],['/'+saved.id+'/unpublish',{}]]) {
    assert.equal((await request(path,body,null)).status,401);
    assert.equal((await request(path,body,ceoToken)).status,403,'CEO cannot use admin publication endpoints');
  }
  assert.equal((await request('',null,adminToken)).status,200);
  const create=await request('',{...pkg,slug:'http-fixture'},adminToken);assert.equal(create.status,201);
  const created=(await create.json()).skill;
  const response=await request('/'+created.id+'/publish',{version_id:created.versions[0].id,package_checksum:created.versions[0].package_checksum,reviewed:true,review_notes:'Reviewed immutable package and license.'},adminToken);
  assert.equal(response.status,200);assert(svc.listAgentSkillsCatalog('catalog-b').some(s=>s.id===created.id));
  assert(store.audit(created.id).some(a=>a.action==='published'));
  const otherToken=createSession('catalog-b').token;
  const companyRequest=async(path,body,token)=>fetch(base.replace('/admin/skills','/agents')+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await companyRequest('/skills/catalog',null,null)).status,401);
  for(const token of [ceoToken,otherToken]) {
    const response=await companyRequest('/skills/catalog',null,token);assert.equal(response.status,200);
    const catalog=(await response.json()).skills;
    assert(catalog.some(s=>s.id===created.id));
    assert(!catalog.some(s=>s.slug.startsWith('oss-')));
    assert.equal(catalog.some(s=>s.id===company.id),token===ceoToken);
  }
  const privateResponse=await companyRequest('/skills',{...pkg,slug:'http-private',name:'HTTP private',scope:'platform',owner_user_id:'catalog-b'},ceoToken);
  assert.equal(privateResponse.status,201);
  const privateSkill=await privateResponse.json();assert.equal(privateSkill.scope,'company');assert.equal(privateSkill.owner_user_id,'catalog-a');
  assert.equal((await companyRequest('/skills/'+privateSkill.id+'/versions',pkg,otherToken)).status,404);
  assert.equal((await companyRequest('/skills/'+created.id+'/versions',pkg,ceoToken)).status,404);
  console.log('PASS: 50-source catalog, license review, immutable imports, admin HTTP authorization, global publication, company isolation, pinned versions, readiness, resource sync and revocation.');
} finally {
  if(server) await new Promise(done=>server.close(done));
  database?.close();
  assert(resolve(fixtureRoot).startsWith(resolve(tmpdir())+requireSeparator()) && fixtureRoot.includes('flolah-catalog-test-'));
  rmSync(fixtureRoot,{recursive:true,force:true});
}
function requireSeparator(){return process.platform==='win32'?'\\':'/';}

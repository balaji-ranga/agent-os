import {useEffect,useState} from 'react';
import {api} from '../api';

const empty={slug:'',name:'',description:'',category:'Operations',skill_md:'---\nname: company-procedure\ndescription: When this procedure applies.\n---\n\n# Procedure\n',required_tools:[],required_connector_actions:[],required_mcp_tools:[],trigger_hints:[],external_requirements:[],resources:{},provenance:{source_url:'',license:'',license_text:''}};
const split=value=>value.split(/[\n,]/).map(x=>x.trim()).filter(Boolean);
export default function AdminSkills() {
  const [skills,setSkills]=useState([]),[selected,setSelected]=useState(null),[draft,setDraft]=useState(empty),[query,setQuery]=useState(''),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[reviewed,setReviewed]=useState(false),[notes,setNotes]=useState('');
  const [resourceJson,setResourceJson]=useState('{}'),[dirty,setDirty]=useState(false);
  const edit=value=>{setDraft(value);setResourceJson(JSON.stringify(value.resources || {},null,2));setDirty(false);setReviewed(false);};
  const load=async()=>setSkills((await api.adminSkillsList()).skills || []);
  useEffect(()=>{load().catch(e=>setMessage(e.message));},[]);
  const action=async fn=>{setBusy(true);setMessage('');try{await fn();await load();}catch(e){setMessage(e.message);}finally{setBusy(false);}};
  const open=skill=>action(async()=>{const result=await api.adminSkillGet(skill.id);setSelected(result.skill);const version=result.skill.versions[0];edit({...empty,...version,slug:result.skill.slug,name:version?.name || result.skill.name,description:version?.description || result.skill.description,category:version?.category || result.skill.category,provenance:{...empty.provenance,...version?.provenance}});setNotes('');});
  const field=(key,value)=>{setDraft(d=>({...d,[key]:value}));setDirty(true);setReviewed(false);};
  const version=selected?.versions?.[0];
  const filtered=skills.filter(s=>[s.name,s.slug,s.category,s.status].join(' ').toLowerCase().includes(query.toLowerCase()));
  return <section style={{maxWidth:1200,margin:'auto',padding:'1rem'}}>
    <h1>Skills onboarding</h1>
    <p>Publish reviewed, versioned procedures for company users to choose in AI employee workspace → Skills. Publishing never assigns employees, grants tools, installs dependencies or executes imported code.</p>
    <div role="status" style={{color:'var(--accent)',marginBottom:12}}>{message}</div>
    <label>Search catalog <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, category or draft / active" /></label>
    <button disabled={busy} onClick={()=>{setSelected(null);edit(empty);setNotes('');}}>New skill</button>
    <p>{skills.length} platform skills · {skills.filter(s=>s.status==='active').length} published · {skills.filter(s=>s.status==='draft').length} drafts</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:16}}>
      <div style={{maxHeight:780,overflow:'auto'}}>
        {filtered.map(s=><button key={s.id} disabled={busy} onClick={()=>open(s)} style={{display:'block',width:'100%',textAlign:'left',padding:12,marginBottom:6,border:'1px solid var(--border)',borderRadius:8,background:selected?.id===s.id?'var(--surface-hover)':'var(--surface)',color:'var(--text)'}}>
          <strong>{s.name}</strong><br/><small>{s.category || 'Platform'} · {s.status==='active'?'Published':'Unpublished'} · published v{s.published_version || '—'} / latest v{s.latest_version}</small>
        </button>)}
      </div>
      <fieldset disabled={busy} style={{minWidth:0,border:0,padding:0}}>
        <h2>{selected?'Review / new version':'Onboard skill'}</h2>
        <label>Immutable GitHub SKILL.md URL<input style={{width:'100%'}} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://github.com/owner/repo/blob/40-character-commit/skills/name/SKILL.md" /></label>
        <button disabled={busy || !url} onClick={()=>action(async()=>{const r=await api.adminSkillGithubPreview(url);setSelected(null);edit({...empty,...r.package,provenance:{...empty.provenance,...r.package.provenance}});setMessage('Imported text for review. Relative resources / runtimes require explicit adaptation; no code installed.');})}>Preview GitHub import</button>
        <label style={{display:'block',marginTop:12}}>Upload SKILL.md<input type="file" accept=".md,text/markdown,text/plain" disabled={busy} onChange={e=>action(async()=>{const file=e.target.files?.[0];if (!file) return;if (file.size>131072) throw new Error('SKILL.md exceeds 128 KB');const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());field('skill_md',text);setMessage('Text loaded; check name, license and requirements before saving.');})}/></label>
        {['slug','name','description','category'].map(key=><label key={key} style={{display:'block',marginTop:10}}>{key}<input style={{width:'100%'}} disabled={key==='slug' && !!selected} value={draft[key] || ''} onChange={e=>field(key,e.target.value)} /></label>)}
        {['required_tools','required_connector_actions','required_mcp_tools','trigger_hints','external_requirements'].map(key=><label key={key} style={{display:'block',marginTop:10}}>{key.replaceAll('_',' ')} (comma/newline separated)<textarea style={{width:'100%'}} rows={2} value={(draft[key] || []).join('\n')} onChange={e=>field(key,split(e.target.value))}/></label>)}
        <p>Unresolved external requirements block execution readiness. Remove them only after adapting and validating against Flolah's granted capabilities.</p>
        <label style={{display:'block'}}>SKILL.md<textarea rows={16} style={{width:'100%',fontFamily:'monospace'}} value={draft.skill_md} onChange={e=>field('skill_md',e.target.value)}/></label>
        {['source_url','license','license_text'].map(key=><label key={key} style={{display:'block',marginTop:10}}>{key.replaceAll('_',' ')}<textarea style={{width:'100%'}} rows={key==='license_text'?4:1} value={draft.provenance?.[key] || ''} onChange={e=>field('provenance',{...draft.provenance,[key]:e.target.value})}/></label>)}
        <label style={{display:'block',marginTop:10}}>Text resources (JSON path → content; references/assets/examples only)<textarea rows={4} style={{width:'100%'}} value={resourceJson} onChange={e=>{setResourceJson(e.target.value);setDirty(true);setReviewed(false);}}/></label>
        {(draft.warnings || []).map(w=><p key={w} style={{color:'#b45309'}}>{w}</p>)}
        <button disabled={busy} onClick={()=>action(async()=>{let resources;try{resources=JSON.parse(resourceJson);}catch{throw new Error('Resource JSON is invalid; correct before saving.');}const pkg={...draft,resources};const r=selected?await api.adminSkillVersion(selected.id,pkg):await api.adminSkillCreate(pkg);setSelected(r.skill);edit({...pkg,...r.skill.versions[0]});setMessage('Draft saved. Review the persisted package/checksum before publishing.');})}>Save new draft version</button>
        {selected && <div style={{marginTop:18}}>
          <p>Latest persisted v{version?.version} · {version?.status}<br/><code style={{overflowWrap:'anywhere'}}>{version?.package_checksum || 'Legacy skill: save a reviewed new draft to onboard it.'}</code></p>
          {dirty && <p>Unsaved changes: save a draft before reviewing or publishing.</p>}
          <label><input type="checkbox" disabled={dirty} checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I reviewed the exact persisted instructions, license, references, dependencies and safety.</label>
          <textarea aria-label="Review notes" placeholder="Document what was verified and any runtime requirements" rows={3} style={{width:'100%',marginTop:8}} value={notes} onChange={e=>setNotes(e.target.value)}/>
          <button disabled={busy || dirty || !reviewed || notes.trim().length<15 || !version?.package_checksum} onClick={()=>action(async()=>{const r=await api.adminSkillPublish(selected.id,{version_id:version.id,package_checksum:version.package_checksum,reviewed,review_notes:notes});setSelected(r.skill);setReviewed(false);setMessage('Persisted version published. Users may opt in; existing pinned assignments are unchanged.');})}>Publish persisted version</button>
          <button disabled={busy || selected.status!=='active'} onClick={()=>action(async()=>{const r=await api.adminSkillUnpublish(selected.id);setSelected(r.skill);setMessage('Unpublished: hidden from new assignments and ineligible in new Flolah runtime selection. Running work is not interrupted.');})}>Unpublish</button>
          <details><summary>Version / review history</summary>{selected.versions.map(v=><p key={v.id}>v{v.version} · {v.status} · {v.review?.checked_at || 'Not reviewed'} · {v.review?.notes || ''}</p>)}</details>
        </div>}
      </fieldset>
    </div>
  </section>;
}

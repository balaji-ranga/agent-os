import { useEffect, useState } from 'react';
import { api } from '../api';
import ActionFeedbackBanner from '../components/ActionFeedbackBanner';
import { useActionFeedback } from '../hooks/useActionFeedback';

const blank={name:'',advertiser:'Flolah',disclosure:'Promotional announcement',delivery:'popup',audience:'all',frequency:'once',frequency_cap:1,priority:0,state:'draft',starts_at:'',ends_at:'',allow_suppress:true,target_user_ids:[],blocks:[{type:'heading',text:''},{type:'paragraph',text:''},{type:'cta',label:'Learn more',url:''}]};
const types=['heading','paragraph','image','video','audio','cta','disclosure'];
const labels={heading:'Heading',paragraph:'Paragraph',image:'Image',video:'Video',audio:'Audio',cta:'Button',disclosure:'Disclosure'};

export default function AdminPromotions(){
  const [items,setItems]=useState([]),[form,setForm]=useState(blank),[editingId,setEditingId]=useState(null),[users,setUsers]=useState([]),[busy,setBusy]=useState(false),[analytics,setAnalytics]=useState(null);
  const {feedback,showSuccess,showError,clearFeedback}=useActionFeedback();
  const load=()=>Promise.all([api.adminPromotionsList(),api.adminUsers({limit:500})]).then(([a,u])=>{setItems(a.campaigns||[]);setUsers(u.users||[])}).catch(e=>showError(e.message));
  useEffect(()=>{load()},[]);
  const update=(key,value)=>setForm(current=>({...current,[key]:value}));
  const setBlock=(i,key,value)=>setForm(current=>({...current,blocks:current.blocks.map((block,n)=>n===i?{...block,[key]:value}:block)}));
  const addBlock=type=>setForm(current=>({...current,blocks:[...current.blocks,{type,text:'',label:type==='cta'?'Learn more':'',url:'',alt:''}]}));
  const removeBlock=index=>setForm(current=>({...current,blocks:current.blocks.filter((_,n)=>n!==index)}));
  const reset=()=>{setEditingId(null);setForm(blank);clearFeedback()};
  const edit=campaign=>{setEditingId(campaign.id);setForm({...blank,...campaign,target_user_ids:campaign.target_user_ids||[],blocks:campaign.blocks||[]});window.scrollTo({top:0,behavior:'smooth'})};
  const save=async event=>{event.preventDefault();setBusy(true);try{editingId?await api.adminPromotionsUpdate(editingId,form):await api.adminPromotionsCreate(form);showSuccess('Campaign saved.');setForm(blank);setEditingId(null);await load()}catch(error){showError(error.message)}finally{setBusy(false)}};
  return <div className="page page-wide promotions-admin">
    <header className="promotions-hero"><div><span className="promotions-eyebrow">Audience engagement</span><h1>Internal promotions</h1><p>Create disclosed, targeted announcements and see honest delivery and interaction evidence.</p></div>{editingId&&<button type="button" className="btn-secondary" onClick={reset}>Create new campaign</button>}</header>
    <ActionFeedbackBanner feedback={feedback} onDismiss={clearFeedback}/>
    <form className="promotions-layout" onSubmit={save}>
      <div className="promotions-main">
        <section className="card promotions-section"><header><span className="promotions-step">1</span><div><h2>Campaign details</h2><p>Name the promotion and make its sponsor clear.</p></div></header><div className="promotions-fields two-columns">
          <label><span>Campaign name</span><input value={form.name} onChange={e=>update('name',e.target.value)} required placeholder="e.g. Founder plan launch"/></label>
          <label><span>Advertiser</span><input value={form.advertiser} onChange={e=>update('advertiser',e.target.value)} required/></label>
          <label className="field-full"><span>Disclosure</span><input value={form.disclosure} onChange={e=>update('disclosure',e.target.value)} required/><small>Shown with the promotion so users know it is sponsored.</small></label>
        </div></section>
        <section className="card promotions-section"><header><span className="promotions-step">2</span><div><h2>Audience and delivery</h2><p>Choose who receives it, where it appears, and how often.</p></div></header><div className="promotions-fields two-columns">
          <label><span>Delivery</span><select value={form.delivery} onChange={e=>update('delivery',e.target.value)}><option value="popup">Login popup</option><option value="whatsapp">WhatsApp</option><option value="both">Popup and WhatsApp</option></select></label>
          <label><span>Audience</span><select value={form.audience} onChange={e=>update('audience',e.target.value)}><option value="all">All enabled users</option><option value="selected">Selected users</option></select></label>
          {form.audience==='selected'&&<label className="field-full"><span>Selected users</span><select className="promotions-user-select" multiple value={form.target_user_ids} onChange={e=>update('target_user_ids',[...e.target.selectedOptions].map(o=>o.value))}>{users.map(user=><option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select><small>Use Ctrl/Cmd or Shift to select multiple users.</small></label>}
          <label><span>Frequency</span><select value={form.frequency} onChange={e=>update('frequency',e.target.value)}><option value="once">Once</option><option value="daily">Once daily</option><option value="capped">Capped</option></select></label>
          {form.frequency==='capped'&&<label><span>Maximum deliveries</span><input type="number" min="1" value={form.frequency_cap} onChange={e=>update('frequency_cap',Number(e.target.value))}/></label>}
        </div></section>
        <section className="card promotions-section"><header><span className="promotions-step">3</span><div><h2>Structured content</h2><p>Build the promotion in accessible, reusable blocks.</p></div></header><div className="promotion-block-list">
          {form.blocks.map((block,index)=><article className="promotion-block" key={`${block.type}-${index}`}><header><div><span className="promotion-block-number">{index+1}</span><strong>{labels[block.type]||block.type}</strong></div><button className="btn-ghost promotion-remove" type="button" onClick={()=>removeBlock(index)}>Remove</button></header>
            {['heading','paragraph','disclosure'].includes(block.type)&&<label><span>{block.type==='heading'?'Text':'Content'}</span><textarea rows={block.type==='heading'?2:4} value={block.text||''} onChange={e=>setBlock(index,'text',e.target.value)}/></label>}
            {['image','video','audio'].includes(block.type)&&<div className="promotions-fields two-columns"><label><span>Media URL</span><input placeholder="HTTPS media URL or /api/media path" value={block.url||''} onChange={e=>setBlock(index,'url',e.target.value)}/></label><label><span>{block.type==='image'?'Accessible description':'Transcript'}</span><input value={block.alt||block.text||''} onChange={e=>setBlock(index,block.type==='image'?'alt':'text',e.target.value)}/></label></div>}
            {block.type==='cta'&&<div className="promotions-fields two-columns"><label><span>Button label</span><input value={block.label||''} onChange={e=>setBlock(index,'label',e.target.value)}/></label><label><span>HTTPS destination</span><input type="url" value={block.url||''} onChange={e=>setBlock(index,'url',e.target.value)}/></label></div>}
          </article>)}
        </div><div className="promotion-add-blocks">{types.map(type=><button className="btn-secondary" type="button" key={type} onClick={()=>addBlock(type)}>+ {labels[type]}</button>)}</div></section>
      </div>
      <aside className="promotions-sidebar"><section className="card promotions-publish"><h2>Publish settings</h2>
        <label><span>State</span><select value={form.state} onChange={e=>update('state',e.target.value)}><option value="draft">Draft</option><option value="pending_approval">Pending approval</option><option value="scheduled">Scheduled</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
        <label><span>Starts</span><input type="datetime-local" value={form.starts_at||''} onChange={e=>update('starts_at',e.target.value)}/></label><label><span>Ends</span><input type="datetime-local" value={form.ends_at||''} onChange={e=>update('ends_at',e.target.value)}/></label><label><span>Priority</span><input type="number" min="0" value={form.priority} onChange={e=>update('priority',Number(e.target.value))}/></label>
        <label className="promotion-check"><input type="checkbox" checked={form.allow_suppress!==false} onChange={e=>update('allow_suppress',e.target.checked)}/><span>Allow users to dismiss this promotion</span></label>
        <button className="btn-primary promotions-save" disabled={busy}>{busy?'Saving…':editingId?'Update campaign':'Save campaign'}</button>{editingId&&<button type="button" className="btn-ghost" onClick={reset}>Cancel editing</button>}
      </section></aside>
    </form>
    <section className="promotions-campaigns"><header><div><h2>Campaigns</h2><p>Review delivery state and evidence for previous promotions.</p></div><span>{items.length} total</span></header><div className="promotions-campaign-grid">{!items.length&&<div className="card promotions-empty">No campaigns yet.</div>}{items.map(campaign=><article className="card promotion-campaign" key={campaign.id}><header><div><h3>{campaign.name}</h3><p>{campaign.advertiser}</p></div><span className={`promotion-state state-${campaign.state}`}>{String(campaign.state||'draft').replaceAll('_',' ')}</span></header><p>{campaign.delivery} · {campaign.audience} · {campaign.frequency}</p><footer><button className="btn-secondary" onClick={()=>edit(campaign)}>Edit campaign</button><button className="btn-ghost" onClick={()=>api.adminPromotionAnalytics(campaign.id).then(setAnalytics).catch(e=>showError(e.message))}>View evidence</button></footer></article>)}</div></section>
    {analytics&&<section className="card promotions-evidence"><header><h2>Evidence: {analytics.campaign.name}</h2><button className="btn-ghost" onClick={()=>setAnalytics(null)}>Close</button></header><div>{analytics.totals.map((total,index)=><p key={index}><strong>{total.total}</strong><span>{total.event_type} / {total.channel}</span><small>{total.users} users</small></p>)}</div></section>}
  </div>
}

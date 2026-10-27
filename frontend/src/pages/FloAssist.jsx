import {useCallback,useEffect,useState} from 'react';
import {Link,NavLink,useParams} from 'react-router-dom';
import {api} from '../api';
import FloAssistDeliveries from '../components/FloAssistDeliveries';
import './FloAssist.css';

const sections=[['connections','Connections'],['whatsapp','WhatsApp'],['reminders-deliveries','Reminders & deliveries'],['preferences','Preferences']];
const numbers=[['source_assessment_cache_minutes','Reuse unchanged verified assessments (minutes; 0 disables)',0,1440,120],['model_call_budget','Model requests per turn or scheduled run (including compaction)',1,256,80],['model_token_budget','Cumulative model tokens per turn or scheduled run',1000,10000000,2000000],['tool_call_budget','Flolah tool calls per request or run',10,256,80],['task_alert_max_days','Alert delivery days (0 = unlimited)',0,365,5],['due_soon_hours','Approaching deadline (hours)',1,744,72],['discovery_lookback_days','Discovery lookback (days)',1,90,7],['task_realert_hours','Repeat interval (hours)',0,720,24],['overdue_realert_hours','Overdue repeat interval (hours)',1,720,24],['task_alert_daily_limit','Maximum alerts per task per day',1,20,3],['notification_batch_minutes','Group notifications (minutes)',0,60,5]];

export default function FloAssist(){
 const {section='connections'}=useParams();
 const [data,setData]=useState(null),[prefs,setPrefs]=useState(null),[connections,setConnections]=useState(null),[qr,setQr]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[connectUrl,setConnectUrl]=useState('');
 const refresh=useCallback(async()=>{
  setConnections(null);const next=await api.floAssistManage();setData(next);setPrefs(next.preferences||{});
  if(next.enrolled){setConnections(await api.floAssistManageConnections());if(section==='whatsapp')setQr(await api.floAssistManageWhatsApp());}
 },[section]);
 useEffect(()=>{let active=true;setError('');refresh().catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[refresh]);
 useEffect(()=>{
  if(section!=='whatsapp'||!qr||qr.connected||!qr.qr_data_url)return;
  let stopped=false,timer;
  const poll=async()=>{try{const next=await api.floAssistManageWhatsAppWait();if(stopped)return;setQr(next);if(!next.connected)timer=setTimeout(poll,1500);}catch(e){if(!stopped)setError(e.message);}};
  void poll();return()=>{stopped=true;clearTimeout(timer);};
 },[section,!!qr?.qr_data_url,qr?.connected]);
 const act=async fn=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
 const save=async()=>{const result=await api.floAssistManageSave(prefs);setData(old=>({...old,...result}));setPrefs(result.preferences);setNotice('Preferences saved.');};
 const connect=app=>{
  const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;
  void act(async()=>{try{
   await save();const result=await api.floAssistManageConnect(app.id);const url=new URL(result.authorization_url,window.location.origin);
   if(url.protocol!=='https:'&&url.origin!==window.location.origin)throw Error('The connector returned an invalid connection link.');
   if(popup)popup.location.href=url.href;else setConnectUrl(url.href);
   setNotice('Finish connecting in the secure window, then refresh connection status.');
  }catch(e){popup?.close();throw e;}});
 };
 const selected=id=>prefs?.connectors?.includes(id);
 const toggle=id=>setPrefs(p=>({...p,connectors:selected(id)?p.connectors.filter(x=>x!==id):[...(p.connectors||[]),id]}));
 if(!sections.some(([id])=>id===section))return <section className="card floassist-page"><h1>FloAssist</h1><Link to="/floassist/connections">Open FloAssist</Link></section>;
 return <main className="floassist-page">
  <div className="page-hero"><p className="page-hero-kicker">Company Tools</p><h1>FloAssist</h1><p>Your WhatsApp assistant, powered by your COO.</p></div>
  <nav className="floassist-tabs" aria-label="FloAssist sections">{sections.map(([id,label])=><NavLink key={id} to={`/floassist/${id}`} className={({isActive})=>`btn ${isActive?'btn-primary':'btn-secondary'}`}>{label}</NavLink>)}</nav>
  {error&&<p className="floassist-feedback" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!data&&!error&&<p role="status">Loading FloAssist…</p>}
  {data&&!data.enrolled&&<section className="card floassist-panel"><h2>Set up your assistant</h2><p>Register FloAssist once to connect your apps and dedicated WhatsApp number.</p><a className="btn btn-primary" href="/free-tools/floassist/">Set up FloAssist</a></section>}
  {data?.enrolled&&<div className="floassist-actions"><span>Assistant: {data.status}</span><button className="btn btn-secondary" disabled={busy} onClick={()=>act(async()=>{const result=await api.floAssistManageStatus(data.status==='active'?'paused':'active');setData(old=>({...old,...result}));setNotice(result.status==='active'?'FloAssist is active.':'FloAssist is paused.');})}>{data.status==='active'?'Pause FloAssist':data.status==='onboarding'?'Start FloAssist':'Resume FloAssist'}</button></div>}
  {data?.enrolled&&section==='connections'&&<section className="card floassist-panel"><h2>Manage connections</h2><p>Choose the apps your assistant can use. Each connection belongs to your account.</p><div className="floassist-app-grid">{data.config.connectors.map(app=>{const linked=connections?.find(c=>c.id===app.id)?.connected;return <article className="floassist-app" key={app.id}><label><input type="checkbox" checked={selected(app.id)||false} disabled={busy} onChange={()=>toggle(app.id)}/> {app.label}</label><p>{selected(app.id)&&connections===null?'Checking connection…':linked?'Connected':selected(app.id)?'Not connected':'Not selected'}</p><button className="btn btn-secondary" disabled={busy||connections===null||!selected(app.id)} onClick={()=>connect(app)}>{linked?'Reconnect':'Connect'}</button></article>;})}</div><div className="floassist-actions"><button className="btn btn-primary" disabled={busy} onClick={()=>act(save)}>Save apps</button><button className="btn btn-secondary" disabled={busy} onClick={()=>act(refresh)}>Refresh status</button></div>{connectUrl&&<a href={connectUrl} target="_blank" rel="noopener noreferrer">Open secure app connection</a>}</section>}
  {data?.enrolled&&section==='whatsapp'&&<section className="card floassist-panel"><h2>WhatsApp</h2><p>Link your separate dedicated number. Your regular assistant conversations stay in WhatsApp.</p><p role="status">{qr?.connected?'Connected'+(qr.number?` · ${qr.number}`:''):qr?.message||'Check your WhatsApp connection or show a QR code.'}</p>{!qr?.connected&&typeof qr?.qr_data_url==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(qr.qr_data_url)&&<img className="floassist-qr" src={qr.qr_data_url} alt="Scan this QR code from Linked devices in your dedicated WhatsApp account"/>}<div className="floassist-actions"><button className="btn btn-primary" disabled={busy} onClick={()=>act(async()=>setQr(await api.floAssistManageWhatsAppStart()))}>Show / refresh QR</button><button className="btn btn-secondary" disabled={busy} onClick={()=>act(async()=>setQr(await api.floAssistManageWhatsApp()))}>Check status</button></div></section>}
  {data?.enrolled&&section==='reminders-deliveries'&&<FloAssistDeliveries timezone={prefs.timezone}/>}
  {data?.enrolled&&section==='preferences'&&<form className="card floassist-panel" onSubmit={e=>{e.preventDefault();void act(save);}}><h2>Alert preferences</h2><p>Quieted tasks stay open and available when you ask for pending work. Due-date colours: 🔴 overdue, 🟠 approaching, 🟢 later.</p><div className="floassist-fields">{numbers.map(([key,label,min,max,fallback])=><label key={key}>{label}<input className="input" type="number" min={min} max={max} required value={prefs[key]??fallback} onChange={e=>setPrefs(p=>({...p,[key]:Number(e.target.value)}))}/></label>)}<label>Timezone<input className="input" required value={prefs.timezone||''} onChange={e=>setPrefs(p=>({...p,timezone:e.target.value}))}/></label>{[['briefing_time','Briefing time'],['quiet_start','Quiet hours start'],['quiet_end','Quiet hours end']].map(([key,label])=><label key={key}>{label}<input className="input" type="time" required value={prefs[key]||''} onChange={e=>setPrefs(p=>({...p,[key]:e.target.value}))}/></label>)}</div>{[['include_due_this_month','Include open tasks due this month'],['briefing_overdue_high_priority','Include overdue high-priority tasks in morning briefing']].map(([key,label])=><label className="floassist-check" key={key}><input type="checkbox" checked={prefs[key]??true} onChange={e=>setPrefs(p=>({...p,[key]:e.target.checked}))}/>{label}</label>)}<button className="btn btn-primary" disabled={busy} type="submit">Save preferences</button></form>}
 </main>;
}

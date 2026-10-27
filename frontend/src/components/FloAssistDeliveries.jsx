import {useState} from 'react';
import {api} from '../api';

function deliveryLabel(key){const task=key.match(/:tracking:(\d+):/);if(task)return `Task #${task[1]} update`;if(/connection|health/.test(key))return 'Connection update';if(/storage/.test(key))return 'Storage alert';if(/:sg:/.test(key))return 'Scheduled goal update';if(/action/.test(key))return 'Action update';return 'FloAssist update';}
export default function FloAssistDeliveries({timezone}={}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=async()=>{setBusy(true);try{setData(await api.floAssistDeliveries());setError('');}catch(e){setError(e.message);}finally{setBusy(false);}};
  const act=async(kind,id,action)=>{
    const reason=window.prompt(action==='confirm_not_sent'?'Confirm you verified WhatsApp delivery history and this message was NOT sent. Enter evidence before allowing another attempt.':'Enter the reason or delivery verification evidence:');
    if(!reason)return;setBusy(true);
    try{await api.floAssistReconcile({kind,id,action,reason});await load();}catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const actions=(kind,id,status)=><>
    {['pending','uncertain'].includes(status)&&<button className="btn btn-secondary" disabled={busy} onClick={()=>act(kind,id,'cancel')}>Cancel</button>}
    {status==='uncertain'&&<><button className="btn btn-secondary" disabled={busy} onClick={()=>act(kind,id,'confirm_sent')}>Verified sent</button><button className="btn btn-secondary" disabled={busy} onClick={()=>act(kind,id,'confirm_not_sent')}>Verified not sent · retry</button></>}
  </>;
  return <section className="card" style={{padding:16,margin:'16px 0'}}>
    <h2>FloAssist reminders and deliveries</h2>
    <p>Your account only. Uncertain sends require delivery verification before retry. Quiet hours still apply.</p>
    <button className="btn btn-secondary" disabled={busy} onClick={load}>{data?'Refresh':'Load reminders and deliveries'}</button>
    {error&&<p role="alert">{error}</p>}
    {data&&<>
      <h3>Reminders</h3>{!data.reminders.length&&<p>No reminders.</p>}
      {data.reminders.map(r=><div key={r.id} style={{margin:'12px 0'}}><strong>{r.text||'Message content removed'}</strong><p>{r.due_local} · {r.timezone} · {r.status}</p>{actions('reminder',r.id,r.status)}</div>)}
      <h3>Recent notification deliveries</h3>
      {data.notifications.map(n=><div key={n.source_key} style={{margin:'12px 0'}}><p><strong>{deliveryLabel(n.source_key)}</strong> · {n.status} · {new Date(n.updated_at).toLocaleString(undefined,timezone?{timeZone:timezone}:{})}{timezone?` (${timezone})`:''}</p><details><summary>Delivery reference</summary><code style={{overflowWrap:'anywhere'}}>{n.source_key}</code></details>{actions('notification',n.source_key,n.status)}</div>)}
      <h3>Storage monitoring</h3>{!data.storage.length&&<p>No storage measurements yet. Only providers with supported quota reads can be measured.</p>}
      {data.storage.map((s,i)=><p key={i}>{s.app_id}: {s.coverage}{s.percent!=null?` · ${s.percent.toFixed(1)}% used`:''} · {new Date(s.checked_at).toLocaleString()}</p>)}
    </>}
  </section>;
}

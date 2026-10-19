import { useEffect, useState, useRef } from 'react';
import { api } from '../../api.js';
export default function CopilotConnectorFields({
  config,
  onChange
}) {
  const [groups, setGroups] = useState([]),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false);
  const pendingRefresh=useRef(null);
  const refresh = async () => {
    if(pendingRefresh.current)return pendingRefresh.current;
    setRefreshing(true);
    pendingRefresh.current=(async()=>{
    try {
      const out = await api.copilotGroups();
      setGroups(out.groups || []);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {setRefreshing(false);pendingRefresh.current=null;}
    })();
    return pendingRefresh.current;
  };
  useEffect(() => {
    refresh();
  }, []);
  const attrs = config.copilot || {},
    set = patch => onChange({
      ...config,
      copilot: {
        ...attrs,
        ...patch
      }
    }),
    group = groups.find(g => g.groupId === attrs.groupId);
  return <fieldset className="wf-field"><legend>Website copilot targets</legend>
  <p>Link one copilot directly or add separately authorized copilots to a selected target group. Pairing is optional for peer handoffs. Save the named group and websites once; each run uses current online connections. Offline targets fail; future visitors receive nothing.</p>
  <label>Copilot workflow link code<input value={code} onChange={e => setCode(e.target.value)} autoComplete="off" placeholder="From copilot → Link this copilot" /></label>
  <button type="button" className="wf-btn" disabled={busy} aria-busy={busy} onClick={async () => {
      if(busy)return;setBusy(true);
      try {
        const linked=await api.copilotLink(code.trim(),group?.groupId);set({groupId:linked.groupId,websiteIds:attrs.websiteIds||[],instanceIds:undefined});
        setCode('');
        await refresh();
      } catch (e) {
        setError(e.message);
      }finally{setBusy(false);}
    }}>{busy?'Linking…':group?'Add copilot to selected group':'Link copilot as new group'}</button>
  <button type="button" className="wf-btn" disabled={refreshing} aria-busy={refreshing} onClick={refresh}>{refreshing?'Refreshing…':'Refresh online copilots'}</button>
  <label>Workflow target group<select value={attrs.groupId || ''} onChange={e => set({
        groupId: e.target.value,
        websiteIds: [],
        instanceIds: undefined
      })}><option value="">Select a saved target group</option>{groups.map(g => <option key={g.groupId} value={g.groupId}>{g.name||'Paired group'} · {g.instances?.filter(i=>i.active).length||0} online · {g.groupId.slice(0,8)}</option>)}</select></label>
  <label>Websites<select multiple value={attrs.websiteIds || []} onChange={e => set({
        websiteIds: Array.from(e.target.selectedOptions, o => o.value)
      })}>{(group?.websites || []).map(w => <option key={w.websiteId} value={w.websiteId}>{w.origin} · {w.environment}</option>)}</select></label>
  {!group && attrs.websiteIds?.length > 0 && <p>Saved websites: {attrs.websiteIds.join(', ')}. This group is offline; execution will fail preflight.</p>}
  <label>Recipients<select value={attrs.instanceIds === undefined ? 'all' : 'selected'} onChange={e => set({
        instanceIds: e.target.value === 'all' ? undefined : []
      })}><option value="all">All authorized active instances on selected websites</option><option value="selected">Select exact active instances</option></select></label>
  {attrs.instanceIds !== undefined && <label>Instances<select multiple value={attrs.instanceIds} onChange={e => set({
        instanceIds: Array.from(e.target.selectedOptions, o => o.value)
      })}>{(group?.instances || []).filter(i => (attrs.websiteIds || []).includes(i.websiteId)).map(i => <option key={i.instanceId} value={i.instanceId} disabled={!i.active}>{i.instanceId.slice(0, 8)} · {i.active ? 'online' : 'offline'}</option>)}</select></label>}
  <label>Instruction<textarea value={attrs.instruction || ''} onChange={e => set({
        instruction: e.target.value
      })} placeholder="Use task handles for private passages and values" /></label>
  <label>Task handle / ID<input value={attrs.taskId || ''} onChange={e => set({
        taskId: e.target.value || undefined
      })} /></label>
  <label>Result handles from earlier task steps (one per line)<textarea value={(attrs.inputs?.taskHandles || []).join('\n')} onChange={e => set({
        inputs: {
          ...attrs.inputs,
          taskHandles: e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
        }
      })} /></label>
  <label>Owner-reviewed native action binding ID (submission only)<input value={attrs.inputs?.bindingId || ''} onChange={e => set({
        inputs: {
          ...attrs.inputs,
          bindingId: e.target.value
        }
      })} /></label>
  <label>Delivery validity (ms)<input type="number" min="1000" max="60000" value={attrs.deliveryMs || 60000} onChange={e => set({
        deliveryMs: Number(e.target.value)
      })} /></label>
  <label>Fan-out limit<input type="number" min="1" max="25" value={attrs.fanoutLimit || 25} onChange={e => set({
        fanoutLimit: Number(e.target.value)
      })} /></label>
  <label>Required outcome<select value={attrs.requiredOutcome||'effect_observed'} onChange={e=>set({requiredOutcome:e.target.value})}><option value="effect_observed">Existing effect contract</option><option value="local_state_verified">Field or navigation verified</option><option value="host_reported_saved">Website reports saved</option><option value="business_verified">Trusted saved-record receipt</option></select></label>
  <p>A stronger outcome requires matching host evidence. A timeout or success toast cannot prove a saved record. Unknown writes are never replayed.</p>
  <label>Execution timeout (ms)<input type="number" min="1000" max="120000" value={attrs.executionMs || 60000} onChange={e => set({
        executionMs: Number(e.target.value)
      })} /></label>
  <p>Every captured recipient must succeed. Filling and submitting use Flolah Action Policies. Private content stays task-bound and is not stored in workflow outputs.</p>
  {error && <p role="alert">{error} Check the group code, online participants and each website’s owner-enabled workflow permission. <a href="/free-tools/digital-adoption/owner.html" target="_blank" rel="noreferrer">Website owner settings</a></p>}
 </fieldset>;
}

import { useEffect, useState } from 'react';
import { api } from '../../api.js';
export default function CopilotConnectorFields({
  config,
  onChange
}) {
  const [groups, setGroups] = useState([]),
    [code, setCode] = useState(''),
    [error, setError] = useState('');
  const refresh = async () => {
    try {
      const out = await api.copilotGroups();
      setGroups(out.groups || []);
      setError('');
    } catch (e) {
      setError(e.message);
    }
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
  return <fieldset className="wf-field"><legend>Paired website copilots</legend>
  <p>Only your explicitly linked group receives commands. Offline targets fail the step; future visitors receive nothing.</p>
  <label>Pairing group link code<input value={code} onChange={e => setCode(e.target.value)} autoComplete="off" placeholder="From paired copilot → Link group" /></label>
  <button type="button" className="wf-btn" onClick={async () => {
      try {
        await api.copilotLink(code.trim());
        setCode('');
        await refresh();
      } catch (e) {
        setError(e.message);
      }
    }}>Link my paired group</button>
  <button type="button" className="wf-btn" onClick={refresh}>Refresh online copilots</button>
  <label>Runtime group<select value={attrs.groupId || ''} onChange={e => set({
        groupId: e.target.value,
        websiteIds: [],
        instanceIds: undefined
      })}><option value="">Select a linked group</option>{groups.map(g => <option key={g.groupId} value={g.groupId}>{g.groupId}</option>)}</select></label>
  <label>Websites<select multiple value={attrs.websiteIds || []} onChange={e => set({
        websiteIds: Array.from(e.target.selectedOptions, o => o.value)
      })}>{(group?.websites || []).map(w => <option key={w.websiteId} value={w.websiteId}>{w.origin} · {w.environment}</option>)}</select></label>
  {!group && attrs.websiteIds?.length > 0 && <p>Saved websites: {attrs.websiteIds.join(', ')}. This group is offline; execution will fail preflight.</p>}
  <label>Recipients<select value={attrs.instanceIds === undefined ? 'all' : 'selected'} onChange={e => set({
        instanceIds: e.target.value === 'all' ? undefined : []
      })}><option value="all">All active paired instances on selected websites</option><option value="selected">Select exact active instances</option></select></label>
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
  <label>Execution timeout (ms)<input type="number" min="1000" max="120000" value={attrs.executionMs || 60000} onChange={e => set({
        executionMs: Number(e.target.value)
      })} /></label>
  <p>Every captured recipient must succeed. Filling and submitting use Flolah Action Policies. Private content stays task-bound and is not stored in workflow outputs.</p>
  {error && <p role="alert">{error}</p>}
 </fieldset>;
}

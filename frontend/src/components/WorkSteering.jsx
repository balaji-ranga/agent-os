import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const button = { padding: '0.45rem 0.85rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', font: 'inherit' };
export default function WorkSteering({ agentId = null }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState([]);
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const input = useRef(null);
  const trigger = useRef(null);
  const dialog = useRef(null);
  const requestKey = useRef(null);
  const work = targets.find(t => `${t.kind}:${t.id}` === selected);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoaded(false); setError(''); setNotice('');
    api.steeringTargets(agentId).then(data => { if (active) { setTargets(data.targets || []); setSelected(''); setNotes([]); setLoaded(true); } })
      .catch(e => { if (active) { setError(e.message); setLoaded(true); } });
    dialog.current?.querySelector('button')?.focus();
    const escape = e => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'Tab') {
        const elements = [...(dialog.current?.querySelectorAll('button:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || [])];
        const first = elements[0], last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', escape);
    return () => { active = false; window.removeEventListener('keydown', escape); trigger.current?.focus(); };
  }, [open, agentId]);
  useEffect(() => {
    if (!open || !work) return;
    let active = true;
    const refresh = () => api.steeringHistory(work.kind, work.id).then(data => { if (active) setNotes(data.notes || []); }).catch(e => { if (active) setError(e.message); });
    refresh(); input.current?.focus();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [open, selected]);
  async function send(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!work || !message.trim() || busy) return;
    setBusy(true); setError('');
    requestKey.current ||= crypto.randomUUID();
    try {
      const out = await api.steerWork({ target_kind: work.kind, target_id: work.id, message: message.trim(), idempotency_key: requestKey.current });
      setNotice(out.message); setMessage(''); requestKey.current = null;
      setNotes((await api.steeringHistory(work.kind, work.id)).notes || []);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <>
    <button ref={trigger} type="button" style={button} onClick={() => setOpen(true)} title="Queue guidance without interrupting current work">Steer work</button>
    {open && <div className="work-steer-backdrop">
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="work-steer-title" className="work-steer-dialog">
        <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><h2 id="work-steer-title" style={{ margin: 0 }}>Steer existing work</h2><button type="button" style={button} onClick={() => setOpen(false)} aria-label="Close steer dialog">Close</button></header>
        <p>Send guidance at the next safe agent/tool/step checkpoint. Current work continues. This does not restart work, rewrite its plan, change permissions, or guarantee that guidance is applied.</p>
        <form onSubmit={send}>
          <label htmlFor="work-steer-target">Existing work</label>
          <select id="work-steer-target" value={selected} onChange={e => { setSelected(e.target.value); setNotice(''); requestKey.current = null; }} disabled={!loaded || busy}>
            <option value="">{!loaded ? 'Loading work…' : targets.length ? 'Choose an exact work item' : 'No active work; send a normal chat follow-up'}</option>
            {targets.map(t => <option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>{t.kind === 'schedule' ? 'Schedule · NEXT RUN' : t.kind} · {t.agent_id} · {t.title} · {t.id}</option>)}
          </select>
          {work && <p className="work-steer-hint">{work.delivery}. If work finishes before a checkpoint, the note is not applied and does not carry over to another task.</p>}
          <label htmlFor="work-steer-message">Guidance</label>
          <textarea ref={input} id="work-steer-message" rows={4} maxLength={4000} value={message} onChange={e => { setMessage(e.target.value); requestKey.current = null; }} disabled={busy} placeholder="For the remaining work, please…" />
          <button type="submit" style={button} disabled={!work || !message.trim() || busy}>{busy ? 'Queueing…' : 'Queue guidance'}</button>
        </form>
        {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!!notes.length && <div className="work-steer-history"><h3>Guidance delivery</h3>{notes.map(n => <article key={n.id}><small>{n.status === 'delivered' ? `Delivered to agent context · ${n.checkpoint} · application unverified` : n.status === 'not_applied' ? 'Not applied — work ended before delivery' : n.status}</small><p>{n.message}</p></article>)}</div>}
      </section>
    </div>}
  </>;
}

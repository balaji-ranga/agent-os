import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import ChatMessageContent from './ChatMessageContent.jsx';

const button = { padding: '0.45rem 0.85rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', font: 'inherit' };
export default function AgentSlashCommands({ agentId, commandRequest = null, onSelectSkill }) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState('/flolah');
  const [catalog, setCatalog] = useState([]);
  const [skills, setSkills] = useState([]);
  const [search, setSearch] = useState('');
  const [output, setOutput] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(null), trigger = useRef(null), dialog = useRef(null), input = useRef(null);
  function edit(value) { setCommand(value); requestKey.current = null; setError(''); }
  useEffect(() => {
    if (!commandRequest) return;
    edit(commandRequest.text); setOpen(true);
  }, [commandRequest]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    api.agentCommandCatalog(agentId).then(out => { if (active) { setCatalog(out.tools || []); setSkills(out.skills || []); } }).catch(e => { if (active) setError(e.message); });
    input.current?.focus();
    const keyboard = e => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key !== 'Tab') return;
      const items = [...(dialog.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)') || [])];
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => { active = false; window.removeEventListener('keydown', keyboard); trigger.current?.focus(); };
  }, [open, agentId]);
  async function execute(e) {
    e.preventDefault(); e.stopPropagation();
    if (busy || !command.trim()) return;
    setBusy(true); setError(''); setOutput(null);
    requestKey.current ||= crypto.randomUUID();
    try { setOutput(await api.agentCommandSend(agentId, command.trim(), requestKey.current)); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const matches = catalog.filter(t => `${t.name} ${t.purpose || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <button ref={trigger} type="button" style={button} onClick={() => setOpen(true)} title="Platform tools and steering, also available on WhatsApp">/ Commands</button>
    {open && <div className="work-steer-backdrop"><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="slash-command-title" className="work-steer-dialog">
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><h2 id="slash-command-title" style={{ margin: 0 }}>Flolah / commands</h2><button type="button" style={button} onClick={() => setOpen(false)}>Close</button></header>
      <p>Same syntax in a private WhatsApp chat. Tools use existing grants, governance and approvals. Steering queues guidance for exact existing work without interrupting it. CEO or CEO Delegate access is required.</p>
      <nav aria-label="Command shortcuts" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[['Help', '/flolah'], ['Find skills', '/flolah skills'], ['Find tools', '/flolah tools'], ['List work to steer', '/flolah steer']].map(([label, text]) => <button type="button" key={label} disabled={busy} style={button} onClick={() => edit(text)}>{label}</button>)}
      </nav>
      <form onSubmit={execute}>
        <label htmlFor="slash-command-input">Command and JSON arguments</label>
        <textarea ref={input} id="slash-command-input" rows={4} maxLength={16000} disabled={busy} value={command} onChange={e => edit(e.target.value)} spellCheck={false} />
        <button type="submit" disabled={busy || !command.trim()} style={button}>{busy ? 'Submitting through governance…' : 'Run command'}</button>
      </form>
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      {output && <section aria-label="Command result" aria-live="polite">
        <small>Router outcome: {output.route}{output.replayed ? ' · previously submitted result' : ''}</small>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 300, overflow: 'auto' }}>{output.reply}</pre>
        {output.media_uri && <ChatMessageContent content={output.media_uri} />}
        {output.skill && onSelectSkill && <button type="button" style={button} disabled={busy} onClick={() => { onSelectSkill(output.skill, output.prompt); setOpen(false); }}>Use skill in chat</button>}
        {!!output.targets?.length && <div>{output.targets.map(t => <button key={`${t.kind}:${t.id}`} type="button" disabled={busy} style={button} onClick={() => edit(`/flolah steer ${t.kind}:${t.id} `)}>{t.kind} · {t.title} · Prepare guidance</button>)}</div>}
      </section>}
      <h3>Agent skills · {skills.length}</h3>
      {!skills.length && <p>No enabled skills assigned to this agent.</p>}
      <div style={{ maxHeight: 180, overflow: 'auto' }}>{skills.map(s => <article key={s.skill_id} style={{ marginBottom: 10 }}><strong>{s.name} · v{s.version}</strong><p>{s.description}</p><small>{s.ready ? 'Ready · operating instructions, not tool permissions' : `Not ready: ${(s.missing || []).join(', ')}`}</small><div><button type="button" style={button} disabled={busy || !s.ready} onClick={() => { onSelectSkill?.(s, ''); setOpen(false); }}>Select for next chat</button><button type="button" style={button} disabled={busy || !s.ready} onClick={() => edit(`/flolah skill ${s.slug}`)}>Skill command / WhatsApp help</button></div></article>)}</div>
      <h3>Granted platform tools · {catalog.length}</h3>
      <label htmlFor="slash-tool-search">Filter tools</label><input id="slash-tool-search" value={search} onChange={e => setSearch(e.target.value)} />
      <div style={{ maxHeight: 180, overflow: 'auto' }}>{matches.slice(0, 80).map(t => <div key={t.name} style={{ marginBottom: 8 }}><button type="button" disabled={busy} style={button} onClick={() => edit(`/flolah tool ${t.name} {}`)}>{t.name}</button><small style={{ display: 'block' }}>{t.purpose || t.display_name}</small></div>)}</div>
      <p>Choosing a tool only prepares the command. Add its required JSON arguments and press Run. Native shell commands are not exposed here. WhatsApp’s built-in /steer is separate: use /flolah steer for this queue.</p>
    </section></div>}
  </>;
}

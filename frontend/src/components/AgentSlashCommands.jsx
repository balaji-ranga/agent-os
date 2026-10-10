import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import ChatMessageContent from './ChatMessageContent.jsx';
import { CHAT_CAPABILITY_LIMIT } from '../utils/chatCapabilitySelection.js';

const button = { padding: '0.4rem 0.7rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', font: 'inherit' };
export function ChatCapabilitySelections({ skills, tools, onRemoveSkill, onRemoveTool }) {
  if (!skills.length && !tools.length) return null;
  const chip = { ...button, maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'anywhere', fontSize: '0.85rem' };
  return <div role="group" aria-label="Selected skills and tools for next task" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flexShrink: 0, maxHeight: 120, overflowY: 'auto', padding: '6px 0' }}>
    {skills.map(skill => <button key={skill.skill_id} type="button" style={chip} onClick={() => onRemoveSkill(skill.skill_id)}>Clear skill: {skill.name} · v{skill.version}</button>)}
    {tools.map(tool => <button key={tool.name} type="button" style={chip} onClick={() => onRemoveTool(tool.name)}>Clear tool: {tool.name}</button>)}
  </div>;
}
/** Composer-owned picker. Only the chat's Send/Enter submits a command. */
export function CapabilityChoiceButton({ kind, item, selected, count, busy, ready = true, onSelect }) {
  const name = item.name;
  return <button type="button" style={button} aria-pressed={selected} disabled={busy || !ready || (!selected && count >= CHAT_CAPABILITY_LIMIT)} onClick={() => onSelect(item)}>{selected ? `Remove ${kind}: ${name}` : kind === 'skill' ? `Select skill: ${name}` : `${name} · Use for task`}</button>;
}
export default function AgentSlashCommands({ agentId, commandText = '', commandRequest = null, selectedSkills = [], selectedTools = [], onPrepareCommand, onSelectSkill, onSelectTool, onBusyChange }) {
  const [catalog, setCatalog] = useState([]), [skills, setSkills] = useState([]), [search, setSearch] = useState('');
  const [output, setOutput] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const processed = useRef(null), pending = useRef(false);
  const open = commandText.trimStart().startsWith('/') || !!output || !!error || busy;
  useEffect(() => { setOutput(null); setError(''); setCatalog([]); setSkills([]); setSearch(''); }, [agentId]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    api.agentCommandCatalog(agentId).then(out => { if (active) { setCatalog(out.tools || []); setSkills(out.skills || []); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [open, agentId]);
  useEffect(() => {
    if (!commandRequest || processed.current === commandRequest.key || pending.current) return;
    processed.current = commandRequest.key;
    pending.current = true; setBusy(true); onBusyChange?.(true); setError(''); setOutput(null);
    api.agentCommandSend(agentId, commandRequest.text, commandRequest.key)
      .then(setOutput).catch(e => setError(e.message))
      .finally(() => { pending.current = false; setBusy(false); onBusyChange?.(false); });
  }, [commandRequest, agentId, onBusyChange]);
  const close = () => { if (busy) return; setOutput(null); setError(''); onPrepareCommand?.(''); };
  const prepare = text => { setOutput(null); setError(''); onPrepareCommand?.(text); };
  const select = (skill, prompt = '') => { setOutput(null); setError(''); onSelectSkill?.(skill, prompt); };
  useEffect(() => {
    if (!open) return;
    const keyboard = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [open, busy, onPrepareCommand]);
  if (!open) return null;
  const typedSearch = commandText.match(/^\/(?:flolah\s+)?(?:skills?|tools?)\s+([^\s]*)\s*$/i)?.[1] || '';
  const query = (search || typedSearch).toLowerCase();
  const matchingSkills = skills.filter(s => `${s.name} ${s.slug} ${s.description || ''}`.toLowerCase().includes(query));
  const matches = catalog.filter(t => `${t.name} ${t.purpose || ''}`.toLowerCase().includes(query));
  return <section role="region" aria-label="Chat slash command picker" className="chat-slash-picker">
    <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}><strong>Skills, tools & steer</strong><button type="button" disabled={busy} style={button} onClick={close}>Close commands</button></header>
    <small>Select up to five skills and five tools, then close the picker, describe your task in the message box and Send. Selections apply together to the next agent request. Direct commands and steer also use the message box.</small>
    <p role="status">Selected: {selectedSkills.length}/{CHAT_CAPABILITY_LIMIT} skills · {selectedTools.length}/{CHAT_CAPABILITY_LIMIT} tools. Click a selected item again to remove it.</p>
    <nav aria-label="Command shortcuts" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {[['Help', '/flolah'], ['Find skills', '/flolah skills'], ['Find tools', '/flolah tools'], ['List work to steer', '/flolah steer']].map(([label, text]) => <button type="button" key={label} disabled={busy} style={button} onClick={() => prepare(text)}>{label}</button>)}
    </nav>
    {busy && <p role="status">Submitting through governance…</p>}
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    {output && <section aria-label="Command result" aria-live="polite">
      <small>Router outcome: {output.route}{output.replayed ? ' · previously submitted result' : ''}</small>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 160, overflow: 'auto' }}>{output.reply}</pre>
      {output.media_uri && <ChatMessageContent content={output.media_uri} />}
      {output.skill && onSelectSkill && <button type="button" style={button} disabled={busy} onClick={() => select(output.skill, output.prompt)}>Use skill in chat</button>}
      {!!output.targets?.length && <div>{output.targets.map(t => <button key={`${t.kind}:${t.id}`} type="button" disabled={busy} style={button} onClick={() => prepare(`/flolah steer ${t.kind}:${t.id} `)}>{t.kind} · {t.title} · Prepare guidance</button>)}</div>}
    </section>}
    <label style={{ display: 'block', margin: '8px 0' }}>Filter skills and tools <input aria-label="Filter skills and tools" value={search} onChange={e => setSearch(e.target.value)} /></label>
    <h3>Agent skills · {skills.length}</h3>
    {!skills.length && <p>No enabled skills assigned to this agent.</p>}
    <div style={{ maxHeight: 150, overflow: 'auto' }}>{matchingSkills.map(s => <article key={s.skill_id} style={{ marginBottom: 10 }}><strong>{s.name} · v{s.version}</strong><p>{s.description}</p><small>{s.ready ? 'Ready · operating instructions, not tool permissions' : `Not ready: ${(s.missing || []).join(', ')}`}</small><div><CapabilityChoiceButton kind="skill" item={s} selected={selectedSkills.some(skill => skill.skill_id === s.skill_id)} count={selectedSkills.length} busy={busy} ready={s.ready} onSelect={select} /><button type="button" style={button} disabled={busy || !s.ready} onClick={() => prepare(`/flolah skill ${s.slug}`)}>Skill command / WhatsApp help</button></div></article>)}</div>
    <h3>Granted platform tools · {catalog.length}</h3>
    <div style={{ maxHeight: 130, overflow: 'auto' }}>{matches.slice(0, 80).map(t => <div key={t.name} style={{ marginBottom: 8 }}><CapabilityChoiceButton kind="tool" item={t} selected={selectedTools.some(tool => tool.name === t.name)} count={selectedTools.length} busy={busy} onSelect={tool => { setOutput(null); setError(''); onSelectTool?.(tool); }} /><button type="button" disabled={busy} style={button} onClick={() => prepare(`/flolah tool ${t.name} {}`)}>Prepare direct command</button><small style={{ display: 'block' }}>{t.purpose || t.display_name}</small></div>)}</div>
    <small>Only assigned, ready skills and granted tools. Add required JSON arguments in the message box. WhatsApp uses /flolah; its built-in /steer is separate.</small>
  </section>;
}

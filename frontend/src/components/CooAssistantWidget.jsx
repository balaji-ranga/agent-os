import { useEffect, useState } from 'react';
import { api } from '../api';
import AgentChatPanel from './AgentChatPanel';

export default function CooAssistantWidget() {
  const [open, setOpen] = useState(false); const [coo, setCoo] = useState(null);
  useEffect(() => { api.agentsList().then((r) => { const rows = Array.isArray(r) ? r : r.agents || []; setCoo(rows.find((a) => a.id === 'balserve' || a.is_coo || /chief operating|\bcoo\b/i.test(`${a.name || ''} ${a.role || ''}`))); }).catch(() => {}); }, []);
  if (!coo) return null;
  return <aside className={`coo-assistant-widget${open ? ' open' : ''}`}><button className="coo-assistant-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? '×' : '✦'}<span>{open ? 'Close' : 'COO'}</span></button>{open && <div className="coo-assistant-panel"><header><strong>{coo.name || 'COO'}</strong><small>Company coordinator</small></header><AgentChatPanel agentId={coo.id} minHeight={360} placeholder="Ask your COO…" /></div>}</aside>;
}

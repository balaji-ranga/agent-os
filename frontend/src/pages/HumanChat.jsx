import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function HumanChat() {
  const { userId } = useParams();
  const { user } = useAuth();
  const [directory, setDirectory] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const person = useMemo(() => directory.find((p) => p.id === userId), [directory, userId]);

  useEffect(() => { api.humanDirectory().then((r) => setDirectory(r.people || [])).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    if (!userId || userId === user?.id) return;
    api.humanDirectConversation(userId).then((r) => setConversation(r.conversation)).catch((e) => setError(e.message));
  }, [userId, user?.id]);
  useEffect(() => {
    if (!conversation?.id) return undefined;
    let alive = true;
    const load = () => api.humanMessages(conversation.id).then((r) => { if (alive) { setMessages(r.messages || []); const last = r.messages?.at(-1); if (last) api.humanConversationRead(conversation.id, last.id).catch(() => {}); } }).catch((e) => alive && setError(e.message));
    load(); const timer = setInterval(load, 2000); return () => { alive = false; clearInterval(timer); };
  }, [conversation?.id]);
  const send = async (e) => { e.preventDefault(); if (!input.trim() || !conversation) return; setBusy(true); try { await api.humanMessageSend(conversation.id, { body: input.trim() }); setInput(''); const r = await api.humanMessages(conversation.id); setMessages(r.messages || []); } catch (x) { setError(x.message); } finally { setBusy(false); } };
  const invite = async () => { try { const r = await api.humanVoiceInvite(userId); await navigator.clipboard.writeText(r.url); window.open(r.url, '_blank', 'noopener,noreferrer'); } catch (e) { setError(e.message); } };
  const archive = async () => { if (!conversation) return; try { await api.humanConversationArchive(conversation.id, true); setConversation((c) => ({ ...c, archived: true })); } catch (e) { setError(e.message); } };
  return <div className="human-chat-page">
    <header className="human-chat-header"><div><Link to="/org">← Company</Link><h1>{person?.name || 'Human employee'}</h1><p>{[person?.role_title, person?.department].filter(Boolean).join(' · ') || 'Company user'}</p></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={archive} disabled={!conversation || conversation.archived}>Archive</button><button onClick={invite} disabled={!person?.channels?.voice}>☎ Voice call link</button></div></header>
    {error && <div className="error-box">{error}</div>}
    <section className="human-chat-thread" aria-live="polite">{messages.length ? messages.map((m) => <article key={m.id} className={m.sender_user_id === user?.id ? 'mine' : ''}><strong>{m.sender_name}</strong><p>{m.body}</p><time>{m.created_at}</time></article>) : <div className="empty-state">Start a private company conversation. Messages are isolated to your company and these participants.</div>}</section>
    <form className="human-chat-compose" onSubmit={send}><textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Message ${person?.name || 'employee'}…`} /><button disabled={busy || !input.trim()}>{busy ? 'Sending…' : 'Send'}</button></form>
  </div>;
}

import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import ChatMessageRow from './ChatMessageRow';
import ChatComposeInput from './ChatComposeInput';
import { useAuth } from '../context/AuthContext';
import { buildMessageWithAttachments, uploadChatAttachments } from '../utils/chatAttachments.js';

/**
 * Embeddable chat panel for an OpenClaw agent.
 */
export default function AgentChatPanel({
  agentId,
  profileId = null,
  placeholder = 'Message…',
  minHeight = 280,
  quickActions = [],
}) {
  const { dataCeoUserId } = useAuth();
  const [turns, setTurns] = useState([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!agentId) return;
    api.agentChatHistory(agentId)
      .then(setTurns)
      .catch(() => setTurns([]));
  }, [agentId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  const sendMessage = async (msg, files = []) => {
    const userText = String(msg || '').trim();
    if ((!userText && !files.length) || sending) return;
    const displayMsg =
      userText || `(Attached ${files.length} file${files.length === 1 ? '' : 's'})`;
    setSending(true);
    setError(null);
    setTurns((prev) => [...prev, { role: 'user', content: displayMsg, created_at: new Date().toISOString() }]);
    try {
      const uploaded = files.length ? await uploadChatAttachments(files) : [];
      const outbound = buildMessageWithAttachments(userText, uploaded);
      const r = await api.agentChatSend(agentId, outbound, dataCeoUserId || 'default', profileId);
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: r.reply,
          created_at: new Date().toISOString(),
          tool_calls: r.tool_calls || [],
        },
      ]);
    } catch (e) {
      setError(e.message);
      setTurns((prev) => prev.filter((t) => t.role !== 'user' || t.content !== displayMsg));
      throw e;
    } finally {
      setSending(false);
    }
  };

  const send = async (e) => {
    e.preventDefault();
    if ((!input.trim() && !attachments.length) || sending) return;
    const text = input.trim();
    const files = [...attachments];
    setInput('');
    setAttachments([]);
    try {
      await sendMessage(text, files);
    } catch (_) {
      setInput(text);
      setAttachments(files);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight }}>
      {error && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(248,113,113,0.15)', borderRadius: 6, marginBottom: '0.5rem', color: '#f87171', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight,
          maxHeight: 420,
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '0.75rem',
          marginBottom: '0.5rem',
        }}
      >
        {turns.length === 0 && !sending && (
          <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            Chat with the agent. Attach images/docs to upload into Master Data for RAG.
          </div>
        )}
        {turns.map((t, i) => (
          <ChatMessageRow
            key={t.id || i}
            role={t.role}
            content={t.content}
            createdAt={t.created_at}
            agentId={agentId}
            messageId={t.id}
            feedbackSource="chat"
            feedbackContext={profileId ? { profile_id: profileId } : {}}
            toolCalls={t.tool_calls}
          />
        ))}
        {sending && <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>…</div>}
      </div>
      {quickActions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {quickActions.map((qa) => (
            <button
              key={qa.label}
              type="button"
              disabled={sending}
              onClick={() => sendMessage(qa.message)}
              style={{
                padding: '0.35rem 0.65rem',
                fontSize: '0.8rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: sending ? 'not-allowed' : 'pointer',
              }}
            >
              {qa.label}
            </button>
          ))}
        </div>
      )}
      <form onSubmit={send} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        <ChatComposeInput
          placeholder={`${placeholder} (Shift+Enter for new line)`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onSend={send}
          disabled={sending}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          rows={3}
          style={{
            flex: 1,
            padding: '0.6rem 0.75rem',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            resize: 'vertical',
            minHeight: 56,
            font: 'inherit',
          }}
        />
        <button
          type="submit"
          disabled={sending || (!input.trim() && !attachments.length)}
          style={{
            padding: '0.6rem 1rem',
            background: sending || (!input.trim() && !attachments.length) ? 'var(--border)' : 'var(--accent)',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}

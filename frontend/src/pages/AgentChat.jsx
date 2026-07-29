import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import ChatMessageRow from '../components/ChatMessageRow';
import ChatComposeInput from '../components/ChatComposeInput';
import BrowserTasksLive from '../components/BrowserTasksLive';
import { buildMessageWithAttachments, uploadChatAttachments } from '../utils/chatAttachments.js';

const secondaryBtn = {
  padding: '0.45rem 0.85rem',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.9rem',
  whiteSpace: 'nowrap',
};

function formatArchivedAt(iso) {
  if (!iso) return '';
  try {
    const d = new Date(String(iso).includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

export default function AgentChat() {
  const { agentId } = useParams();
  const [searchParams] = useSearchParams();
  const profileId = searchParams.get('profile_id') || null;
  const { dataCeoUserId } = useAuth();
  const [agent, setAgent] = useState(null);
  const [turns, setTurns] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoreBusyId, setRestoreBusyId] = useState(null);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);
  const scrollRef = useRef(null);
  const abortControllerRef = useRef(null);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    []
  );

  const refreshHistory = useCallback(async () => {
    if (!agentId) return;
    setHistoryLoading(true);
    try {
      const r = await api.agentChatSessions(agentId);
      setHistory(Array.isArray(r?.sessions) ? r.sessions : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [agentId]);

  const loadActiveChat = useCallback(async () => {
    if (!agentId) return;
    const r = await api.agentChatHistory(agentId);
    setTurns(r.turns || []);
    if (r.rolled_over) {
      setBanner({
        type: 'info',
        text: 'A new day started — previous chat was archived. You are on a fresh conversation.',
      });
      refreshHistory();
    }
  }, [agentId, refreshHistory]);

  useEffect(() => {
    api.agentGet(agentId)
      .then(setAgent)
      .catch((e) => setError(e.message));
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    setBanner(null);
    loadActiveChat().catch(() => setTurns([]));
    refreshHistory();
  }, [agentId, loadActiveChat, refreshHistory]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  const startNewChat = async () => {
    if (clearing || sending) return;
    if (
      turns.length > 0 &&
      !window.confirm('Start a new chat? The current conversation will move to History with an auto-generated title.')
    ) {
      return;
    }
    setClearing(true);
    setError(null);
    try {
      const result = await api.agentSessionsNew(agentId);
      setTurns([]);
      setBanner({
        type: 'info',
        text: result?.message || 'New chat started. Previous session archived.',
      });
      await refreshHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setClearing(false);
    }
  };

  const restoreSession = async (session, mode) => {
    if (!session?.id || restoreBusyId || sending || clearing) return;
    const label = mode === 'summarized' ? 'summarized context' : 'full history';
    if (
      !window.confirm(
        `Restore "${session.title || 'chat'}" with ${label}? Your current chat will be archived first if it has messages.`
      )
    ) {
      return;
    }
    setRestoreBusyId(`${session.id}:${mode}`);
    setError(null);
    try {
      const r = await api.agentChatRestore(agentId, session.id, mode);
      setTurns(r.turns || []);
      setBanner({
        type: 'info',
        text: r.message || `Restored ${label}.`,
      });
      await refreshHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setRestoreBusyId(null);
    }
  };

  const send = async (e) => {
    e?.preventDefault?.();
    if ((!input.trim() && !attachments.length) || sending) return;
    const userText = input.trim();
    const displayMsg =
      userText || `(Attached ${attachments.length} file${attachments.length === 1 ? '' : 's'})`;
    const pendingFiles = [...attachments];
    setInput('');
    setAttachments([]);
    setSending(true);
    setError(null);
    setTurns((prev) => [...prev, { role: 'user', content: displayMsg, created_at: new Date().toISOString() }]);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const uploaded = pendingFiles.length ? await uploadChatAttachments(pendingFiles) : [];
      const outbound = buildMessageWithAttachments(userText, uploaded);
      const r = await api.agentChatSend(agentId, outbound, dataCeoUserId || 'default', profileId, {
        signal: controller.signal,
      });
      if (r.session_reset?.auto_split) {
        setTurns([]);
        setBanner({
          type: 'warn',
          text: r.session_reset.message || 'Chat was reset automatically to protect TPM/context limits.',
        });
        refreshHistory();
      }
      if (r.topic_hint?.hint) {
        setBanner({
          type: 'hint',
          text: r.topic_hint.hint,
          chatUrl: r.topic_hint.chat_url,
          suggestedAgentId: r.topic_hint.suggested_agent_id,
        });
      }
      setTurns((prev) => [
        ...(r.session_reset?.auto_split ? [] : prev),
        ...(r.session_reset?.auto_split
          ? [{ role: 'user', content: displayMsg, created_at: new Date().toISOString() }]
          : []),
        {
          role: 'assistant',
          content: r.reply,
          created_at: new Date().toISOString(),
          tool_calls: r.tool_calls || [],
        },
      ]);
    } catch (err) {
      const cancelled = controller.signal.aborted || err?.name === 'AbortError';
      setError(cancelled ? 'Cancelled' : err.message);
      setTurns((prev) => prev.filter((t) => t.role !== 'user' || t.content !== displayMsg));
      if (!cancelled) {
        setAttachments(pendingFiles);
        setInput(userText);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setSending(false);
      }
    }
  };

  const cancelSend = () => {
    const controller = abortControllerRef.current;
    if (!controller) return;
    controller.abort();
    setSending(false);
    setError('Cancelled');
  };

  if (error && !agent) {
    return (
      <div style={{ padding: '2rem', color: '#f87171' }}>
        Error: {error}. <Link to="/">Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div className="page-chat page-chat-inner page-chat-with-history">
      <div className="chat-main-column">
        <div style={{ flexShrink: 0, marginBottom: '1rem' }}>
          <Link to="/" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            ← Dashboard
          </Link>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '0.75rem',
              marginTop: '0.5rem',
            }}
          >
            <div style={{ minWidth: 0, flex: '1 1 220px' }}>
              <h1 style={{ margin: 0 }}>{agent?.name || agentId} — Chat</h1>
              <p style={{ color: 'var(--muted)', margin: '0.35rem 0 0 0' }}>
                Human–agent chat via OpenClaw. Use the paperclip in the composer to attach images/docs (Master Data RAG).
                {profileId && (
                  <>
                    {' '}
                    Profile context: <code>{profileId}</code>
                  </>
                )}
              </p>
            </div>
            <button type="button" onClick={startNewChat} disabled={clearing || sending} style={secondaryBtn}>
              {clearing ? 'Archiving…' : 'New chat'}
            </button>
          </div>
        </div>

        {banner && (
          <div
            style={{
              flexShrink: 0,
              padding: '0.65rem 1rem',
              background:
                banner.type === 'warn'
                  ? 'rgba(251, 191, 36, 0.12)'
                  : banner.type === 'hint'
                    ? 'rgba(96, 165, 250, 0.12)'
                    : 'rgba(52, 211, 153, 0.12)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              marginBottom: '1rem',
              color: 'var(--text)',
              fontSize: '0.9rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ flex: '1 1 200px' }}>{banner.text}</span>
            <span style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {banner.chatUrl && (
                <Link
                  to={banner.chatUrl}
                  style={{ ...secondaryBtn, textDecoration: 'none', display: 'inline-block' }}
                >
                  Open {banner.suggestedAgentId || 'specialist'}
                </Link>
              )}
              <button type="button" onClick={() => setBanner(null)} style={secondaryBtn}>
                Dismiss
              </button>
            </span>
          </div>
        )}

        {error && (
          <div
            style={{
              flexShrink: 0,
              padding: '0.5rem 1rem',
              background: 'rgba(248,113,113,0.15)',
              borderRadius: 8,
              marginBottom: '1rem',
              color: '#f87171',
            }}
          >
            {error}
          </div>
        )}

        <div
          ref={scrollRef}
          className="chat-scroll-panel"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '1rem',
            marginBottom: '1rem',
          }}
        >
          {turns.length === 0 && !sending && (
            <div style={{ color: 'var(--muted)' }}>No messages yet. Send a message below.</div>
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
              toolCalls={t.tool_calls}
            />
          ))}
          {sending && <div style={{ color: 'var(--muted)' }}>…</div>}
        </div>

        <form onSubmit={send} style={{ flexShrink: 0 }}>
          <div className="chat-compose-row">
            <ChatComposeInput
              placeholder="Message… (Shift+Enter for new line)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onSend={send}
              disabled={sending}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              rows={3}
              style={{
                padding: '0.75rem 1rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
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
                padding: '0.75rem 1.25rem',
                background: sending || (!input.trim() && !attachments.length) ? 'var(--border)' : 'var(--accent)',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
              }}
            >
              Send
            </button>
            {sending && (
              <button type="button" onClick={cancelSend} style={secondaryBtn}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <aside className="chat-history-panel" aria-label="Chat history">
        <BrowserTasksLive variant="sidebar" />
        <div className="chat-history-header">
          <h2>History</h2>
          <span className="chat-history-meta">Last 30 days</span>
        </div>
        <div className="chat-history-scroll">
          {historyLoading && <div className="chat-history-empty">Loading…</div>}
          {!historyLoading && history.length === 0 && (
            <div className="chat-history-empty">No archived chats yet. Use New chat to archive the current conversation.</div>
          )}
          {history.map((s) => (
            <div key={s.id} className="chat-history-item">
              <div className="chat-history-title" title={s.title}>
                {s.title || 'Untitled chat'}
              </div>
              <div className="chat-history-date">{formatArchivedAt(s.archived_at || s.started_at)}</div>
              <div className="chat-history-actions">
                <button
                  type="button"
                  style={secondaryBtn}
                  disabled={!!restoreBusyId || sending || clearing}
                  onClick={() => restoreSession(s, 'as_is')}
                >
                  {restoreBusyId === `${s.id}:as_is` ? '…' : 'Open as-is'}
                </button>
                <button
                  type="button"
                  style={secondaryBtn}
                  disabled={!!restoreBusyId || sending || clearing}
                  onClick={() => restoreSession(s, 'summarized')}
                >
                  {restoreBusyId === `${s.id}:summarized` ? '…' : 'Summarize'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

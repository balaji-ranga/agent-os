import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import ChatMessageRow from '../components/ChatMessageRow';
import ChatComposeInput from '../components/ChatComposeInput';
import BrowserTasksLive from '../components/BrowserTasksLive';
import { buildMessageWithAttachments, uploadChatAttachments, buildDisplayAttachmentsFromFiles, revokeAttachmentPreviews } from '../utils/chatAttachments.js';

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

function sortAgentsForPicker(list = []) {
  return [...list].sort((a, b) => {
    if (a.is_coo && !b.is_coo) return -1;
    if (!a.is_coo && b.is_coo) return 1;
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
}

export default function AgentChat() {
  const { agentId: paramAgentId } = useParams();
  const [searchParams] = useSearchParams();
  const profileId = searchParams.get('profile_id') || null;
  const navigate = useNavigate();
  const location = useLocation();
  const { dataCeoUserId, agents: authAgents } = useAuth();
  const isHome = location.pathname === '/' || location.pathname === '';

  const pickerAgents = useMemo(() => sortAgentsForPicker(authAgents || []), [authAgents]);
  const defaultCooId = useMemo(() => {
    const coo = pickerAgents.find((a) => a.is_coo);
    return coo?.id || pickerAgents[0]?.id || null;
  }, [pickerAgents]);

  const agentId = paramAgentId || defaultCooId;

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
  /** Side panes are closed by default; icon toggles open them. */
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showBrowserPanel, setShowBrowserPanel] = useState(false);
  const scrollRef = useRef(null);
  const abortControllerRef = useRef(null);
  const sidePanelOpen = showHistoryPanel || showBrowserPanel;

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    []
  );

  const selectAgent = (nextId) => {
    if (!nextId || nextId === agentId) return;
    const next = pickerAgents.find((a) => a.id === nextId);
    if (next?.is_coo) {
      navigate('/');
    } else {
      navigate(`/agents/${nextId}/chat`);
    }
  };

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
    if (!agentId) return;
    api
      .agentGet(agentId)
      .then(setAgent)
      .catch((e) => setError(e.message));
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    setBanner(null);
    setError(null);
    loadActiveChat().catch(() => setTurns([]));
  }, [agentId, loadActiveChat]);

  useEffect(() => {
    if (!agentId || !showHistoryPanel) return;
    refreshHistory();
  }, [agentId, showHistoryPanel, refreshHistory]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  const startNewChat = async () => {
    if (clearing || sending || !agentId) return;
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
    } catch (e) {
      setError(e.message);
    } finally {
      setClearing(false);
    }
  };

  const restoreSession = async (session, mode) => {
    if (!agentId || !session?.id || restoreBusyId || sending || clearing) return;
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
    if ((!input.trim() && !attachments.length) || sending || !agentId) return;
    const userText = input.trim();
    const pendingFiles = [...attachments];
    const displayAttachments = buildDisplayAttachmentsFromFiles(pendingFiles);
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setInput('');
    setAttachments([]);
    setSending(true);
    setError(null);
    setTurns((prev) => [
      ...prev,
      {
        id: tempId,
        role: 'user',
        content: userText,
        attachments: displayAttachments,
        created_at: new Date().toISOString(),
      },
    ]);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const uploaded = pendingFiles.length ? await uploadChatAttachments(pendingFiles) : [];
      const outbound = buildMessageWithAttachments(userText, uploaded);
      if (uploaded.length) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === tempId
              ? {
                  ...t,
                  attachments: displayAttachments.map((a, i) => ({
                    ...a,
                    relative_path: uploaded[i]?.relative_path || a.relative_path,
                    document_id: uploaded[i]?.document_id || a.document_id,
                    mime_type: uploaded[i]?.mime_type || a.mime_type,
                  })),
                }
              : t
          )
        );
      }
      const r = await api.agentChatSend(agentId, outbound, dataCeoUserId || 'default', profileId, {
        signal: controller.signal,
      });
      if (r.session_reset?.auto_split) {
        revokeAttachmentPreviews(displayAttachments);
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
        ...(r.session_reset?.auto_split
          ? [
              {
                id: tempId,
                role: 'user',
                content: userText,
                attachments: displayAttachments.map((a, i) => ({
                  ...a,
                  relative_path: uploaded[i]?.relative_path || a.relative_path,
                  document_id: uploaded[i]?.document_id || a.document_id,
                })),
                created_at: new Date().toISOString(),
              },
            ]
          : prev),
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
      setTurns((prev) => prev.filter((t) => t.id !== tempId));
      revokeAttachmentPreviews(displayAttachments);
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

  if (!agentId && pickerAgents.length === 0) {
    return (
      <div style={{ padding: '2rem', color: 'var(--muted)' }}>
        No agents available yet. <Link to="/org">Open My Org</Link> to set up your team.
      </div>
    );
  }

  if (error && !agent && paramAgentId) {
    return (
      <div style={{ padding: '2rem', color: '#f87171' }}>
        Error: {error}. <Link to="/">Back to chat</Link>
      </div>
    );
  }

  const agentLabel = agent?.name || agentId || 'Agent';
  const emptyHome = turns.length === 0 && !sending;

  return (
    <div
      className={`page-chat page-chat-inner${sidePanelOpen ? ' page-chat-with-history' : ''}${isHome ? ' page-chat-home' : ''}`}
    >
      <div className="chat-main-column">
        <div style={{ flexShrink: 0, marginBottom: '1rem' }}>
          {!isHome && (
            <Link to="/org" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
              ← My Org
            </Link>
          )}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '0.75rem',
              marginTop: isHome ? 0 : '0.5rem',
            }}
          >
            <div style={{ minWidth: 0, flex: '1 1 220px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Chat with</span>
                  <select
                    value={agentId || ''}
                    onChange={(e) => selectAgent(e.target.value)}
                    aria-label="Select agent to chat with"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      font: 'inherit',
                      fontSize: '1.05rem',
                      fontWeight: 600,
                      maxWidth: '100%',
                      minWidth: 160,
                    }}
                  >
                    {pickerAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name || a.id}
                        {a.is_coo ? ' (COO)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p style={{ color: 'var(--muted)', margin: '0.45rem 0 0 0', fontSize: '0.9rem' }}>
                {isHome
                  ? "What's on your mind? Start your day here — history is saved the same way as always."
                  : 'Human–agent chat. Use the paperclip to attach images/docs (Master Data RAG).'}
                {profileId && (
                  <>
                    {' '}
                    Profile context: <code>{profileId}</code>
                  </>
                )}
              </p>
            </div>
            <div className="chat-header-actions">
              <button
                type="button"
                className={`chat-pane-icon-btn${showBrowserPanel ? ' is-active' : ''}`}
                aria-pressed={showBrowserPanel}
                aria-label={showBrowserPanel ? 'Hide browser session panel' : 'Show browser session panel'}
                title="Browser session"
                onClick={() => setShowBrowserPanel((v) => !v)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                  <rect x="3" y="4" width="18" height="14" rx="2" />
                  <path d="M3 9h18M8 18h8" />
                </svg>
              </button>
              <button
                type="button"
                className={`chat-pane-icon-btn${showHistoryPanel ? ' is-active' : ''}`}
                aria-pressed={showHistoryPanel}
                aria-label={showHistoryPanel ? 'Hide chat history panel' : 'Show chat history panel'}
                title="Chat history"
                onClick={() => setShowHistoryPanel((v) => !v)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </button>
              <button type="button" onClick={startNewChat} disabled={clearing || sending || !agentId} style={secondaryBtn}>
                {clearing ? 'Archiving…' : 'New chat'}
              </button>
            </div>
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
          {emptyHome && (
            <div className="chat-home-empty">
              <div className="chat-home-empty-title">Good to see you</div>
              <div className="chat-home-empty-sub">
                Chat with {agentLabel} — priorities, questions, or whatever is on your mind.
              </div>
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
              toolCalls={t.tool_calls}
              attachments={t.attachments}
            />
          ))}
          {sending && <div style={{ color: 'var(--muted)' }}>…</div>}
        </div>

        <form onSubmit={send} style={{ flexShrink: 0 }}>
          <div className="chat-compose-row">
            <ChatComposeInput
              placeholder={isHome ? `Message ${agentLabel}…` : 'Message… (Shift+Enter for new line)'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onSend={send}
              disabled={sending || !agentId}
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
              disabled={sending || !agentId || (!input.trim() && !attachments.length)}
              style={{
                padding: '0.75rem 1.25rem',
                background:
                  sending || !agentId || (!input.trim() && !attachments.length) ? 'var(--border)' : 'var(--accent)',
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

      {sidePanelOpen && (
        <aside
          className="chat-history-panel"
          aria-label={
            showHistoryPanel && showBrowserPanel
              ? 'Browser session and chat history'
              : showBrowserPanel
                ? 'Browser session'
                : 'Chat history'
          }
        >
          <div className="chat-side-panel-toolbar">
            {showBrowserPanel && (
              <button
                type="button"
                className="chat-side-panel-close"
                onClick={() => setShowBrowserPanel(false)}
                aria-label="Close browser session panel"
              >
                Browser ×
              </button>
            )}
            {showHistoryPanel && (
              <button
                type="button"
                className="chat-side-panel-close"
                onClick={() => setShowHistoryPanel(false)}
                aria-label="Close chat history panel"
              >
                History ×
              </button>
            )}
          </div>
          {showBrowserPanel && <BrowserTasksLive variant="sidebar" forceShow />}
          {showHistoryPanel && (
            <>
              <div className="chat-history-header">
                <h2>History</h2>
                <span className="chat-history-meta">Last 30 days</span>
              </div>
              <div className="chat-history-scroll">
                {historyLoading && <div className="chat-history-empty">Loading…</div>}
                {!historyLoading && history.length === 0 && (
                  <div className="chat-history-empty">
                    No archived chats yet. Use New chat to archive the current conversation.
                  </div>
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
            </>
          )}
        </aside>
      )}
    </div>
  );
}

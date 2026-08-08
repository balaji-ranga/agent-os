import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import ChatMessageRow from '../components/ChatMessageRow';
import ChatComposeInput from '../components/ChatComposeInput';
import BrowserTasksLive from '../components/BrowserTasksLive';
import RobotAvatar from '../components/RobotAvatar.jsx';
import { buildMessageWithAttachments, uploadChatAttachments, buildDisplayAttachmentsFromFiles, revokeAttachmentPreviews } from '../utils/chatAttachments.js';
import { parseApiDate } from '../utils/formatDateTime.js';

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

function relativeTime(iso) {
  const d = parseApiDate(iso);
  if (!d) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return d.toLocaleDateString();
}

function sortAgentsForPicker(list = []) {
  return [...list].sort((a, b) => {
    if (a.is_coo && !b.is_coo) return -1;
    if (!a.is_coo && b.is_coo) return 1;
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
}

function HomeKpiCards({ kpis }) {
  if (!kpis) return null;
  const successDetail = kpis.success_rate_detail;
  const successTitle =
    successDetail?.formula ||
    'Completed / (completed + failed) over last 7 platform-TZ days';
  const cards = [
    { key: 'agents', label: 'Active Agents', value: kpis.active_agents ?? '—', tone: 'purple', icon: '🤖' },
    { key: 'progress', label: 'Tasks in Progress', value: kpis.tasks_in_progress ?? '—', tone: 'blue', icon: '📊' },
    { key: 'approve', label: 'Awaiting Approval', value: kpis.awaiting_approval ?? '—', tone: 'orange', icon: '⏱' },
    {
      key: 'success',
      label: kpis.success_rate_label || 'Success Rate (7d)',
      value: kpis.success_rate_7d != null ? `${kpis.success_rate_7d}%` : '—',
      tone: 'green',
      icon: '✓',
      title: successTitle,
    },
  ];
  return (
    <div className="home-kpi-row" aria-label="Company snapshot">
      {cards.map((c) => (
        <div key={c.key} className={`home-kpi-card home-kpi-${c.tone}`} title={c.title || undefined}>
          <div className="home-kpi-icon" aria-hidden>
            {c.icon}
          </div>
          <div className="home-kpi-body">
            <div className="home-kpi-label">{c.label}</div>
            <div className="home-kpi-value">{c.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function HomeRightPane({ snapshot, agentActivity, recentWorkflows }) {
  const snap = snapshot || {};
  return (
    <aside className="home-right-pane" aria-label="Today overview">
      <section className="home-side-card">
        <h3 className="home-side-title">Today&apos;s Snapshot</h3>
        {(snap.timezone || snap.day_start_utc) && (
          <p className="home-snap-meta muted" style={{ fontSize: '0.75rem', margin: '0 0 0.5rem', opacity: 0.75 }}>
            {snap.timezone ? `${snap.timezone}` : ''} day
          </p>
        )}
        <ul className="home-snap-list">
          <li>
            <span className="home-snap-dot home-dot-blue" />
            Workflows running
            <strong>{snap.workflows_running ?? 0}</strong>
          </li>
          <li>
            <span className="home-snap-dot home-dot-green" />
            Tasks completed
            <strong>{snap.tasks_completed_today ?? 0}</strong>
          </li>
          <li>
            <span className="home-snap-dot home-dot-orange" />
            Approvals pending
            <strong>{snap.approvals_pending ?? 0}</strong>
          </li>
          <li>
            <span className="home-snap-dot home-dot-red" />
            Errors / Failed
            <strong>{snap.errors_failed_today ?? 0}</strong>
          </li>
        </ul>
      </section>
      <section className="home-side-card">
        <div className="home-side-title-row">
          <h3 className="home-side-title">Team activity</h3>
          <span className="home-live-badge">Live</span>
        </div>
        <ul className="home-agent-list">
          {(agentActivity || []).slice(0, 6).map((a) => (
            <li key={a.id}>
              <RobotAvatar src={a.avatar_image} name={a.name} size={32} status={a.status === 'active' ? 'online' : 'idle'} />
              <div className="home-agent-meta">
                <div className="home-agent-name">{a.name}</div>
                <div className="home-agent-act">{a.activity}</div>
              </div>
            </li>
          ))}
          {!(agentActivity || []).length && <li className="home-side-empty">No AI employees yet</li>}
        </ul>
      </section>
      <section className="home-side-card">
        <h3 className="home-side-title">Recent Workflows</h3>
        <ul className="home-wf-list">
          {(recentWorkflows || []).map((w) => (
            <li key={w.id}>
              <div className="home-wf-name">{w.name}</div>
              <div className="home-wf-meta">
                <span>{relativeTime(w.completed_at || w.started_at)}</span>
                <span className={`home-wf-status status-${String(w.status || '').toLowerCase()}`}>{w.status || '—'}</span>
              </div>
            </li>
          ))}
          {!(recentWorkflows || []).length && <li className="home-side-empty">No recent runs</li>}
        </ul>
      </section>
    </aside>
  );
}

export default function AgentChat() {
  const { agentId: paramAgentId } = useParams();
  const [searchParams] = useSearchParams();
  const profileId = searchParams.get('profile_id') || null;
  const navigate = useNavigate();
  const location = useLocation();
  const { user, dataCeoUserId, agents: authAgents } = useAuth();
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
  const [homeSnap, setHomeSnap] = useState(null);
  const [operateBanner, setOperateBanner] = useState(null);
  const scrollRef = useRef(null);
  const abortControllerRef = useRef(null);
  const sidePanelOpen = showHistoryPanel || showBrowserPanel;

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!isHome) return undefined;
    let cancelled = false;
    const load = () => {
      api
        .homeSnapshot()
        .then((r) => {
          if (!cancelled) setHomeSnap(r);
        })
        .catch(() => {
          if (!cancelled) setHomeSnap(null);
        });
      if (user?.role === 'ceo') {
        api
          .companyOperateGate()
          .then((g) => {
            if (!cancelled) setOperateBanner(g?.show_home_banner ? g : null);
          })
          .catch(() => {
            if (!cancelled) setOperateBanner(null);
          });
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isHome]);

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
      const r = await api.agentChatSessions(agentId, { limit: 100 });
      setHistory(Array.isArray(r?.sessions) ? r.sessions : Array.isArray(r) ? r : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [agentId]);

  const loadActiveChat = useCallback(async () => {
    if (!agentId) return;
    const r = await api.agentChatHistory(agentId, { limit: 500 });
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

  const send = async (e, overrideText) => {
    e?.preventDefault?.();
    const userText = String(overrideText != null ? overrideText : input).trim();
    if ((!userText && !attachments.length) || sending || !agentId) return;
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

  // Workspace / deep-link: ?message=...&autosend=1 or location.state.prefill
  const inboundPrefillKey = useRef('');
  useEffect(() => {
    if (!agentId) return;
    const fromQuery = searchParams.get('message') || searchParams.get('q');
    const fromState = location.state?.prefill || location.state?.message;
    const text = String(fromQuery || fromState || '').trim();
    if (!text) return;
    const auto = searchParams.get('autosend') === '1' || location.state?.autosend === true;
    const key = `${agentId}:${text}:${auto ? 1 : 0}`;
    if (inboundPrefillKey.current === key) return;
    inboundPrefillKey.current = key;
    if (location.state?.prefill || location.state?.message || location.state?.autosend) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: {} });
    }
    // Drop query so refresh does not resend
    if (fromQuery) {
      const next = new URLSearchParams(searchParams);
      next.delete('message');
      next.delete('q');
      next.delete('autosend');
      const qs = next.toString();
      navigate(`${location.pathname}${qs ? `?${qs}` : ''}`, { replace: true, state: {} });
    }
    if (auto) {
      send(null, text);
    } else {
      setInput(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot inbound hop
  }, [agentId, searchParams, location.state]);

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
        No AI employees available yet. <Link to="/org">Open My Org</Link> or <Link to="/workspace">hire AI employees</Link>.
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
  const firstName =
    String(user?.name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)[0] || 'there';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div
      className={`page-chat page-chat-inner${sidePanelOpen ? ' page-chat-with-history' : ''}${isHome ? ' page-chat-home' : ''}`}
    >
      {isHome && (
        <div className="home-dashboard-layout">
          <div className="chat-main-column">
            <div className="home-mobile-greet">
              <div className="home-mobile-greet-title">
                {greet}, {firstName}! <span aria-hidden>👋</span>
              </div>
              <div className="home-mobile-greet-sub">Here&apos;s what&apos;s happening with your AI company today.</div>
            </div>
            <HomeKpiCards kpis={homeSnap?.kpis} />
            {operateBanner?.show_home_banner && (
              <div
                role="status"
                style={{
                  marginBottom: '0.85rem',
                  padding: '0.75rem 1rem',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.65rem',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                  <strong style={{ display: 'block', marginBottom: 2 }}>
                    {operateBanner.banner_reason === 'day1_not_applied'
                      ? 'Day 1 install pending'
                      : 'Operating model incomplete'}
                  </strong>
                  <span style={{ fontSize: '0.9rem', opacity: 0.85 }}>
                    {operateBanner.banner_reason === 'day1_not_applied'
                      ? 'Your operating model is confirmed — install MD and workflows so the company can run.'
                      : 'Define how the company runs (cadence, autonomy, channels), then install Day 1 runbooks.'}
                  </span>
                </div>
                <Link
                  to="/company-operate"
                  style={{
                    padding: '0.45rem 0.85rem',
                    background: 'var(--accent)',
                    color: '#fff',
                    borderRadius: 8,
                    textDecoration: 'none',
                    fontSize: '0.9rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {operateBanner.banner_reason === 'day1_not_applied' ? 'Install Day 1' : 'How we run'}
                </Link>
              </div>
            )}
            <div style={{ flexShrink: 0, marginBottom: '0.75rem' }}>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '0.65rem',
                }}
              >
                <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.55rem' }}>
                    <RobotAvatar src={agent?.avatar_image} name={agentLabel} size={36} status="online" />
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Chat with</span>
                      <select
                        value={agentId || ''}
                        onChange={(e) => selectAgent(e.target.value)}
                        aria-label="Select agent to chat with"
                        className="chat-agent-select"
                      >
                        {pickerAgents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name || a.id}
                            {a.is_coo ? ' (COO)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="chat-online-pill">Online</span>
                  </div>
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
                  <button type="button" onClick={startNewChat} disabled={clearing || sending || !agentId} className="chat-new-btn" style={secondaryBtn}>
                    {clearing ? 'Archiving…' : '+ New chat'}
                  </button>
                </div>
              </div>
            </div>

            {banner && (
              <div
                style={{
                  flexShrink: 0,
                  padding: '0.55rem 0.85rem',
                  background:
                    banner.type === 'warn'
                      ? 'rgba(251, 191, 36, 0.12)'
                      : banner.type === 'hint'
                        ? 'rgba(96, 165, 250, 0.12)'
                        : 'rgba(52, 211, 153, 0.12)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  marginBottom: '0.75rem',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
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
                    <Link to={banner.chatUrl} style={{ ...secondaryBtn, textDecoration: 'none', display: 'inline-block' }}>
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
                  marginBottom: '0.75rem',
                  color: '#f87171',
                  fontSize: '0.85rem',
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
                borderRadius: 10,
                padding: '0.85rem',
                marginBottom: '0.75rem',
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
              {sending && <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>…</div>}
            </div>

            <form onSubmit={send} style={{ flexShrink: 0 }}>
              <div className="chat-compose-row">
                <ChatComposeInput
                  placeholder={`Message ${agentLabel}…`}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onSend={send}
                  disabled={sending || !agentId}
                  attachments={attachments}
                  onAttachmentsChange={setAttachments}
                  rows={2}
                  style={{
                    padding: '0.65rem 0.85rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text)',
                    resize: 'vertical',
                    minHeight: 48,
                    font: 'inherit',
                    fontSize: '0.92rem',
                  }}
                />
                <button
                  type="submit"
                  disabled={sending || !agentId || (!input.trim() && !attachments.length)}
                  style={{
                    padding: '0.65rem 1.1rem',
                    background:
                      sending || !agentId || (!input.trim() && !attachments.length) ? 'var(--border)' : 'var(--accent)',
                    border: 'none',
                    borderRadius: 8,
                    color: '#fff',
                    fontSize: '0.9rem',
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
          {!sidePanelOpen && (
            <HomeRightPane
              snapshot={homeSnap?.snapshot}
              agentActivity={homeSnap?.agent_activity}
              recentWorkflows={homeSnap?.recent_workflows}
            />
          )}
          {sidePanelOpen && (
            <aside className="chat-history-panel" aria-label="Chat side panel">
              <div className="chat-side-panel-toolbar">
                {showBrowserPanel && (
                  <button type="button" className="chat-side-panel-close" onClick={() => setShowBrowserPanel(false)}>
                    Browser ×
                  </button>
                )}
                {showHistoryPanel && (
                  <button type="button" className="chat-side-panel-close" onClick={() => setShowHistoryPanel(false)}>
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
                      <div className="chat-history-empty">No archived chats yet.</div>
                    )}
                    {history.map((s) => (
                      <div key={s.id} className="chat-history-item">
                        <div className="chat-history-title" title={s.title}>
                          {s.title || 'Untitled chat'}
                        </div>
                        <div className="chat-history-date">{formatArchivedAt(s.archived_at || s.started_at)}</div>
                        <div className="chat-history-actions">
                          <button type="button" style={secondaryBtn} disabled={!!restoreBusyId || sending || clearing} onClick={() => restoreSession(s, 'as_is')}>
                            {restoreBusyId === `${s.id}:as_is` ? '…' : 'Open as-is'}
                          </button>
                          <button type="button" style={secondaryBtn} disabled={!!restoreBusyId || sending || clearing} onClick={() => restoreSession(s, 'summarized')}>
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
      )}
      {!isHome && (
        <>
      <div className="chat-main-column">
        <div style={{ flexShrink: 0, marginBottom: '1rem' }}>
          <Link to="/org" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            ← My Org
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
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem' }}>
                <RobotAvatar src={agent?.avatar_image} name={agentLabel} size={36} />
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Chat with</span>
                  <select
                    value={agentId || ''}
                    onChange={(e) => selectAgent(e.target.value)}
                    aria-label="Select agent to chat with"
                    className="chat-agent-select"
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
                Human–agent chat. Use the paperclip to attach images/docs (Master Data RAG).
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
        </>
      )}
    </div>
  );
}

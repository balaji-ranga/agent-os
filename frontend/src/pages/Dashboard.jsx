import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import ChatMessageContent from '../components/ChatMessageContent';
import ChatComposeInput from '../components/ChatComposeInput';
import MessageFeedback from '../components/MessageFeedback';
import OrgChart from '../components/OrgChart';
import OrgDesigner from '../components/OrgDesigner';
import DepartmentPicker from '../components/DepartmentPicker';
import { formatLocalDateTime, formatChatTimestamp, toLocalDateTimeInputValue } from '../utils/formatDateTime.js';
import { buildMessageWithAttachments, uploadChatAttachments } from '../utils/chatAttachments.js';

// Voice: browser Speech Synthesis API (Edge/Chrome TTS)
function useEdgeTTS() {
  const [speaking, setSpeaking] = useState(false);
  const [voicesReady, setVoicesReady] = useState(false);

  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const loadVoices = () => {
      if (speechSynthesis.getVoices().length > 0) setVoicesReady(true);
    };
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
    return () => speechSynthesis.cancel();
  }, []);

  const speak = (text) => {
    if (!text?.trim()) return;
    const voices = speechSynthesis.getVoices();
    const professional = voices.find((v) => /Desktop|Online|Natural|Professional|Neural/i.test(v.name))
      || voices.find((v) => v.name.includes('Microsoft') || v.name.includes('Edge') || v.name.includes('Zira') || v.name.includes('David'));
    // Chunk long text so TTS doesn't drop or fail (many browsers limit utterance length)
    const chunks = text.match(/[^.!?]+[.!?]*/g) || [text.slice(0, 200)];
    let i = 0;
    const speakNext = () => {
      while (i < chunks.length && !chunks[i].trim()) i++;
      if (i >= chunks.length) {
        setSpeaking(false);
        return;
      }
      const u = new SpeechSynthesisUtterance(chunks[i].trim());
      if (professional) u.voice = professional;
      u.rate = 0.9;
      u.pitch = 1;
      if (i === 0) u.onstart = () => setSpeaking(true);
      u.onend = () => { i++; speakNext(); };
      u.onerror = () => { i++; speakNext(); };
      speechSynthesis.speak(u);
    };
    speechSynthesis.cancel();
    speakNext();
  };

  const stop = () => {
    speechSynthesis.cancel();
    setSpeaking(false);
  };

  return { speak, stop, speaking, voicesReady };
}

export default function Dashboard() {
  const { speak, stop, speaking } = useEdgeTTS();
  const [agents, setAgents] = useState([]);
  const [standups, setStandups] = useState([]);
  const [selectedStandup, setSelectedStandup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newDepartment, setNewDepartment] = useState('Operations');
  const [newParentId, setNewParentId] = useState('');
  const [newTokenBudget, setNewTokenBudget] = useState('');
  const [newErrorBudget, setNewErrorBudget] = useState('');
  const [addAgentMessage, setAddAgentMessage] = useState(null);
  const [creatingStandup, setCreatingStandup] = useState(false);
  const [standupScheduledAt, setStandupScheduledAt] = useState(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return toLocalDateTimeInputValue(d);
  });
  const [runningCoo, setRunningCoo] = useState(false);
  const [runningCronStandup, setRunningCronStandup] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [getWorkLoading, setGetWorkLoading] = useState(false);
  const [checkUpdatesLoading, setCheckUpdatesLoading] = useState(false);
  const [statusCheckerLoading, setStatusCheckerLoading] = useState(false);
  const [statusReport, setStatusReport] = useState(null); // { html, counts, email, standup_id }
  const [retentionPurgeLoading, setRetentionPurgeLoading] = useState(false);
  const [retentionDays, setRetentionDays] = useState(90);
  const [standupChatInput, setStandupChatInput] = useState('');
  const [standupAttachments, setStandupAttachments] = useState([]);
  const [deletingStandupId, setDeletingStandupId] = useState(null);
  const [deletingAllStandups, setDeletingAllStandups] = useState(false);
  const [openclawData, setOpenclawData] = useState(null);
  const [openclawLoading, setOpenclawLoading] = useState(false);
  const [openclawSyncing, setOpenclawSyncing] = useState(false);
  const [orgDocSyncing, setOrgDocSyncing] = useState(false);
  const [orgDocSyncMessage, setOrgDocSyncMessage] = useState(null);
  const [orgMode, setOrgMode] = useState('chart'); // chart | design
  const [showCreateStandupModal, setShowCreateStandupModal] = useState(false);
  const [standupTitle, setStandupTitle] = useState('');
  const [standupOutcomes, setStandupOutcomes] = useState('');
  const refreshStandup = () => {
    if (!selectedStandup?.id) return;
    api.standupGet(selectedStandup.id)
      .then((s) => {
        setSelectedStandup(s);
        setStandups((prev) => prev.map((x) => (x.id === s.id ? s : x)));
      })
      .catch(() => {});
  };

  const fetchData = () => {
    setLoading(true);
    setError(null);
    Promise.all([api.agentsList(), api.standupsList(20), api.efficiencyRetentionGet().catch(() => null)])
      .then(([a, s, retention]) => {
        setAgents(a);
        setStandups(s);
        if (retention?.data_retention_days) setRetentionDays(retention.data_retention_days);
        // Do not auto-open another CEO's standup; user picks or creates one.
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const outcomeSentForStandup = useRef(new Set());
  useEffect(() => {
    if (!selectedStandup?.id || selectedStandup.responses !== undefined) return;
    api.standupGet(selectedStandup.id).then((s) => {
      setSelectedStandup(s);
      if (s.outcomes?.trim() && (!s.messages || s.messages.length === 0) && !outcomeSentForStandup.current.has(s.id)) {
        outcomeSentForStandup.current.add(s.id);
        api.standupSendMessage(s.id, { content: s.outcomes.trim() }).then(() => api.standupGet(s.id)).then(setSelectedStandup).catch(() => {});
      }
    }).catch(() => {});
  }, [selectedStandup?.id]);

  // Auto-refresh standup chat so delegated agent responses appear without clicking "Check for updates"
  const STANDUP_POLL_INTERVAL_MS = 6000;
  useEffect(() => {
    if (!selectedStandup?.id) return;
    const tick = () => {
      api.standupGet(selectedStandup.id)
        .then((s) => {
          let hasNewMessages = false;
          setSelectedStandup((prev) => {
            if (!prev || prev.id !== s.id) return prev;
            const prevMsgCount = Array.isArray(prev.messages) ? prev.messages.length : 0;
            const nextMsgCount = Array.isArray(s.messages) ? s.messages.length : 0;
            if (nextMsgCount > prevMsgCount || JSON.stringify(prev.messages) !== JSON.stringify(s.messages)) {
              hasNewMessages = nextMsgCount > prevMsgCount;
              return s;
            }
            return prev;
          });
          setStandups((prev) => prev.map((x) => (x.id === s.id ? s : x)));
        })
        .catch(() => {});
    };
    const id = setInterval(tick, STANDUP_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [selectedStandup?.id]);

  const addAgent = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAddAgentMessage(null);
    const coo = agents.find((a) => a.is_coo);
    const department = newDepartment.trim();
    const body = {
      name: newName.trim(),
      role: newRole.trim() || 'Agent',
      department: department || '',
      monthly_token_budget: newTokenBudget || null,
      error_budget_pct: newErrorBudget || null,
    };
    // Default report-to COO so new agents appear under the org chart
    body.parent_id = newParentId || coo?.id || undefined;
    api.agentCreate(body)
      .then((agent) => {
        return api.agentsList().then((list) => {
          setAgents(Array.isArray(list) ? list : list?.agents || []);
          setNewName('');
          setNewRole('');
          setNewParentId('');
          setNewDepartment('Operations');
          setNewTokenBudget('');
          setNewErrorBudget('');
          setAddAgentMessage(
            `"${agent.name}" added to your workspace` +
              (agent.department ? ` · ${agent.department}` : '') +
              (agent.openclaw_runtime_id ? ` (${agent.openclaw_runtime_id}).` : '.') +
              ' Tool access can be managed in the agent workspace. Restart OpenClaw gateway if chat does not pick up the new agent immediately.'
          );
          setTimeout(() => setAddAgentMessage(null), 14000);
        });
      })
      .catch((e) => setError(e.message));
  };

  const removeAgent = (agentId) => {
    if (!window.confirm('Remove this agent? This cannot be undone.')) return;
    api.agentDelete(agentId)
      .then(() => fetchData())
      .catch((e) => setError(e.message));
  };

  const createStandup = (e) => {
    e?.preventDefault?.();
    setCreatingStandup(true);
    const scheduledAt = standupScheduledAt ? new Date(standupScheduledAt).toISOString() : new Date().toISOString();
    const outcomesTrim = standupOutcomes.trim();
    api.standupCreate({ scheduled_at: scheduledAt, status: 'scheduled', title: standupTitle.trim() || undefined, outcomes: outcomesTrim || undefined })
      .then((s) => {
        setStandups((prev) => [s, ...prev]);
        setSelectedStandup(s);
        setShowCreateStandupModal(false);
        setStandupTitle('');
        setStandupOutcomes('');
        if (outcomesTrim) {
          return api.standupSendMessage(s.id, { content: outcomesTrim }).then(() => api.standupGet(s.id)).then((updated) => {
            setSelectedStandup(updated);
            setStandups((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
          });
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setCreatingStandup(false));
  };

  const deleteStandup = (id, e) => {
    e?.stopPropagation?.();
    if (!window.confirm('Delete this standup and its chat history? This cannot be undone.')) return;
    setDeletingStandupId(id);
    api.standupDelete(id)
      .then(() => {
        setStandups((prev) => {
          const next = prev.filter((s) => s.id !== id);
          if (selectedStandup?.id === id) setSelectedStandup(next[0] || null);
          return next;
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setDeletingStandupId(null));
  };

  const deleteAllStandups = () => {
    if (!window.confirm('Delete all standups and their chat history? This cannot be undone.')) return;
    setDeletingAllStandups(true);
    api.standupDeleteAll()
      .then(() => {
        setStandups([]);
        setSelectedStandup(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setDeletingAllStandups(false));
  };

  const runCoo = () => {
    if (!selectedStandup) return;
    setRunningCoo(true);
    api.standupRunCoo(selectedStandup.id, false)
      .then((updated) => {
        setStandups((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setSelectedStandup(updated);
      })
      .catch((e) => setError(e.message))
      .finally(() => setRunningCoo(false));
  };

  const runCronStandup = () => {
    setRunningCronStandup(true);
    setError(null);
    api.cronRunStandup()
      .then(({ standup }) => {
        if (standup) {
          setStandups((prev) => [standup, ...prev]);
          setSelectedStandup(standup);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setRunningCronStandup(false));
  };

  const handleStandupMessage = async (e) => {
    e.preventDefault();
    if (!selectedStandup?.id || (!standupChatInput.trim() && !standupAttachments.length)) return;
    const text = standupChatInput.trim();
    const files = [...standupAttachments];
    setSendingMessage(true);
    setError(null);
    try {
      const uploaded = files.length ? await uploadChatAttachments(files) : [];
      const content = buildMessageWithAttachments(text, uploaded);
      await api.standupSendMessage(selectedStandup.id, { content });
      setStandupChatInput('');
      setStandupAttachments([]);
      refreshStandup();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleGetWorkFromTeam = () => {
    if (!selectedStandup?.id) return;
    setGetWorkLoading(true);
    setError(null);
    api.standupSendMessage(selectedStandup.id, { action: 'get_work_from_team' })
      .then(() => refreshStandup())
      .catch((e) => setError(e.message))
      .finally(() => setGetWorkLoading(false));
  };

  const handleCheckForUpdates = () => {
    setCheckUpdatesLoading(true);
    setError(null);
    api.cronProcessDelegations()
      .then(() => refreshStandup())
      .catch((e) => setError(e.message))
      .finally(() => setCheckUpdatesLoading(false));
  };

  const handleStatusChecker = () => {
    setStatusCheckerLoading(true);
    setError(null);
    api
      .cronRunStatusChecker({ post_standup: true })
      .then((out) => {
        if (!out?.html) {
          setError('Status report was empty. Try again or check Kanban directly.');
          return;
        }
        setStatusReport({
          html: out.html,
          counts: out.counts || {},
          email: out.email || { skipped: true, reason: 'batch_only' },
          standup_id: out.standup_id || null,
        });
        refreshStandup();
        api.standupsList(20).then(setStandups).catch(() => {});
      })
      .catch((e) => setError(e.message))
      .finally(() => setStatusCheckerLoading(false));
  };

  const handleRetentionPurge = () => {
    if (
      !window.confirm(
        `Permanently delete chats, standup history, and workflow runs older than ${retentionDays} days? This cannot be undone.`
      )
    ) {
      return;
    }
    setRetentionPurgeLoading(true);
    setError(null);
    api
      .cronRunDataRetention({})
      .then((out) => {
        const d = out.deleted || {};
        setOrgDocSyncMessage(
          `Retention purge (${out.retention_days}d): chats ${d.chat_turns || 0}, standup ${d.standup_messages || 0}, runs ${d.workflow_runs || 0}`
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setRetentionPurgeLoading(false));
  };

  const fetchOpenClawAgents = () => {
    setOpenclawLoading(true);
    api.openclawAgents()
      .then(setOpenclawData)
      .catch((e) => setError(e.message))
      .finally(() => setOpenclawLoading(false));
  };

  const syncFromOpenClaw = (agentId) => {
    setOpenclawSyncing(true);
    api.openclawSync(agentId)
      .then(() => {
        fetchData();
        fetchOpenClawAgents();
      })
      .catch((e) => setError(e.message))
      .finally(() => setOpenclawSyncing(false));
  };

  const syncOrgAgentDocs = () => {
    setOrgDocSyncing(true);
    setOrgDocSyncMessage(null);
    api
      .orgSyncAgentDocs()
      .then((out) => {
        setOrgDocSyncMessage(
          out.message ||
            `Synced ${out.workspaces_synced ?? 0} workspace(s) — ${out.agent_count ?? 0} agents, ${out.delegatee_count ?? 0} COO delegatees.`
        );
        setTimeout(() => setOrgDocSyncMessage(null), 8000);
      })
      .catch((e) => setOrgDocSyncMessage(e.message || 'Org sync failed'))
      .finally(() => setOrgDocSyncing(false));
  };

  if (loading) return <div className="mcp-pg">Loading…</div>;

  return (
    <div className="mcp-pg" style={{ paddingTop: '2rem' }}>
      {error && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.65rem 0.85rem',
            borderRadius: 8,
            border: '1px solid #fecaca',
            background: '#fef2f2',
            color: '#991b1b',
            fontSize: '0.9rem',
            display: 'flex',
            justifyContent: 'space-between',
            gap: '0.75rem',
            alignItems: 'flex-start',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#991b1b',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {statusReport && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="COO Status Report"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={() => setStatusReport(null)}
        >
          <div
            style={{
              width: 'min(920px, 100%)',
              maxHeight: 'min(90vh, 900px)',
              background: 'var(--surface)',
              borderRadius: 14,
              border: '1px solid var(--border)',
              boxShadow: '0 20px 50px rgba(0,0,0,0.28)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                padding: '0.85rem 1rem',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div>
                <strong style={{ fontSize: '1.05rem' }}>COO Status Report</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 2 }}>
                  {(statusReport.counts?.needs_attention ??
                    (statusReport.counts?.awaiting_ceo || 0) +
                      (statusReport.counts?.failed ?? statusReport.counts?.failed_1d ?? 0))}{' '}
                  need attention
                  {' · '}
                  {statusReport.counts?.failed ?? statusReport.counts?.failed_1d ?? 0} failed
                  {' · '}
                  {statusReport.counts?.awaiting_ceo || 0} awaiting you
                  {statusReport.email?.sent
                    ? ' · Email sent to your inbox'
                    : statusReport.email?.skipped
                      ? ' · Email via daily batch only'
                    : statusReport.email?.error
                      ? ` · Email not sent (${statusReport.email.error})`
                      : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link
                  to="/kanban"
                  style={{
                    padding: '0.4rem 0.75rem',
                    background: 'var(--accent)',
                    color: '#fff',
                    borderRadius: 6,
                    textDecoration: 'none',
                    fontSize: '0.85rem',
                  }}
                >
                  Open Kanban
                </Link>
                <button
                  type="button"
                  onClick={() => setStatusReport(null)}
                  style={{
                    padding: '0.4rem 0.75rem',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <iframe
              title="COO Status Report"
              srcDoc={statusReport.html}
              sandbox=""
              style={{
                flex: 1,
                width: '100%',
                minHeight: 480,
                border: 'none',
                background: '#f1f5f9',
              }}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Dashboard</h1>
      </div>

      {/* Org chart: recursive hierarchy with List | Graph */}
      <section style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Org chart</h2>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
            <button
              type="button"
              onClick={syncOrgAgentDocs}
              disabled={orgDocSyncing}
              title="Refresh ORG.md and the roster sections in COO AGENTS.md (agents, external/A2A leaves, session keys). Manual Role / Priorities / Tools / Guardrails / custom sections are kept."
              style={{
                padding: '0.45rem 0.85rem',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: orgDocSyncing ? 'wait' : 'pointer',
                fontSize: '0.85rem',
              }}
            >
              {orgDocSyncing ? 'Syncing org docs…' : 'Resync ORG.md & AGENTS.md'}
            </button>
            {orgDocSyncMessage && (
              <span
                style={{
                  fontSize: '0.8rem',
                  color: orgDocSyncMessage.toLowerCase().includes('fail') ? '#f87171' : '#22c55e',
                  maxWidth: 320,
                  textAlign: 'right',
                }}
              >
                {orgDocSyncMessage}
              </span>
            )}
          </div>
        </div>
        <p style={{ color: 'var(--muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
          CEO (you) → reports-to chain for agents in <strong>your</strong> workspace only. Use Chart or Design to arrange departments.
          After structural changes, click <strong>Resync ORG.md &amp; AGENTS.md</strong> to refresh the agent roster (and leaf members).
          Manual edits in the COO&apos;s Role / Priorities / Tools / Guardrails (or other custom sections) are preserved.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => setOrgMode('chart')}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: 6,
              border: `1px solid ${orgMode === 'chart' ? 'var(--accent)' : 'var(--border)'}`,
              background: orgMode === 'chart' ? 'var(--accent)' : 'transparent',
              color: orgMode === 'chart' ? '#fff' : 'var(--text)',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Chart
          </button>
          <button
            type="button"
            onClick={() => setOrgMode('design')}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: 6,
              border: `1px solid ${orgMode === 'design' ? 'var(--accent)' : 'var(--border)'}`,
              background: orgMode === 'design' ? 'var(--accent)' : 'transparent',
              color: orgMode === 'design' ? '#fff' : 'var(--text)',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Design
          </button>
        </div>
        {orgMode === 'design' ? (
          <OrgDesigner
            agents={agents}
            onRemove={removeAgent}
            onChanged={() =>
              api.agentsList().then((list) => setAgents(Array.isArray(list) ? list : list?.agents || []))
            }
          />
        ) : (
          <OrgChart agents={agents} onRemove={removeAgent} />
        )}
        {agents.length === 0 && (
          <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <p style={{ color: 'var(--muted)', margin: '0 0 0.5rem' }}>No agents in the database.</p>
            <p style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: 0 }}>
              Restart the backend — it will auto-seed default agents if the table is empty. Or run from backend: <code style={{ background: 'var(--surface)', padding: '1px 4px', borderRadius: 4 }}>node scripts/seed-all.js</code>
            </p>
            <button
              type="button"
              onClick={() => fetchData()}
              style={{ marginTop: '0.75rem', padding: '0.4rem 0.8rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem' }}
            >
              Refresh agents
            </button>
          </div>
        )}
      </section>

      {/* Standups — create or open a scheduled standup; COO chat opens and is specific to that standup. Child agent responses appear in this chat. */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Standups</h2>
        <p style={{ color: 'var(--muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
          Create or open a standup. Chat with the COO for that standup; delegated agent responses appear here automatically.
          Use <strong>Run status checker</strong> for a CEO status report popup (posted to standup). The HTML email is sent only by the daily batch cron, not from this button.
        </p>
        <div style={{ marginBottom: '0.75rem' }}>
          <button
            type="button"
            onClick={handleStatusChecker}
            disabled={statusCheckerLoading}
            title="Open CEO status report (Kanban digest; email is daily batch only)"
            style={{
              padding: '0.45rem 0.85rem',
              background: statusCheckerLoading ? 'var(--muted)' : 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: statusCheckerLoading ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
            }}
          >
            {statusCheckerLoading ? 'Building report…' : 'Run status checker'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220, maxWidth: 300 }}>
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>Scheduled standups</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.35rem' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateStandupModal(true)}
                  style={{ padding: '0.5rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem' }}
                >
                  Create standup
                </button>
              </div>
            </div>
            {showCreateStandupModal && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 100,
                }}
                onClick={() => !creatingStandup && setShowCreateStandupModal(false)}
              >
                <div
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: '1.25rem',
                    minWidth: 320,
                    maxWidth: 420,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>New standup</h3>
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Title (optional)</label>
                  <input
                    type="text"
                    value={standupTitle}
                    onChange={(e) => setStandupTitle(e.target.value)}
                    placeholder="e.g. Weekly sync"
                    style={{ width: '100%', padding: '0.4rem 0.5rem', marginBottom: '0.75rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', boxSizing: 'border-box' }}
                  />
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Outcomes (first message to COO)</label>
                  <textarea
                    value={standupOutcomes}
                    onChange={(e) => setStandupOutcomes(e.target.value)}
                    placeholder="e.g. Deep research on AI trends; Q2 expense summary"
                    rows={3}
                    style={{ width: '100%', padding: '0.4rem 0.5rem', marginBottom: '0.75rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', resize: 'vertical', boxSizing: 'border-box' }}
                  />
                  <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.85rem', color: 'var(--muted)' }}>Scheduled at (runs daily at this time)</label>
                  <input
                    type="datetime-local"
                    value={standupScheduledAt}
                    onChange={(e) => setStandupScheduledAt(e.target.value)}
                    style={{ width: '100%', padding: '0.4rem 0.5rem', marginBottom: '1rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => !creatingStandup && setShowCreateStandupModal(false)} style={{ padding: '0.4rem 0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text)' }}>Cancel</button>
                    <button type="button" onClick={createStandup} disabled={creatingStandup} style={{ padding: '0.4rem 0.75rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: creatingStandup ? 'not-allowed' : 'pointer' }}>{creatingStandup ? 'Creating…' : 'Create'}</button>
                  </div>
                </div>
              </div>
            )}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {standups.slice(0, 12).map((s) => (
                <li
                  key={s.id}
                  onClick={() => {
                    api.standupGet(s.id).then((full) => {
                      setSelectedStandup(full);
                      setStandups((prev) => prev.map((x) => (x.id === full.id ? full : x)));
                    }).catch(() => setSelectedStandup(s));
                  }}
                  style={{
                    padding: '0.6rem 0.75rem',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: selectedStandup?.id === s.id ? 'var(--accent)' : 'var(--surface)',
                    color: selectedStandup?.id === s.id ? '#fff' : 'var(--text)',
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {formatLocalDateTime(s.scheduled_at)} — {s.status}
                    {s.source === 'cron' && <span style={{ opacity: 0.9, fontSize: '0.8rem' }}> (auto)</span>}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => deleteStandup(s.id, e)}
                    disabled={deletingStandupId === s.id}
                    title="Delete standup"
                    style={{
                      padding: '0.2rem 0.4rem',
                      background: 'transparent',
                      border: '1px solid currentColor',
                      borderRadius: 4,
                      cursor: deletingStandupId === s.id ? 'not-allowed' : 'pointer',
                      opacity: deletingStandupId === s.id ? 0.6 : 0.9,
                      fontSize: '0.75rem',
                    }}
                  >
                    {deletingStandupId === s.id ? '…' : 'Delete'}
                  </button>
                </li>
              ))}
            </ul>
            {standups.length > 0 && (
              <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={deleteAllStandups}
                  disabled={deletingAllStandups}
                  style={{
                    padding: '0.35rem 0.6rem',
                    background: 'transparent',
                    color: 'var(--muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    cursor: deletingAllStandups ? 'not-allowed' : 'pointer',
                    fontSize: '0.8rem',
                  }}
                >
                  {deletingAllStandups ? 'Deleting…' : 'Delete all standups'}
                </button>
              </div>
            )}
            {standups.length === 0 && (
              <p style={{ color: 'var(--muted)', padding: '0.75rem', margin: 0, fontSize: '0.9rem' }}>No standups. Create one above.</p>
            )}
          </div>
          <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: 'min(70vh, 640px)', minHeight: 320 }}>
            {selectedStandup ? (
              <>
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <strong style={{ fontSize: '1rem' }}>
                    COO chat — {selectedStandup.title ? `${selectedStandup.title} · ` : ''}{formatLocalDateTime(selectedStandup.scheduled_at)}
                  </strong>
                  <span style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={handleGetWorkFromTeam}
                      disabled={getWorkLoading}
                      style={{ padding: '0.4rem 0.75rem', background: getWorkLoading ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: getWorkLoading ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
                    >
                      {getWorkLoading ? '…' : 'Get work from team'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCheckForUpdates}
                      disabled={checkUpdatesLoading}
                      style={{ padding: '0.4rem 0.75rem', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, cursor: checkUpdatesLoading ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
                    >
                      {checkUpdatesLoading ? '…' : 'Check for updates'}
                    </button>
                    <button
                      type="button"
                      onClick={handleStatusChecker}
                      disabled={statusCheckerLoading}
                      title="Open CEO status report"
                      style={{ padding: '0.4rem 0.75rem', background: statusCheckerLoading ? 'var(--muted)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: statusCheckerLoading ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
                    >
                      {statusCheckerLoading ? '…' : 'Status report'}
                    </button>
                  </span>
                </div>
                <div className="chat-scroll-panel" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {Array.isArray(selectedStandup.messages) && selectedStandup.messages.length > 0 ? (
                    selectedStandup.messages.map((m) => (
                      <div key={m.id}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: m.role === 'coo' ? 'var(--accent)' : 'var(--text)', fontSize: '0.9rem' }}>
                            {m.role === 'coo' ? 'COO' : 'You'}:
                          </span>
                          {m.created_at && (
                            <time dateTime={m.created_at} style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                              {formatChatTimestamp(m.created_at)}
                            </time>
                          )}
                        </div>
                        <div style={{ margin: '0.2rem 0 0', fontSize: '0.95rem' }}>
                          <ChatMessageContent content={m.content} />
                        </div>
                        {(m.role === 'coo' || m.role === 'assistant') && (
                          <MessageFeedback
                            agentId="balserve"
                            source="standup"
                            messageId={m.id}
                            messageContent={m.content}
                            context={{ standup_id: selectedStandup.id }}
                            compact
                          />
                        )}
                      </div>
                    ))
                  ) : (
                    <p style={{ color: 'var(--muted)', margin: 0, fontSize: '0.9rem' }}>No messages yet. Send the day&apos;s tasks to the COO below.</p>
                  )}
                </div>
                <form onSubmit={handleStandupMessage} style={{ flexShrink: 0, display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                  <ChatComposeInput
                    rows={3}
                    value={standupChatInput}
                    onChange={(e) => setStandupChatInput(e.target.value)}
                    onSend={handleStandupMessage}
                    placeholder="Request AI or finance topics (Shift+Enter for new line). Attach images/docs for Master Data RAG."
                    disabled={sendingMessage}
                    attachments={standupAttachments}
                    onAttachmentsChange={setStandupAttachments}
                    style={{ flex: 1, padding: '0.5rem 0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', resize: 'vertical', minHeight: 56, font: 'inherit' }}
                  />
                  <button type="submit" disabled={sendingMessage || (!standupChatInput.trim() && !standupAttachments.length)} style={{ padding: '0.5rem 1rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: sendingMessage ? 'not-allowed' : 'pointer' }}>
                    {sendingMessage ? 'Sending…' : 'Send'}
                  </button>
                </form>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                  <button type="button" onClick={runCoo} disabled={runningCoo} style={{ padding: '0.35rem 0.75rem', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, cursor: runningCoo ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}>{runningCoo ? '…' : 'Run COO summary'}</button>
                  <button type="button" onClick={() => speak([selectedStandup.coo_summary, selectedStandup.ceo_summary].filter(Boolean).join('\n\n'))} disabled={speaking || (!selectedStandup.coo_summary && !selectedStandup.ceo_summary)} style={{ padding: '0.35rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem' }}>Listen</button>
                </div>
                {(selectedStandup.coo_summary || selectedStandup.ceo_summary) && (
                  <details style={{ marginTop: '0.25rem', fontSize: '0.9rem' }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>Summary</summary>
                    <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                      {selectedStandup.coo_summary && <p style={{ margin: '0 0 0.5rem' }}><strong>COO:</strong> {selectedStandup.coo_summary}</p>}
                      {selectedStandup.ceo_summary && <p style={{ margin: 0 }}><strong>CEO:</strong> {selectedStandup.ceo_summary}</p>}
                    </div>
                  </details>
                )}
              </>
            ) : (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                Create a standup or select one from the list to open the COO chat for that schedule.
              </div>
            )}
          </div>
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Data retention</h2>
        <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Permanently delete chats, standup history, and workflow run instances older than your profile retention window
          (currently <strong>{retentionDays} days</strong>). A daily job also runs this automatically. Change the window in{' '}
          <Link to="/profile">My profile</Link>.
        </p>
        <button
          type="button"
          onClick={handleRetentionPurge}
          disabled={retentionPurgeLoading}
          style={{
            padding: '0.5rem 0.9rem',
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            cursor: retentionPurgeLoading ? 'not-allowed' : 'pointer',
            fontSize: '0.9rem',
          }}
        >
          {retentionPurgeLoading ? 'Purging…' : `Purge data older than ${retentionDays} days`}
        </button>
        {orgDocSyncMessage && (
          <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--muted)' }}>{orgDocSyncMessage}</p>
        )}
      </section>

      {/* Sync from OpenClaw — hidden from Dashboard (API still available for admin/scripts) */}

      {/* Add agent — creates under this CEO's OpenClaw tenant + under COO */}
      <section>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Add agent</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
          Creates a custom agent in <strong>your</strong> OpenClaw tenant space. Set department and who they report to for the org chart.
        </p>
        <form onSubmit={addAgent} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Agent name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
            style={{
              padding: '0.5rem 0.75rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              minWidth: 160,
            }}
          />
          <input
            type="text"
            placeholder="Role (optional)"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              minWidth: 120,
            }}
          />
          <DepartmentPicker
            value={newDepartment}
            onChange={setNewDepartment}
            compact
            ariaLabel="Department"
            selectStyle={{ background: 'var(--surface)' }}
          />
          <select
            value={newParentId}
            onChange={(e) => setNewParentId(e.target.value)}
            aria-label="Reports to"
            style={{
              padding: '0.5rem 0.75rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              minWidth: 160,
            }}
          >
            <option value="">Reports to (COO default)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.is_coo ? ' (COO)' : ''}{a.department ? ` · ${a.department}` : ''}</option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            placeholder="Monthly tokens"
            title="Monthly token budget — warn at 80%, block new work at 100%"
            value={newTokenBudget}
            onChange={(e) => setNewTokenBudget(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              width: 150,
            }}
          />
          <input
            type="number"
            min="0"
            max="100"
            step="0.5"
            placeholder="Error budget %"
            title="Max monthly failure rate before new work is blocked"
            value={newErrorBudget}
            onChange={(e) => setNewErrorBudget(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              width: 130,
            }}
          />
          <button
            type="submit"
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
            }}
          >
            Add agent
          </button>
        </form>
        {addAgentMessage && (
          <div
            style={{
              marginTop: '0.5rem',
              padding: '0.75rem 1rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: '0.9rem',
              color: 'var(--text)',
            }}
          >
            {addAgentMessage}
            <button
              type="button"
              onClick={() => setAddAgentMessage(null)}
              style={{ marginLeft: '0.75rem', padding: '0.2rem 0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              Dismiss
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

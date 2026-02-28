import { useState, useEffect, useRef } from 'react';
import { api } from '../api';

const STATUSES = ['open', 'awaiting_confirmation', 'in_progress', 'completed', 'failed'];
const STATUS_LABELS = {
  open: 'Open',
  awaiting_confirmation: 'Awaiting confirmation',
  in_progress: 'In progress',
  completed: 'Completed',
  failed: 'Failed',
};

export default function Kanban() {
  const [agents, setAgents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState('weekly');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskDetail, setTaskDetail] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createAssignTo, setCreateAssignTo] = useState('coo');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [messageInput, setMessageInput] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [reopeningId, setReopeningId] = useState(null);
  const [draggingTask, setDraggingTask] = useState(null);
  const [dropTargetStatus, setDropTargetStatus] = useState(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const messagesEndRef = useRef(null);

  const toggleTaskSelection = (taskId, e) => {
    if (e) e.stopPropagation();
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };
  const selectAllTasks = (e) => {
    if (e) e.stopPropagation();
    if (selectedTaskIds.size === tasks.length) setSelectedTaskIds(new Set());
    else setSelectedTaskIds(new Set(tasks.map((t) => t.id)));
  };
  const deleteSelected = () => {
    if (selectedTaskIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedTaskIds.size} task(s)? This cannot be undone.`)) return;
    setDeleting(true);
    api.kanbanTasksDeleteBulk([...selectedTaskIds])
      .then(() => {
        setSelectedTaskIds(new Set());
        fetchTasks();
        if (selectedTask && selectedTaskIds.has(selectedTask.id)) setSelectedTask(null);
      })
      .catch((err) => setError(err.message || 'Delete failed'))
      .finally(() => setDeleting(false));
  };

  const fetchTasks = () => {
    const params = { view, limit: 300 };
    if (view === 'range') {
      if (rangeFrom) params.from = rangeFrom;
      if (rangeTo) params.to = rangeTo;
    }
    api.kanbanTasks(params).then((r) => setTasks(r.tasks || [])).catch(() => setTasks([]));
  };

  useEffect(() => {
    setLoading(true);
    api.agentsList().then(setAgents).catch(() => setAgents([]));
    fetchTasks();
    setLoading(false);
  }, [view, rangeFrom, rangeTo]);

  useEffect(() => {
    if (!selectedTask) {
      setTaskDetail(null);
      return;
    }
    api.kanbanTaskGet(selectedTask.id).then(setTaskDetail).catch(() => setTaskDetail(null));
  }, [selectedTask?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [taskDetail?.messages]);

  const totalCount = tasks.length;
  const byAgentAndStatus = {};
  const agentIds = ['__unassigned__', ...agents.map((a) => a.id)];
  agentIds.forEach((aid) => {
    byAgentAndStatus[aid] = {};
    STATUSES.forEach((s) => (byAgentAndStatus[aid][s] = []));
  });
  tasks.forEach((t) => {
    const aid = t.assigned_agent_id || '__unassigned__';
    if (!byAgentAndStatus[aid]) {
      byAgentAndStatus[aid] = {};
      STATUSES.forEach((s) => (byAgentAndStatus[aid][s] = []));
    }
    if (!byAgentAndStatus[aid][t.status]) byAgentAndStatus[aid][t.status] = [];
    byAgentAndStatus[aid][t.status].push(t);
  });

  const agentName = (id) => {
    if (id === '__unassigned__') return 'Unassigned';
    const a = agents.find((x) => x.id === id);
    return a ? a.name : id;
  };

  const handleDragStart = (e, task) => {
    setDraggingTask(task);
    e.dataTransfer.setData('text/plain', String(task.id));
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragEnd = () => {
    setDraggingTask(null);
    setDropTargetStatus(null);
  };
  const handleDragOver = (e, status) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetStatus(status);
  };
  const handleDragLeave = () => setDropTargetStatus(null);
  const handleDrop = (e, toStatus) => {
    e.preventDefault();
    setDropTargetStatus(null);
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId || !toStatus) return;
    const task = tasks.find((t) => String(t.id) === taskId);
    if (!task || task.status === toStatus) return;
    api.kanbanTaskUpdate(Number(taskId), { status: toStatus })
      .then(() => { fetchTasks(); setDraggingTask(null); if (selectedTask?.id === Number(taskId)) setTaskDetail((d) => (d ? { ...d, status: toStatus } : d)); })
      .catch(() => {});
  };

  const handleCreate = () => {
    if (!createTitle.trim()) {
      setCreateError('Title required');
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    if (createAssignTo === 'coo') {
      api.standupsList(1)
        .then((standups) => {
          const standupId = standups[0]?.id;
          if (standupId) {
            return api.standupSendMessage(standupId, { content: createTitle.trim() });
          }
          return api.standupCreate({}).then((s) => api.standupSendMessage(s.id, { content: createTitle.trim() }));
        })
        .then(() => {
          setCreateOpen(false);
          setCreateTitle('');
          setCreateDesc('');
          setCreateAssignTo('coo');
          fetchTasks();
        })
        .catch((e) => setCreateError(e.message || 'Failed'))
        .finally(() => setCreateSubmitting(false));
    } else {
      api.kanbanTaskCreate({
        title: createTitle.trim(),
        description: createDesc.trim(),
        assign_to: createAssignTo,
      })
        .then(() => {
          setCreateOpen(false);
          setCreateTitle('');
          setCreateDesc('');
          setCreateAssignTo('coo');
          fetchTasks();
        })
        .catch((e) => setCreateError(e.message || 'Failed'))
        .finally(() => setCreateSubmitting(false));
    }
  };

  const sendMessage = () => {
    if (!messageInput.trim() || !selectedTask) return;
    setSendingMessage(true);
    api.kanbanTaskAddMessage(selectedTask.id, 'user', messageInput.trim())
      .then(() => api.kanbanTaskGet(selectedTask.id))
      .then(setTaskDetail)
      .finally(() => {
        setMessageInput('');
        setSendingMessage(false);
      });
  };

  const reopenTask = (task) => {
    setReopeningId(task.id);
    api.kanbanTaskReopen(task.id)
      .then(() => {
        fetchTasks();
        if (selectedTask?.id === task.id) api.kanbanTaskGet(task.id).then(setTaskDetail);
      })
      .finally(() => setReopeningId(null));
  };

  return (
    <div style={{ padding: '1rem', maxWidth: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Kanban</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {['daily', 'weekly', 'monthly'].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                padding: '0.35rem 0.75rem',
                border: `1px solid ${view === v ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6,
                background: view === v ? 'var(--accent)' : 'transparent',
                color: view === v ? 'white' : 'inherit',
                cursor: 'pointer',
              }}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
          <span style={{ marginLeft: '0.5rem' }}>Range:</span>
          <input
            type="date"
            value={rangeFrom}
            onChange={(e) => setRangeFrom(e.target.value)}
            style={{ padding: '0.35rem', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          <input
            type="date"
            value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value)}
            style={{ padding: '0.35rem', borderRadius: 6, border: '1px solid var(--border)' }}
          />
          <button type="button" onClick={() => { setView('range'); fetchTasks(); }} style={{ padding: '0.35rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}>
            Apply
          </button>
        </div>
        <div style={{ flex: 1, minWidth: 120, maxWidth: 300 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 2 }}>Total tasks</div>
          <div style={{ height: 8, background: 'var(--surface)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: totalCount > 0 ? Math.min(100, (totalCount / 50) * 100) + '%' : 0,
                background: 'var(--accent)',
                borderRadius: 4,
              }}
            />
          </div>
          <span style={{ fontSize: '0.85rem' }}>{totalCount} tasks</span>
        </div>
        {selectedTaskIds.size > 0 && (
          <button
            type="button"
            onClick={deleteSelected}
            disabled={deleting}
            style={{ padding: '0.5rem 1rem', borderRadius: 6, background: 'var(--error, #dc2626)', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            {deleting ? 'Deleting…' : `Delete selected (${selectedTaskIds.size})`}
          </button>
        )}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          style={{ padding: '0.5rem 1rem', borderRadius: 6, background: 'var(--accent)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600 }}
        >
          + New task
        </button>
      </div>

      {error && <div style={{ color: 'var(--error)', marginBottom: '0.5rem' }}>{error}</div>}
      {loading && <div style={{ color: 'var(--muted)' }}>Loading…</div>}

      <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
        <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', border: '1px solid var(--border)' }}>
          <thead>
            <tr>
              <th style={{ padding: '0.5rem', border: '1px solid var(--border)', background: 'var(--surface)', width: 44 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={tasks.length > 0 && selectedTaskIds.size === tasks.length}
                    onChange={selectAllTasks}
                    title="Select all"
                  />
                  <span style={{ fontSize: '0.75rem' }}>All</span>
                </label>
              </th>
              <th style={{ padding: '0.5rem', border: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left', minWidth: 120 }}>
                Agent
              </th>
              {STATUSES.map((s) => (
                <th key={s} style={{ padding: '0.5rem', border: '1px solid var(--border)', background: 'var(--surface)', minWidth: 140 }}>
                  {STATUS_LABELS[s]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agentIds.map((aid) => (
              <tr key={aid}>
                <td style={{ padding: '0.5rem', border: '1px solid var(--border)' }} />
                <td style={{ padding: '0.5rem', border: '1px solid var(--border)', fontWeight: 500 }}>{agentName(aid)}</td>
                {STATUSES.map((status) => (
                  <td
                    key={status}
                    onDragOver={(e) => handleDragOver(e, status)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, status)}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      verticalAlign: 'top',
                      minWidth: 140,
                      background: dropTargetStatus === status ? 'rgba(59, 130, 246, 0.1)' : undefined,
                    }}
                  >
                    {(byAgentAndStatus[aid]?.[status] || []).map((t) => (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, t)}
                        onDragEnd={handleDragEnd}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedTask(t)}
                        onKeyDown={(e) => e.key === 'Enter' && setSelectedTask(t)}
                        style={{
                          padding: '0.5rem',
                          marginBottom: '0.35rem',
                          background: draggingTask?.id === t.id ? 'var(--border)' : 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          cursor: draggingTask?.id === t.id ? 'grabbing' : 'grab',
                          fontSize: '0.9rem',
                          opacity: draggingTask?.id === t.id ? 0.8 : 1,
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.5rem',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTaskIds.has(t.id)}
                          onChange={(e) => toggleTaskSelection(t.id, e)}
                          onClick={(e) => e.stopPropagation()}
                          title="Select task"
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{t.title || '(no title)'}</div>
                          {t.created_at && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: 2 }}>
                              {new Date(t.created_at).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--bg)', padding: '1.5rem', borderRadius: 12, maxWidth: 440, width: '90%', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
            <h2 style={{ marginTop: 0 }}>New task</h2>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem' }}>Title *</label>
              <input
                type="text"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="Task title"
                style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
              />
            </div>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem' }}>Description</label>
              <textarea
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="Optional"
                rows={2}
                style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem' }}>Assign to</label>
              <select
                value={createAssignTo}
                onChange={(e) => setCreateAssignTo(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}
              >
                <option value="coo">COO (intent / delegate)</option>
                {agents.filter((a) => !a.is_coo).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            {createError && <div style={{ color: 'var(--error)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>{createError}</div>}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setCreateOpen(false)} style={{ padding: '0.5rem 1rem', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={handleCreate} disabled={createSubmitting} style={{ padding: '0.5rem 1rem', borderRadius: 6, background: 'var(--accent)', color: 'white', border: 'none', cursor: 'pointer' }}>
                {createSubmitting ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTask && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', zIndex: 100 }}>
          <div
            style={{
              width: 'min(420px, 100%)',
              background: 'var(--bg)',
              boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem' }}>{taskDetail?.title ?? selectedTask.title}</h2>
                <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                  {taskDetail?.assigned_agent_name || selectedTask.assigned_agent_name || 'Unassigned'} · {STATUS_LABELS[taskDetail?.status ?? selectedTask.status]}
                </div>
              </div>
              <button type="button" onClick={() => setSelectedTask(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem' }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
              {taskDetail?.delegation_prompt && (
                <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>Context given to agent</div>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85rem' }}>{taskDetail.delegation_prompt}</div>
                </div>
              )}
              {taskDetail?.delegation_response && (
                <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>Agent response</div>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85rem' }}>{taskDetail.delegation_response}</div>
                </div>
              )}
              {(taskDetail?.messages || []).length > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>Task chat</div>
              )}
              {(taskDetail?.messages || []).map((m) => (
                <div key={m.id} style={{ marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 2 }}>{m.role}</div>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.9rem' }}>{m.content}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div style={{ padding: '1rem', borderTop: '1px solid var(--border)' }}>
              <textarea
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Add message…"
                rows={2}
                style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', marginBottom: '0.5rem', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={sendMessage} disabled={sendingMessage || !messageInput.trim()} style={{ padding: '0.4rem 0.75rem', borderRadius: 6, background: 'var(--accent)', color: 'white', border: 'none', cursor: 'pointer' }}>
                  Send
                </button>
                {selectedTask && (taskDetail?.status ?? selectedTask.status) !== 'open' && (
                  <button
                    type="button"
                    onClick={() => reopenTask(selectedTask)}
                    disabled={reopeningId === selectedTask.id}
                    style={{ padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    {reopeningId === selectedTask.id ? 'Reopening…' : 'Reopen task'}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div style={{ flex: 1 }} onClick={() => setSelectedTask(null)} aria-hidden />
        </div>
      )}
    </div>
  );
}

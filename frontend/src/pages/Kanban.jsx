import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import WizardReturnBanner from '../components/WizardReturnBanner.jsx';
import KanbanTaskDescription, { isCeoJobReviewTask, isGoalActionApprovalTask, isWorkflowCeoApprovalTask, parseCeoReviewContext } from '../components/KanbanTaskDescription.jsx';
import KanbanTaskArtifacts from '../components/KanbanTaskArtifacts.jsx';
import KanbanBoardCell from '../components/KanbanBoardCell.jsx';
import RobotAvatar from '../components/RobotAvatar.jsx';
import { WorkflowIoDetailBlock } from '../components/WorkflowStepTooltip.jsx';
import {
  taskCreatedAtDisplay,
  taskUpdatedAtDisplay,
  rowTimestampDisplay,
} from '../utils/formatDateTime.js';
import ActionFeedbackBanner from '../components/ActionFeedbackBanner.jsx';
import { useActionFeedback } from '../hooks/useActionFeedback.js';
import MessageFeedback from '../components/MessageFeedback.jsx';
import ChatComposeInput from '../components/ChatComposeInput.jsx';
import ChatMessageContent from '../components/ChatMessageContent.jsx';
import ChatMessageAttachments from '../components/ChatMessageAttachments.jsx';
import { buildMessageWithAttachments, uploadChatAttachments, splitChatAttachmentContent } from '../utils/chatAttachments.js';
import { useAuth } from '../context/AuthContext';

const STATUSES = ['open', 'awaiting_confirmation', 'in_progress', 'completed', 'failed'];
const STATUS_LABELS = {
  open: 'Open',
  awaiting_confirmation: 'Awaiting confirmation',
  in_progress: 'In progress',
  completed: 'Completed',
  failed: 'Failed',
};

function isConfirmApprovalMessage(text) {
  const t = String(text || '').trim().toLowerCase();
  return /^(confirm|confirmed|yes|approve|approved|proceed|go ahead|ok|okay|accept|accepted)([.!]?)$/.test(t);
}

export default function Kanban() {
  const { displayTimezone } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState('weekly');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [boardCounts, setBoardCounts] = useState(null);
  const { feedback, showSuccess, showError, clearFeedback } = useActionFeedback();
  const [selectedTask, setSelectedTask] = useState(null);
  const [taskDetail, setTaskDetail] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createAssignTo, setCreateAssignTo] = useState('coo');
  const [createEtaHours, setCreateEtaHours] = useState('8');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [messageInput, setMessageInput] = useState('');
  const [messageAttachments, setMessageAttachments] = useState([]);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [taskChatError, setTaskChatError] = useState(null);
  const [humanOutcome, setHumanOutcome] = useState('');
  const [humanResponding, setHumanResponding] = useState('');
  const [reopeningId, setReopeningId] = useState(null);
  const [draggingTask, setDraggingTask] = useState(null);
  const [dropTargetStatus, setDropTargetStatus] = useState(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [approvingReview, setApprovingReview] = useState(false);
  const [approveError, setApproveError] = useState(null);
  const [approveSuccess, setApproveSuccess] = useState(null);
  const [reviewQueue, setReviewQueue] = useState(null);
  const [includingJobId, setIncludingJobId] = useState(null);
  const [wfApprovalComment, setWfApprovalComment] = useState('');
  const [wfApproving, setWfApproving] = useState(false);
  const [drawerTab, setDrawerTab] = useState('details');
  const [serverTimezone, setServerTimezone] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [mobileStatus, setMobileStatus] = useState('in_progress');
  const [agentFilter, setAgentFilter] = useState('all');
  const taskChatScrollRef = useRef(null);
  const [isMobileKanban, setIsMobileKanban] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false)
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = () => setIsMobileKanban(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleTaskSelection = (taskId, e) => {
    if (e) e.stopPropagation();
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };
  const taskAgentKey = (t) =>
    t.assigned_agent_id || t.assigned_member_key || (t.assigned_user_id ? `user:${t.assigned_user_id}` : '__unassigned__');

  const selectAllTasks = (e) => {
    if (e) e.stopPropagation();
    const visible = tasks.filter((t) => agentFilter === 'all' || taskAgentKey(t) === agentFilter);
    const allSelected =
      visible.length > 0 && visible.every((t) => selectedTaskIds.has(t.id)) && selectedTaskIds.size === visible.length;
    if (allSelected) setSelectedTaskIds(new Set());
    else setSelectedTaskIds(new Set(visible.map((t) => t.id)));
  };
  const deleteSelected = () => {
    if (selectedTaskIds.size === 0) return;
    const hiddenActive =
      boardCounts && view !== 'all' && boardCounts.active > selectedTaskIds.size
        ? `\n\nNote: the board is filtered to "${view}". status_checker / COO reports count ALL open cards (${boardCounts.active} active of any age). Switch to All and delete again if you want the report to go to zero.`
        : '';
    if (
      !window.confirm(
        `Delete ${selectedTaskIds.size} task(s)? This cannot be undone.${hiddenActive}`
      )
    ) {
      return;
    }
    setDeleting(true);
    api.kanbanTasksDeleteBulk([...selectedTaskIds])
      .then(() => {
        const n = selectedTaskIds.size;
        setSelectedTaskIds(new Set());
        fetchTasks();
        if (selectedTask && selectedTaskIds.has(selectedTask.id)) setSelectedTask(null);
        showSuccess(`Deleted ${n} task(s)`);
      })
      .catch((err) => showError(err.message || 'Delete failed'))
      .finally(() => setDeleting(false));
  };

  const fetchTasks = async () => {
    const base = { view };
    if (view === 'range') {
      if (rangeFrom) base.from = rangeFrom;
      if (rangeTo) base.to = rangeTo;
    }
    const pageLimit = view === 'all' ? 500 : 200;
    try {
      let offset = 0;
      let tasksAcc = [];
      let server_timezone;
      // Paginate until board has a complete snapshot (cap total pulls for safety).
      for (let page = 0; page < 20; page++) {
        const r = await api.kanbanTasks({ ...base, limit: pageLimit, offset });
        tasksAcc = tasksAcc.concat(r.tasks || []);
        if (r.server_timezone) server_timezone = r.server_timezone;
        if (!r.has_more) break;
        offset += Number(r.limit) || pageLimit;
      }
      setTasks(tasksAcc);
      if (server_timezone) setServerTimezone(server_timezone);
    } catch {
      setTasks([]);
    }
    api.kanbanCounts()
      .then(setBoardCounts)
      .catch(() => setBoardCounts(null));
  };

  useEffect(() => {
    setLoading(true);
    api.agentsList().then(setAgents).catch(() => setAgents([]));
    fetchTasks();
    setLoading(false);
  }, [view, rangeFrom, rangeTo]);

  // Deep-link /kanban?task=123 from global search (open drawer even outside weekly filter).
  useEffect(() => {
    const raw = searchParams.get('task');
    if (!raw) return undefined;
    const taskId = Number(raw);
    if (!Number.isFinite(taskId) || taskId <= 0) return undefined;
    let cancelled = false;
    api
      .kanbanTaskGet(taskId)
      .then((detail) => {
        if (cancelled || !detail) return;
        setSelectedTask(detail);
        setTaskDetail(detail);
        if (detail.server_timezone) setServerTimezone(detail.server_timezone);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete('task');
            return next;
          },
          { replace: true }
        );
      })
      .catch((err) => showError(err?.message || `Task #${taskId} not found`));
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const loadTaskDetail = (taskId) => {
    if (!taskId) return Promise.resolve();
    setDetailLoading(true);
    setDetailError(null);
    return api
      .kanbanTaskGet(taskId)
      .then((detail) => {
        setTaskDetail(detail);
        if (detail.server_timezone) setServerTimezone(detail.server_timezone);
      })
      .catch((err) => {
        // Never leave a silently empty drawer â€” the CEO must see why it is blank.
        setTaskDetail(null);
        setDetailError(err?.message || 'Could not load this task');
      })
      .finally(() => setDetailLoading(false));
  };

  useEffect(() => {
    if (!selectedTask) {
      setTaskDetail(null);
      setApproveError(null);
      setApproveSuccess(null);
      setDetailError(null);
      setDrawerTab('details');
      return;
    }
    setApproveError(null);
    setApproveSuccess(null);
    setReviewQueue(null);
    setDrawerTab('details');
    loadTaskDetail(selectedTask.id);
  }, [selectedTask?.id]);

  useEffect(() => {
    if (!taskDetail && !selectedTask) return;
    const desc = taskDetail?.description || selectedTask?.description || '';
    const isReview =
      (taskDetail?.status ?? selectedTask?.status) === 'awaiting_confirmation' &&
      isCeoJobReviewTask(taskDetail || selectedTask);
    if (!isReview) {
      setReviewQueue(null);
      return;
    }
    const { profileId, ceoUserId } = parseCeoReviewContext(desc);
    if (!profileId) return;
    api
      .jobApplicantReviewQueue(profileId, ceoUserId || 'default')
      .then(setReviewQueue)
      .catch(() => setReviewQueue(null));
  }, [taskDetail, selectedTask]);

  useEffect(() => {
    const el = taskChatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [taskDetail?.messages]);

  const byAgentAndStatus = {};
  const memberKeys = [...new Set(tasks.map((t) => t.assigned_member_key).filter(Boolean))];
  const peopleKeys = [...new Set(tasks.filter((t) => t.assigned_user_id).map((t) => `user:${t.assigned_user_id}`))];
  const agentIdsAll = ['__unassigned__', ...agents.map((a) => a.id), ...memberKeys, ...peopleKeys];
  agentIdsAll.forEach((aid) => {
    byAgentAndStatus[aid] = {};
    STATUSES.forEach((s) => (byAgentAndStatus[aid][s] = []));
  });
  // External / A2A leaf members are not in `agents`, so their cards are keyed by member key.
  const memberRowNames = {};
  tasks.forEach((t) => {
    const aid = taskAgentKey(t);
    if (t.assigned_member_key && t.assigned_agent_name) {
      memberRowNames[t.assigned_member_key] = t.assigned_agent_name;
    }
    if (!byAgentAndStatus[aid]) {
      byAgentAndStatus[aid] = {};
      STATUSES.forEach((s) => (byAgentAndStatus[aid][s] = []));
    }
    if (!byAgentAndStatus[aid][t.status]) byAgentAndStatus[aid][t.status] = [];
    byAgentAndStatus[aid][t.status].push(t);
  });

  const agentName = (id) => {
    if (id === '__unassigned__') return 'Unassigned';
    if (String(id).startsWith('user:')) {
      const uid = String(id).slice(5);
      const hit = tasks.find((t) => t.assigned_user_id === uid);
      return hit?.assigned_user_name ? `${hit.assigned_user_name} (employee)` : 'Employee';
    }
    const a = agents.find((x) => x.id === id);
    if (a) return a.name;
    if (memberRowNames[id]) return `${memberRowNames[id]} (external)`;
    return id;
  };

  const filteredTasks = agentFilter === 'all' ? tasks : tasks.filter((t) => taskAgentKey(t) === agentFilter);
  const totalCount = filteredTasks.length;
  const agentIds = agentFilter === 'all' ? agentIdsAll : agentIdsAll.filter((aid) => aid === agentFilter);

  const allVisibleSelected =
    filteredTasks.length > 0 &&
    filteredTasks.every((t) => selectedTaskIds.has(t.id)) &&
    selectedTaskIds.size === filteredTasks.length;

  const handleDragStart = (e, task) => {
    if (task.can_mutate === false) {
      e.preventDefault();
      return;
    }
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
      .then(() => {
        fetchTasks();
        setDraggingTask(null);
        if (selectedTask?.id === Number(taskId)) setTaskDetail((d) => (d ? { ...d, status: toStatus } : d));
        showSuccess(`Task moved to ${STATUS_LABELS[toStatus] || toStatus}`);
      })
      .catch((err) => showError(err.message || 'Failed to move task'));
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
          showSuccess('Task sent to COO');
        })
        .catch((e) => {
          setCreateError(e.message || 'Failed');
          showError(e.message || 'Failed to create task');
        })
        .finally(() => setCreateSubmitting(false));
    } else {
      api.kanbanTaskCreate({
        title: createTitle.trim(),
        description: createDesc.trim(),
        assign_to: createAssignTo,
        eta_hours: Number(createEtaHours),
      })
        .then(() => {
          setCreateOpen(false);
          setCreateTitle('');
          setCreateDesc('');
          setCreateAssignTo('coo');
          fetchTasks();
          showSuccess('Task created');
        })
        .catch((e) => {
          setCreateError(e.message || 'Failed');
          showError(e.message || 'Failed to create task');
        })
        .finally(() => setCreateSubmitting(false));
    }
  };

  const approveJobReview = () => {
    const desc = taskDetail?.description || selectedTask?.description || '';
    const { profileId, ceoUserId, workflowId } = parseCeoReviewContext(desc);
    if (!profileId) {
      const msg = 'Could not find profile_id in task. Open a CEO Review task from job pipeline.';
      setApproveError(msg);
      setApproveSuccess(null);
      showError(msg);
      return;
    }
    setApprovingReview(true);
    setApproveError(null);
    setApproveSuccess(null);
    const body = { profile_id: profileId, confirm: true };
    if (ceoUserId) body.ceo_user_id = ceoUserId;
    if (workflowId) body.workflow_id = workflowId;
    api
      .jobCeoReviewConfirm(body)
      .then((result) => {
        setApproveError(null);
        const msg =
          result?.message ||
          (result?.count > 0
            ? `Approved ${result.count} job(s). Application Agent task #${result.prefill_kanban?.kanban_task_id || 'queued'}.`
            : 'Review closed. No jobs were awaiting approval.');
        setApproveSuccess(msg);
        showSuccess(msg);
        return api.kanbanTaskGet(selectedTask.id).then((detail) => ({ detail, result }));
      })
      .then(({ detail, result }) => {
        setTaskDetail(detail);
        fetchTasks();
        if (result?.count > 0 && result?.prefill_kanban?.kanban_task_id) {
          setTimeout(() => {
            setApproveSuccess(
              (prev) =>
                `${prev || ''} Prefill Kanban #${result.prefill_kanban.kanban_task_id} created under Application Agent.`
            );
          }, 0);
        } else if (result?.post_action === 'acknowledged') {
          setApproveSuccess(result.message || `Acknowledged ${result.count} job(s). Workflow complete.`);
        }
      })
      .catch((err) => {
        const msg = err?.message || 'Approve failed';
        setApproveError(msg);
        setApproveSuccess(null);
        showError(msg);
      })
      .finally(() => setApprovingReview(false));
  };

  const includeBorderlineJob = (jobId) => {
    const desc = taskDetail?.description || selectedTask?.description || '';
    const { profileId, ceoUserId } = parseCeoReviewContext(desc);
    if (!profileId) return;
    setIncludingJobId(jobId);
    setApproveError(null);
    api
      .jobApplicantCeoReviewInclude(profileId, {
        job_ids: [jobId],
        ceo_user_id: ceoUserId || undefined,
      })
      .then((result) => {
        const msg =
          result?.message ||
          `Included ${result?.included_count || 1} job(s) â€” now awaiting your approval.`;
        setApproveSuccess(msg);
        showSuccess(msg);
        return Promise.all([
          api.jobApplicantReviewQueue(profileId, ceoUserId || 'default').then(setReviewQueue),
          selectedTask ? api.kanbanTaskGet(selectedTask.id).then(setTaskDetail) : Promise.resolve(),
        ]);
      })
      .then(() => fetchTasks())
      .catch((err) => {
        const msg = err?.message || 'Include failed';
        setApproveError(msg);
        showError(msg);
      })
      .finally(() => setIncludingJobId(null));
  };

  const sendMessage = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if ((!messageInput.trim() && !messageAttachments.length) || !selectedTask) return;
    if (selectedTask.can_mutate === false) return;

    const trimmed = messageInput.trim();
    const files = [...messageAttachments];
    const isCeoReview =
      (taskDetail?.status ?? selectedTask.status) === 'awaiting_confirmation' &&
      isCeoJobReviewTask(taskDetail || selectedTask);

    if (isCeoReview && isConfirmApprovalMessage(trimmed) && !files.length) {
      setMessageInput('');
      setMessageAttachments([]);
      approveJobReview();
      return;
    }

    setTaskChatError(null);
    setSendingMessage(true);
    try {
      const uploaded = files.length ? await uploadChatAttachments(files) : [];
      const content = buildMessageWithAttachments(trimmed, uploaded);
      await api.kanbanTaskAddMessage(selectedTask.id, 'user', content);
      const detail = await api.kanbanTaskGet(selectedTask.id);
      setTaskDetail(detail);
      setMessageInput('');
      setMessageAttachments([]);
      showSuccess('Message sent');
    } catch (err) {
      const msg = err?.message || 'Failed to send message';
      setTaskChatError(msg);
      showError(msg);
    } finally {
      setSendingMessage(false);
    }
  };

  const reopenTask = (task) => {
    setReopeningId(task.id);
    api.kanbanTaskReopen(task.id)
      .then(() => {
        fetchTasks();
        if (selectedTask?.id === task.id) api.kanbanTaskGet(task.id).then(setTaskDetail);
        showSuccess('Task reopened');
      })
      .catch((err) => showError(err.message || 'Failed to reopen task'))
      .finally(() => setReopeningId(null));
  };

  const respondHumanTask = async (action) => {
    if (!selectedTask || !humanOutcome.trim()) return;
    setHumanResponding(action); setTaskChatError(null);
    try {
      await api.kanbanHumanRespond(selectedTask.id, { action, outcome: humanOutcome.trim() });
      setHumanOutcome('');
      const detail = await api.kanbanTaskGet(selectedTask.id); setTaskDetail(detail); setSelectedTask(detail);
      await fetchTasks(); showSuccess(action === 'complete' ? 'Outcome recorded; the goal resumed.' : action === 'unable' ? 'Blocker recorded and returned to the orchestrator.' : 'Question sent; the goal is waiting for an answer.');
    } catch (e) { setTaskChatError(e.message); showError(e.message); } finally { setHumanResponding(''); }
  };

  const selectedCanMutate = selectedTask?.can_mutate !== false;

  const selectedIsWorkflowApproval =
    selectedTask &&
    (taskDetail?.status ?? selectedTask.status) === 'awaiting_confirmation' &&
    isWorkflowCeoApprovalTask(taskDetail || selectedTask);

  const selectedIsGoalActionApproval =
    selectedTask &&
    (taskDetail?.status ?? selectedTask.status) === 'awaiting_confirmation' &&
    isGoalActionApprovalTask(taskDetail || selectedTask);

  const respondWorkflowApproval = (decision) => {
    if (!selectedTask) return;
    setWfApproving(true);
    setApproveError(null);
    setApproveSuccess(null);
    api
      .agentWorkflowApprovalRespond({
        kanban_task_id: selectedTask.id,
        decision,
        comment: wfApprovalComment.trim(),
      })
      .then((result) => {
        const msg = `Workflow ${result.decision}${wfApprovalComment ? ' â€” comment saved' : ''}`;
        setApproveSuccess(msg);
        showSuccess(msg);
        setWfApprovalComment('');
        return api.kanbanTaskGet(selectedTask.id);
      })
      .then(setTaskDetail)
      .then(() => fetchTasks())
      .catch((e) => {
        setApproveError(e.message);
        showError(e.message || 'Workflow approval failed');
      })
      .finally(() => setWfApproving(false));
  };

  const respondGoalActionApproval = (decision) => {
    if (!selectedTask) return;
    setWfApproving(true);
    setApproveError(null);
    setApproveSuccess(null);
    api.kanbanActionApprovalRespond(selectedTask.id, { decision, comment: wfApprovalComment.trim() })
      .then((result) => {
        const msg = decision === 'approve'
          ? `Approved — resumed goal ${result.goal_run_id}`
          : `Rejected — stopped goal ${result.goal_run_id}`;
        setApproveSuccess(msg);
        showSuccess(msg);
        setWfApprovalComment('');
        return api.kanbanTaskGet(selectedTask.id);
      })
      .then(setTaskDetail)
      .then(() => fetchTasks())
      .catch((e) => {
        setApproveError(e.message || 'Action approval failed');
        showError(e.message || 'Action approval failed');
      })
      .finally(() => setWfApproving(false));
  };

  const selectedIsCeoReview =
    selectedTask &&
    (taskDetail?.status ?? selectedTask.status) === 'awaiting_confirmation' &&
    isCeoJobReviewTask(taskDetail || selectedTask);

  const ceoReviewCtx = parseCeoReviewContext(taskDetail?.description || selectedTask?.description || '');
  const confirmIsApplication = ceoReviewCtx.requiresJobApplication !== false;

  const chatContextTurns = taskDetail?.chat_context?.turns || [];
  const archivedChatTitles = (taskDetail?.chat_context?.archived_sessions || [])
    .map((s) => s.title)
    .filter(Boolean);
  const activityIsEmpty =
    !taskDetail?.delegation_prompt &&
    !taskDetail?.delegation_response &&
    (taskDetail?.messages || []).length === 0 &&
    chatContextTurns.length === 0;

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = filteredTasks.filter((t) => t.status === s).length;
    return acc;
  }, {});
  const mobileTasks = filteredTasks
    .filter((t) => t.status === mobileStatus)
    .slice()
    .sort((a, b) => {
      const ta = a.updated_at || a.created_at || '';
      const tb = b.updated_at || b.created_at || '';
      return String(tb).localeCompare(String(ta));
    });

  const statusTone = (status) => {
    if (status === 'in_progress') return 'running';
    if (status === 'awaiting_confirmation') return 'waiting';
    if (status === 'completed') return 'done';
    if (status === 'failed') return 'failed';
    return 'open';
  };

  return (
    <div className="kanban-page" style={{ padding: '1rem', maxWidth: '100%', overflow: 'auto' }}>
      <WizardReturnBanner />
      <ActionFeedbackBanner feedback={feedback} onDismiss={clearFeedback} />
      <div className="kanban-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: isMobileKanban ? '1.25rem' : '1.5rem' }}>Kanban Board</h1>
        {(displayTimezone || serverTimezone) && (
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }} title="All Kanban dates use your Profile display timezone (or platform default)">
            Times in {displayTimezone || serverTimezone}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {['all', 'daily', 'weekly', 'monthly'].map((v) => (
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
              {v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: '0.25rem', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--muted)' }}>Agent</span>
            <select
              value={agentFilter}
              onChange={(e) => {
                setAgentFilter(e.target.value);
                setSelectedTaskIds(new Set());
              }}
              aria-label="Filter board by agent"
              style={{ padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', maxWidth: 220 }}
            >
              <option value="all">All agents</option>
              <option value="__unassigned__">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.id}
                </option>
              ))}
              {peopleKeys.map((pk) => (
                <option key={pk} value={pk}>
                  {agentName(pk)}
                </option>
              ))}
              {memberKeys.map((mk) => (
                <option key={mk} value={mk}>
                  {memberRowNames[mk] ? `${memberRowNames[mk]} (external)` : mk}
                </option>
              ))}
            </select>
          </label>
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
        {boardCounts && view !== 'all' && boardCounts.active > totalCount && (
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--muted)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '0.25rem 0.5rem',
              maxWidth: 420,
            }}
            title="status_checker / COO status reports count every open card of any age"
          >
            Showing {totalCount} in {view} · {boardCounts.active} active of any age (All) ·{' '}
            {boardCounts.needs_attention} need attention
          </span>
        )}
        {boardCounts && view === 'all' && (
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            {boardCounts.active} active · {boardCounts.needs_attention} need attention · {boardCounts.total} total
          </span>
        )}
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
          onClick={selectAllTasks}
          disabled={filteredTasks.length === 0}
          title={allVisibleSelected ? 'Clear selection' : 'Select all visible tasks'}
          style={{ padding: '0.5rem 1rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface, transparent)', cursor: filteredTasks.length ? 'pointer' : 'not-allowed' }}
        >
          {allVisibleSelected ? 'Clear selection' : `Select all${filteredTasks.length ? ` (${filteredTasks.length})` : ''}`}
        </button>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          style={{ padding: '0.5rem 1rem', borderRadius: 6, background: 'var(--accent)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600 }}
        >
          + New task
        </button>
      </div>

      {loading && <div style={{ color: 'var(--muted)' }}>Loadingâ€¦</div>}

      {isMobileKanban ? (
        <div className="kanban-mobile">
          <div className="kanban-status-pills" role="tablist" aria-label="Kanban columns">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={mobileStatus === s}
                className={`kanban-status-pill${mobileStatus === s ? ' is-active' : ''}`}
                onClick={() => setMobileStatus(s)}
              >
                {STATUS_LABELS[s]} <span className="kanban-status-count">({statusCounts[s] || 0})</span>
              </button>
            ))}
          </div>
          <div className="kanban-mobile-list">
            {mobileTasks.length === 0 && (
              <div className="kanban-mobile-empty">No tasks in {STATUS_LABELS[mobileStatus]}</div>
            )}
            {mobileTasks.map((t) => {
              const agentLabel =
                t.assigned_agent_name ||
                agentName(t.assigned_agent_id || t.assigned_member_key || '__unassigned__');
              const agentRow = agents.find((a) => a.id === t.assigned_agent_id);
              return (
                <div
                  key={t.id}
                  className="kanban-mobile-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedTask(t)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelectedTask(t)}
                >
                  <div className="kanban-mobile-card-top">
                    <RobotAvatar
                      src={agentRow?.avatar_image}
                      name={agentLabel}
                      size={40}
                      status={t.status === 'in_progress' ? 'online' : 'idle'}
                    />
                    <div className="kanban-mobile-card-main">
                      <div className="kanban-mobile-title">{t.title || '(no title)'}</div>
                      <div className="kanban-mobile-agent">{agentLabel}</div>
                    </div>
                    <span className={`kanban-mobile-status tone-${statusTone(t.status)}`}>
                      {STATUS_LABELS[t.status] || t.status}
                    </span>
                    <label className="kanban-mobile-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedTaskIds.has(t.id)}
                        onChange={(e) => toggleTaskSelection(t.id, e)}
                      />
                    </label>
                  </div>
                  <div className="kanban-mobile-meta">
                    <span>Updated {taskUpdatedAtDisplay(t, displayTimezone || serverTimezone)}</span>
                    {isCeoJobReviewTask(t) && <span className="kanban-mobile-tag">CEO review</span>}
                    {isWorkflowCeoApprovalTask(t) && <span className="kanban-mobile-tag">WF approval</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
      <div className="kanban-board-wrap">
        <table className="kanban-board-table">
          <thead>
            <tr>
              <th className="kanban-col-agent">Agent</th>
              {STATUSES.map((s) => (
                <th key={s} className="kanban-col-status">
                  {STATUS_LABELS[s]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agentIds.map((aid) => (
              <tr key={aid}>
                <td className="kanban-col-agent" title={agentName(aid)}>
                  <span className="kanban-agent-cell">
                    <RobotAvatar
                      src={agents.find((a) => a.id === aid)?.avatar_image}
                      name={agentName(aid)}
                      size={22}
                    />
                    <span className="kanban-agent-name">{agentName(aid)}</span>
                  </span>
                </td>
                {STATUSES.map((status) => (
                  <td
                    key={status}
                    onDragOver={(e) => handleDragOver(e, status)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, status)}
                    style={{
                      background: dropTargetStatus === status ? 'rgba(59, 130, 246, 0.1)' : undefined,
                    }}
                  >
                    {(byAgentAndStatus[aid]?.[status] || []).length > 0 && (
                      <KanbanBoardCell
                        cellKey={`${aid}-${status}`}
                        tasks={byAgentAndStatus[aid]?.[status] || []}
                        serverTimezone={displayTimezone || serverTimezone}
                        draggingTask={draggingTask}
                        selectedTaskIds={selectedTaskIds}
                        onSelectTask={setSelectedTask}
                        onToggleSelection={toggleTaskSelection}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

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
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem' }}>ETA / SLA</label>
              <select value={createEtaHours} onChange={(e) => setCreateEtaHours(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)' }}>
                {[4, 8, 12, 24, 36].map((h) => <option key={h} value={h}>{h} hours</option>)}
              </select>
            </div>
            {createError && <div style={{ color: 'var(--error)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>{createError}</div>}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setCreateOpen(false)} style={{ padding: '0.5rem 1rem', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={handleCreate} disabled={createSubmitting} style={{ padding: '0.5rem 1rem', borderRadius: 6, background: 'var(--accent)', color: 'white', border: 'none', cursor: 'pointer' }}>
                {createSubmitting ? 'Creatingâ€¦' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTask && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', zIndex: 100 }}>
          <div
            style={{
              width: 'min(520px, 100%)',
              height: '100%',
              background: 'var(--bg)',
              boxShadow: '-4px 0 20px rgba(0,0,0,0.15)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ flexShrink: 0, padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem' }}>{taskDetail?.title ?? selectedTask.title}</h2>
                <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                  <span title="Task ID">
                    Task ID{' '}
                    <code style={{ fontSize: '0.8rem' }}>{taskDetail?.id ?? selectedTask.id}</code>
                  </span>
                  {' · '}
                  {taskDetail?.assigned_agent_name || selectedTask.assigned_agent_name || 'Unassigned'} · {STATUS_LABELS[taskDetail?.status ?? selectedTask.status]}
                  {taskDetail?.artifact_count > 0 && (
                    <span> · {taskDetail.artifact_count} artifact{taskDetail.artifact_count === 1 ? '' : 's'}</span>
                  )}
                  {(taskDetail?.created_at || selectedTask.created_at) && (
                    <span> · Created {taskCreatedAtDisplay(taskDetail || selectedTask, displayTimezone || serverTimezone)}</span>
                  )}
                  {(taskDetail?.updated_at || selectedTask.updated_at) && (
                    <span> · Updated {taskUpdatedAtDisplay(taskDetail || selectedTask, displayTimezone || serverTimezone)}</span>
                  )}
                </div>
                {drawerTab === 'details' && selectedIsCeoReview && (
                  <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--accent)' }}>
                    Review job links & resumes below, then confirm to proceed with applications.
                  </div>
                )}
              </div>
              <button type="button" onClick={() => setSelectedTask(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem' }}>Ã—</button>
            </div>
            <div
              style={{
                flexShrink: 0,
                display: 'flex',
                gap: 0,
                borderBottom: '1px solid var(--border)',
                padding: '0 0.75rem',
              }}
            >
              {[
                { id: 'details', label: 'Details' },
                { id: 'artifacts', label: `Artifacts${taskDetail?.artifact_count ? ` (${taskDetail.artifact_count})` : ''}` },
                { id: 'activity', label: 'Activity' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDrawerTab(tab.id)}
                  style={{
                    padding: '0.55rem 0.85rem',
                    border: 'none',
                    borderBottom: drawerTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                    background: 'transparent',
                    color: drawerTab === tab.id ? 'var(--accent)' : 'var(--muted)',
                    fontWeight: drawerTab === tab.id ? 600 : 500,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div
              style={{
                flex: '1 1 0',
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
            {(taskDetail || selectedTask)?.assigned_user_id && (taskDetail || selectedTask)?.goal_run_id && ['in_progress','awaiting_confirmation'].includes((taskDetail || selectedTask)?.status) && (
              <section style={{ margin: '1rem 1rem 0', padding: '1rem', border: '1px solid color-mix(in srgb,var(--accent) 45%,var(--border))', borderRadius: 12, background: 'color-mix(in srgb,var(--accent) 7%,var(--surface))' }}>
                <strong>Human outcome required</strong><p style={{ color: 'var(--muted)', margin: '.35rem 0 .65rem', fontSize: '.84rem' }}>Your response is bound to this exact goal step. Completing it automatically continues the orchestrator’s plan.</p>
                <textarea value={humanOutcome} onChange={(e) => setHumanOutcome(e.target.value)} placeholder="Outcome delivered, blocker, or question…" style={{ width: '100%', minHeight: 82, boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}><button className="btn-primary" disabled={!humanOutcome.trim() || !!humanResponding} onClick={() => respondHumanTask('complete')}>{humanResponding === 'complete' ? 'Completing…' : 'Complete task'}</button><button disabled={!humanOutcome.trim() || !!humanResponding} onClick={() => respondHumanTask('question')}>Ask a question</button><button disabled={!humanOutcome.trim() || !!humanResponding} onClick={() => respondHumanTask('unable')} style={{ color: 'var(--danger,#c44)' }}>Unable to complete</button></div>
              </section>
            )}
            <div
              ref={taskChatScrollRef}
              className="chat-scroll-panel"
              style={{ padding: '1rem', flex: '1 1 0', minHeight: 0, overflowY: 'auto' }}
            >
            {detailError && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  borderRadius: 8,
                  border: '1px solid var(--error, #dc2626)',
                  background: 'rgba(220, 38, 38, 0.08)',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ marginBottom: 6 }}>Could not load the full task: {detailError}</div>
                <button
                  type="button"
                  onClick={() => loadTaskDetail(selectedTask.id)}
                  disabled={detailLoading}
                  style={{ padding: '0.3rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}
                >
                  {detailLoading ? 'Retryingâ€¦' : 'Retry'}
                </button>
              </div>
            )}
            {drawerTab === 'details' && selectedIsWorkflowApproval && (
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  margin: '-1rem -1rem 1rem',
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid #ca8a04',
                  background: 'rgba(202, 138, 4, 0.12)',
                }}
              >
                {approveError && (
                  <div style={{ fontSize: '0.85rem', color: '#dc2626', marginBottom: 6 }}>{approveError}</div>
                )}
                {approveSuccess && (
                  <div style={{ fontSize: '0.85rem', color: '#166534', marginBottom: 6 }}>{approveSuccess}</div>
                )}
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 6 }}>
                  Comment (optional)
                  <textarea
                    rows={2}
                    value={wfApprovalComment}
                    onChange={(e) => setWfApprovalComment(e.target.value)}
                    style={{ width: '100%', marginTop: 4, padding: '0.4rem', borderRadius: 6, border: '1px solid var(--border)' }}
                    placeholder="Add a note for the workflowâ€¦"
                  />
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => respondWorkflowApproval('approve')}
                    disabled={wfApproving || !selectedCanMutate}
                    style={{
                      flex: 1,
                      padding: '0.65rem',
                      borderRadius: 6,
                      background: '#16a34a',
                      color: 'white',
                      border: 'none',
                      fontWeight: 700,
                      cursor: wfApproving ? 'wait' : 'pointer',
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => respondWorkflowApproval('reject')}
                    disabled={wfApproving || !selectedCanMutate}
                    style={{
                      flex: 1,
                      padding: '0.65rem',
                      borderRadius: 6,
                      background: '#dc2626',
                      color: 'white',
                      border: 'none',
                      fontWeight: 700,
                      cursor: wfApproving ? 'wait' : 'pointer',
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
            {drawerTab === 'details' && selectedIsGoalActionApproval && (
              <div style={{ position: 'sticky', top: 0, zIndex: 2, margin: '-1rem -1rem 1rem', padding: '0.75rem 1rem', borderBottom: '1px solid #ca8a04', background: 'rgba(202,138,4,0.12)' }}>
                <strong>Action approval required</strong>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '4px 0 8px' }}>
                  Approve resumes this exact paused goal step with a one-use grant. Reject stops the step.
                </div>
                {approveError && <div style={{ fontSize: '0.85rem', color: '#dc2626', marginBottom: 6 }}>{approveError}</div>}
                {approveSuccess && <div style={{ fontSize: '0.85rem', color: '#166534', marginBottom: 6 }}>{approveSuccess}</div>}
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 6 }}>
                  Comment (optional)
                  <textarea rows={2} value={wfApprovalComment} onChange={(e) => setWfApprovalComment(e.target.value)} style={{ width: '100%', marginTop: 4, padding: '0.4rem', borderRadius: 6, border: '1px solid var(--border)' }} />
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => respondGoalActionApproval('approve')} disabled={wfApproving || !selectedCanMutate} style={{ flex: 1, padding: '0.65rem', borderRadius: 6, background: '#16a34a', color: 'white', border: 'none', fontWeight: 700 }}>Approve &amp; continue</button>
                  <button type="button" onClick={() => respondGoalActionApproval('reject')} disabled={wfApproving || !selectedCanMutate} style={{ flex: 1, padding: '0.65rem', borderRadius: 6, background: '#dc2626', color: 'white', border: 'none', fontWeight: 700 }}>Reject</button>
                </div>
              </div>
            )}
            {drawerTab === 'details' && selectedIsCeoReview && (
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  margin: '-1rem -1rem 1rem',
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid var(--accent)',
                  background: 'rgba(34, 197, 94, 0.1)',
                }}
              >
                {approveError && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--error, #dc2626)', marginBottom: 6 }}>{approveError}</div>
                )}
                {approveSuccess && (
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: '#166534',
                      marginBottom: 6,
                      padding: '0.5rem',
                      background: 'rgba(34, 197, 94, 0.15)',
                      borderRadius: 6,
                    }}
                  >
                    {approveSuccess}
                  </div>
                )}
                <button
                  type="button"
                  onClick={approveJobReview}
                  disabled={approvingReview || !selectedCanMutate}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: 6,
                    background: '#16a34a',
                    color: 'white',
                    border: 'none',
                    cursor: approvingReview ? 'wait' : 'pointer',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                  }}
                >
                  {approvingReview
                    ? 'Confirmingâ€¦'
                    : confirmIsApplication
                      ? 'âœ“ Approve applications â€” proceed with prefill'
                      : 'âœ“ Acknowledge scoring summary â€” close workflow'}
                </button>
                <p style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', color: 'var(--muted)' }}>
                  Or type <strong>confirm</strong> in the message box below.
                  {!confirmIsApplication && ' Jobs will be marked acknowledged â€” no Application Agent.'}
                </p>
              </div>
            )}
            {drawerTab === 'details' && selectedIsCeoReview && reviewQueue?.borderline_jobs?.length > 0 && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.75rem 1rem',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'rgba(234, 179, 8, 0.08)',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 8 }}>
                  Below threshold ({reviewQueue.borderline?.min_score}%â€“{reviewQueue.fit_threshold - 1}%) â€” include selectively
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {reviewQueue.borderline_jobs.map((j) => (
                    <div
                      key={j.job_id}
                      style={{
                        padding: '0.5rem 0.65rem',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        fontSize: '0.85rem',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {j.title || 'Untitled'} â€” {j.company || 'Unknown'} ({j.fit_score ?? '?'}%)
                      </div>
                      {j.fit_rationale && (
                        <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: '0.8rem' }}>{j.fit_rationale}</div>
                      )}
                      <button
                        type="button"
                        disabled={includingJobId === j.job_id}
                        onClick={() => includeBorderlineJob(j.job_id)}
                        style={{
                          marginTop: 6,
                          padding: '0.35rem 0.65rem',
                          borderRadius: 6,
                          border: 'none',
                          background: 'var(--accent)',
                          color: 'white',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                        }}
                      >
                        {includingJobId === j.job_id ? 'Includingâ€¦' : 'Include in approval'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {drawerTab === 'artifacts' && (
              <KanbanTaskArtifacts artifacts={taskDetail?.artifacts || []} groups={taskDetail?.artifact_groups || []} />
            )}
            {drawerTab === 'details' &&
              (taskDetail?.delegation_prompt ||
                taskDetail?.workflow_step_input ||
                taskDetail?.workflow_step_output) && (
                <div
                  style={{
                    marginBottom: '1rem',
                    padding: '0.85rem',
                    background: 'rgba(37, 99, 235, 0.06)',
                    borderRadius: 8,
                    border: '1px solid rgba(37, 99, 235, 0.25)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>
                    Input received by agent / task
                  </div>
                  {taskDetail?.delegation_prompt && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 600, marginBottom: 4, color: 'var(--muted)' }}>
                        Agent prompt
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontSize: '0.82rem',
                          fontFamily: 'inherit',
                        }}
                      >
                        {taskDetail.delegation_prompt}
                      </pre>
                    </div>
                  )}
                  {taskDetail?.workflow_step_input && (
                    <WorkflowIoDetailBlock title="Workflow step bindings" io={taskDetail.workflow_step_input} kind="input" />
                  )}
                  {!taskDetail?.delegation_prompt && !taskDetail?.workflow_step_input && taskDetail?.workflow_step_output && (
                    <WorkflowIoDetailBlock title="Workflow step context" io={taskDetail.workflow_step_output} kind="output" />
                  )}
                </div>
              )}
            {drawerTab === 'details' && (
                <div
                  style={{
                    marginBottom: '1rem',
                    padding: '0.85rem',
                    background: selectedIsCeoReview ? 'rgba(124, 58, 237, 0.06)' : 'var(--surface)',
                    borderRadius: 8,
                    border: `1px solid ${selectedIsCeoReview ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>
                    {selectedIsCeoReview ? 'Job application review (shortlist, portals, resumes)' : 'Task description'}
                  </div>
                  <KanbanTaskDescription description={taskDetail?.description || selectedTask.description} />
                </div>
              )}
            {drawerTab === 'activity' && taskDetail?.delegation_prompt && (
                <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>Context given to agent</div>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85rem' }}>{taskDetail.delegation_prompt}</div>
                </div>
              )}
            {drawerTab === 'activity' && taskDetail?.delegation_response && (
                <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>Agent response</div>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.85rem' }}>{taskDetail.delegation_response}</div>
                </div>
              )}
            {drawerTab === 'activity' && (taskDetail?.messages || []).length > 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 4, fontWeight: 600 }}>Task chat</div>
              )}
            {drawerTab === 'activity' && (taskDetail?.messages || []).map((m) => {
                const parsed = splitChatAttachmentContent(m.content);
                return (
                <div key={m.id} style={{ marginBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>{m.role}</span>
                    {m.created_at && (
                      <time dateTime={m.created_at} style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                        {rowTimestampDisplay(m, displayTimezone || serverTimezone)}
                      </time>
                    )}
                  </div>
                  {parsed.attachments?.length > 0 && (
                    <ChatMessageAttachments attachments={parsed.attachments} />
                  )}
                  {(parsed.text || (!parsed.attachments?.length && m.content)) && (
                    <div style={{ wordBreak: 'break-word', fontSize: '0.9rem' }}>
                      <ChatMessageContent content={parsed.text || m.content} />
                    </div>
                  )}
                  {m.role === 'assistant' && (
                    <MessageFeedback
                      agentId={taskDetail?.assigned_agent_id || selectedTask?.assigned_agent_id || 'balserve'}
                      source="kanban"
                      messageId={m.id}
                      messageContent={m.content}
                      context={{ task_id: taskDetail?.id || selectedTask?.id }}
                      compact
                    />
                  )}
                </div>
                );
              })}
            {drawerTab === 'activity' && chatContextTurns.length > 0 && (
              <div style={{ marginTop: (taskDetail?.messages || []).length ? '1rem' : 0 }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 6, fontWeight: 600 }}>
                  From the agent chat
                  {archivedChatTitles.length > 0 && (
                    <span style={{ fontWeight: 500 }}>
                      {' '}· archived chat{archivedChatTitles.length > 1 ? 's' : ''}: {archivedChatTitles.join(', ')}
                    </span>
                  )}
                </div>
                {chatContextTurns.map((t) => {
                  const parsed = splitChatAttachmentContent(t.content);
                  return (
                  <div key={`chat-${t.id}`} style={{ marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', marginBottom: 2 }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>{t.role}</span>
                      {t.created_at && (
                        <time dateTime={t.created_at} style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>
                          {rowTimestampDisplay(t, displayTimezone || serverTimezone)}
                        </time>
                      )}
                      {t.session_archived && (
                        <span style={{ fontSize: '0.62rem', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 4px' }}>
                          archived
                        </span>
                      )}
                    </div>
                    {parsed.attachments?.length > 0 && (
                      <ChatMessageAttachments attachments={parsed.attachments} />
                    )}
                    {(parsed.text || (!parsed.attachments?.length && t.content)) && (
                      <div style={{ wordBreak: 'break-word', fontSize: '0.88rem' }}>
                        <ChatMessageContent content={parsed.text || t.content} />
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
            {drawerTab === 'activity' && activityIsEmpty && (
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)', fontStyle: 'italic', margin: 0 }}>
                {detailLoading
                  ? 'Loading activityâ€¦'
                  : 'No activity recorded for this task yet â€” no delegation exchange, task chat, or linked agent chat. Send a message below to start one.'}
              </p>
            )}
            </div>
            </div>
            <div style={{ flexShrink: 0, padding: '1rem', borderTop: '1px solid var(--border)' }}>
              <form onSubmit={sendMessage} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {taskChatError && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--error, #dc2626)' }}>{taskChatError}</div>
                )}
                <ChatComposeInput
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onSend={sendMessage}
                  placeholder={
                    selectedTask?.can_mutate === false
                      ? 'View only — you can act on tasks in your department'
                      : selectedIsCeoReview
                        ? 'Type confirm to approve, or add a note… (Shift+Enter for new line)'
                        : 'Add message… Attach images/docs for Master Data RAG.'
                  }
                  rows={2}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', resize: 'vertical' }}
                  disabled={sendingMessage || selectedTask?.can_mutate === false}
                  attachments={messageAttachments}
                  onAttachmentsChange={setMessageAttachments}
                />
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="submit" disabled={sendingMessage || selectedTask?.can_mutate === false || (!messageInput.trim() && !messageAttachments.length)} style={{ padding: '0.4rem 0.75rem', borderRadius: 6, background: 'var(--accent)', color: 'white', border: 'none', cursor: 'pointer' }}>
                    {sendingMessage ? 'Sendingâ€¦' : 'Send'}
                  </button>
                {selectedTask && (taskDetail?.status ?? selectedTask.status) !== 'open' && (
                  <button
                    type="button"
                    onClick={() => reopenTask(selectedTask)}
                    disabled={reopeningId === selectedTask.id || selectedTask.can_mutate === false}
                    style={{ padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}
                  >
                    {reopeningId === selectedTask.id ? 'Reopeningâ€¦' : 'Reopen task'}
                  </button>
                )}
                </div>
              </form>
            </div>
          </div>
          <div style={{ flex: 1 }} onClick={() => setSelectedTask(null)} aria-hidden />
        </div>
      )}
    </div>
  );
}

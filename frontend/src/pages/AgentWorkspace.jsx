import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import DepartmentPicker from '../components/DepartmentPicker';
import AgentAvatarPicker from '../components/AgentAvatarPicker.jsx';
import PublishAgentToExchangeModal from '../components/PublishAgentToExchangeModal.jsx';
import RobotAvatar from '../components/RobotAvatar.jsx';

const FILE_NAMES = ['soul', 'agents', 'memory', 'tools', 'ops', 'identity'];
const TOOLS_TAB = '__tool_access__';
const SKILLS_TAB = '__skills__';
const riskTierColor = (tier) => ({ R0: '#22c55e', R1: '#38bdf8', R2: '#f59e0b', R3: '#ef4444', R4: '#a855f7' }[tier] || '#94a3b8');

export default function AgentWorkspace() {
  const { agentId } = useParams();
  const [agent, setAgent] = useState(null);
  const [allAgents, setAllAgents] = useState([]);
  const [files, setFiles] = useState({ files: [], daily: [] });
  const [workspaceRoot, setWorkspaceRoot] = useState(null);
  const [selected, setSelected] = useState('soul');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearingSessions, setClearingSessions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toolCatalog, setToolCatalog] = useState([]);
  const [toolGrants, setToolGrants] = useState(new Set());
  const [toolsSaving, setToolsSaving] = useState(false);
  const [connectorApps, setConnectorApps] = useState([]);
  const [connectorAppId, setConnectorAppId] = useState('');
  const [connectorActions, setConnectorActions] = useState([]);
  const [connectorActionGrants, setConnectorActionGrants] = useState(new Set());
  const [connectorQuery, setConnectorQuery] = useState('');
  const [connectorLoading, setConnectorLoading] = useState(false);
  const [connectorSaving, setConnectorSaving] = useState(false);
  const [connectorMessage, setConnectorMessage] = useState(null);
  const [mcpServers, setMcpServers] = useState([]);
  const [mcpServerId, setMcpServerId] = useState('');
  const [mcpToolGrants, setMcpToolGrants] = useState(new Set());
  const [mcpSaving, setMcpSaving] = useState(false);
  const [mcpMessage, setMcpMessage] = useState(null);
  const [syncingMd, setSyncingMd] = useState(false);
  const [orgDept, setOrgDept] = useState('');
  const [orgParentId, setOrgParentId] = useState('');
  const [isOrchestrator, setIsOrchestrator] = useState(false);
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgMessage, setOrgMessage] = useState(null);
  const [wsTemplates, setWsTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('platform-standard');
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [publishingTemplate, setPublishingTemplate] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [templateMessage, setTemplateMessage] = useState(null);
  const [showPublish, setShowPublish] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [editorFullscreen, setEditorFullscreen] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState([]);
  const [skillAssignments, setSkillAssignments] = useState(new Set());
  const [skillAssignmentRows, setSkillAssignmentRows] = useState([]);
  const [skillAuditRows, setSkillAuditRows] = useState([]);
  const [skillsSaving, setSkillsSaving] = useState(false);
  const [skillsMessage, setSkillsMessage] = useState(null);
  const [showSkillCreate, setShowSkillCreate] = useState(false);
  const emptySkillDraft = { name: '', description: '', trigger_hints: '', required_tools: '', required_connector_actions: '', skill_md: '---\nname: company-skill\ndescription: Describe when this skill should be used.\n---\n\n# Company skill\n\n## When to use\n\n## Procedure\n' };
  const [skillDraft, setSkillDraft] = useState(emptySkillDraft);
  const [editingSkillId, setEditingSkillId] = useState(null);

  useEffect(() => {
    if (!editorFullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setEditorFullscreen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [editorFullscreen]);

  const clearSessions = () => {
    if (!window.confirm('Clear all AgentSystem sessions for this agent? Chat and task session history will be reset.')) return;
    setClearingSessions(true);
    setError(null);
    api.agentSessionsClear(agentId)
      .then(() => setError(null))
      .catch((e) => setError(e.message))
      .finally(() => setClearingSessions(false));
  };

  useEffect(() => {
    api.agentGet(agentId)
      .then((a) => {
        setAgent(a);
        setOrgDept(a.department || '');
        setOrgParentId(a.parent_id || '');
        setIsOrchestrator(!!a.is_orchestrator || !!a.is_coo);
      })
      .catch((e) => setError(e.message));
    api.agentsList()
      .then((list) => setAllAgents(Array.isArray(list) ? list : list?.agents || []))
      .catch(() => setAllAgents([]));
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    api.agentConnectorActionsGet(agentId)
      .then((r) => {
        const apps = r.apps || [];
        const grants = new Set((r.grants || []).map((item) => String(item.action_id || item.id || item)));
        setConnectorApps(apps);
        setConnectorActionGrants(grants);
        const grantedApp = [...grants][0]?.split('.')[0];
        const initial = apps.find((app) => app.id === grantedApp) || apps.find((app) => app.connected) || apps[0];
        if (initial) setConnectorAppId(String(initial.id));
      })
      .catch((e) => setConnectorMessage({ type: 'error', text: e.message }));
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    api.agentMcpToolsGet(agentId)
      .then((r) => {
        const servers = r.servers || [];
        setMcpServers(servers);
        setMcpServerId((current) => current || servers[0]?.id || '');
        setMcpToolGrants(new Set((r.grants || []).map((item) => `${item.server_id}\u0000${item.tool_name}`)));
      })
      .catch((e) => setMcpMessage({ type: 'error', text: e.message }));
  }, [agentId]);

  useEffect(() => {
    if (!connectorAppId) {
      setConnectorActions([]);
      return;
    }
    setConnectorLoading(true);
    setConnectorMessage(null);
    api.openconnectorActions(connectorAppId)
      .then((r) => setConnectorActions(r.actions || []))
      .catch((e) => {
        setConnectorActions([]);
        setConnectorMessage({ type: 'error', text: e.message });
      })
      .finally(() => setConnectorLoading(false));
  }, [connectorAppId]);

  useEffect(() => {
    if (!agentId) return;
    api.agentWorkspaceFiles(agentId)
      .then((r) => {
        setFiles(r);
        if (r?.workspace_root) setWorkspaceRoot(r.workspace_root);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    api.agentToolsGet(agentId)
      .then((r) => {
        setToolCatalog(r.tools || []);
        setToolGrants(new Set((r.grants || []).map(String)));
      })
      .catch((e) => setError(e.message));
  }, [agentId]);

  const refreshSkills = () => Promise.all([
    api.agentSkillsGet(agentId),
    api.agentSkillsAudit(agentId, 20),
  ]).then(([r, audit]) => {
    setSkillCatalog(r.skills || []);
    setSkillAssignmentRows(r.assignments || []);
    setSkillAssignments(new Set((r.assignments || []).filter((item) => item.enabled).map((item) => item.skill_id)));
    setSkillAuditRows(audit.rows || []);
    return r;
  });

  useEffect(() => {
    if (!agentId) return;
    refreshSkills().catch((e) => setSkillsMessage({ type: 'error', text: e.message }));
  }, [agentId]);

  useEffect(() => {
    api
      .agentWorkspaceTemplates()
      .then((r) => {
        const list = r.templates || [];
        setWsTemplates(list);
        const def = list.find((t) => t.is_default) || list[0];
        if (def) setSelectedTemplateId(def.id);
      })
      .catch(() => setWsTemplates([]));
  }, []);

  const refreshWorkspaceFiles = () =>
    api.agentWorkspaceFiles(agentId).then((r) => {
      setFiles(r);
      if (r?.workspace_root) setWorkspaceRoot(r.workspace_root);
      return r;
    });

  const applyWorkspaceTemplate = () => {
    if (!selectedTemplateId) return;
    const tpl = wsTemplates.find((t) => t.id === selectedTemplateId);
    if (
      !window.confirm(
        `Apply "${tpl?.name || selectedTemplateId}" to this agent?\n\nThis overwrites SOUL, AGENTS, MEMORY, TOOLS, IDENTITY, and AGENT-OS-OPS in the workspace (ORG/POLICY unchanged).`
      )
    ) {
      return;
    }
    setApplyingTemplate(true);
    setError(null);
    setTemplateMessage(null);
    api
      .agentWorkspaceApplyTemplate(agentId, selectedTemplateId)
      .then(async (r) => {
        setTemplateMessage(`Applied ${r.template_name}: wrote ${(r.written || []).join(', ')}`);
        await refreshWorkspaceFiles();
        if (selected !== TOOLS_TAB) {
          const read = await api.agentWorkspaceRead(agentId, selected);
          setContent(read.text ?? '');
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setApplyingTemplate(false));
  };

  const publishAsPlatformTemplate = () => {
    const name = String(publishName || `${agent?.name || agentId} template`).trim();
    if (!window.confirm(`Publish current workspace MD files as platform template "${name}"?\n\nVisible to all CEOs in Agent Workspace.`)) {
      return;
    }
    setPublishingTemplate(true);
    setError(null);
    setTemplateMessage(null);
    api
      .agentWorkspacePublishTemplate(agentId, { name, description: `From agent ${agent?.name || agentId}` })
      .then((tpl) => {
        setTemplateMessage(`Published platform template: ${tpl.name} (${tpl.id})`);
        setPublishName('');
        return api.agentWorkspaceTemplates();
      })
      .then((r) => setWsTemplates(r.templates || []))
      .catch((e) => setError(e.message))
      .finally(() => setPublishingTemplate(false));
  };

  useEffect(() => {
    if (!agentId || !selected || selected === TOOLS_TAB || selected === SKILLS_TAB) return;
    setLoading(true);
    api.agentWorkspaceRead(agentId, selected)
      .then((r) => setContent(r.text ?? ''))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentId, selected]);

  const save = () => {
    setSaving(true);
    api.agentWorkspaceWrite(agentId, selected, content)
      .then(() => setSaving(false))
      .catch((e) => {
        setError(e.message);
        setSaving(false);
      });
  };

  const toggleTool = (name) => {
    setToolGrants((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const saveTools = () => {
    setToolsSaving(true);
    setError(null);
    api.agentToolsSet(agentId, [...toolGrants], { sync_tools_md: true })
      .then((r) => {
        setToolCatalog(r.tools || []);
        setToolGrants(new Set((r.grants || []).map(String)));
      })
      .catch((e) => setError(e.message))
      .finally(() => setToolsSaving(false));
  };

  const toggleConnectorAction = (id) => {
    setConnectorActionGrants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConnectorMessage(null);
  };

  const saveConnectorActions = () => {
    setConnectorSaving(true);
    setConnectorMessage(null);
    api.agentConnectorActionsSet(agentId, [...connectorActionGrants])
      .then(async (r) => {
        setConnectorActionGrants(new Set((r.grants || []).map((item) => String(item.action_id || item.id || item))));
        const tools = await api.agentToolsGet(agentId);
        setToolCatalog(tools.tools || []);
        setToolGrants(new Set((tools.grants || []).map(String)));
        setConnectorMessage({ type: 'ok', text: 'Connector action access saved. Changes apply immediately.' });
      })
      .catch((e) => setConnectorMessage({ type: 'error', text: e.message }))
      .finally(() => setConnectorSaving(false));
  };

  const toggleMcpTool = (serverId, toolName) => {
    const key = `${serverId}\u0000${toolName}`;
    setMcpToolGrants((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setMcpMessage(null);
  };

  const saveMcpTools = () => {
    setMcpSaving(true);
    setMcpMessage(null);
    const grants = [...mcpToolGrants].map((key) => {
      const [server_id, tool_name] = key.split('\u0000');
      return { server_id, tool_name };
    });
    api.agentMcpToolsSet(agentId, grants)
      .then((r) => {
        setMcpServers(r.servers || []);
        setMcpToolGrants(new Set((r.grants || []).map((item) => `${item.server_id}\u0000${item.tool_name}`)));
        setMcpMessage({ type: 'ok', text: 'MCP tool access saved. The tenant agent runtime is updated immediately.' });
      })
      .catch((e) => setMcpMessage({ type: 'error', text: e.message }))
      .finally(() => setMcpSaving(false));
  };

  const toggleSkill = (skillId) => {
    setSkillAssignments((previous) => {
      const next = new Set(previous);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
    setSkillsMessage(null);
  };

  const saveSkills = () => {
    setSkillsSaving(true);
    setSkillsMessage(null);
    const assignments = [...skillAssignments].map((skillId, index) => ({
      skill_id: skillId,
      version_id: skillCatalog.find((item) => item.id === skillId)?.version_id || null,
      priority: 100 + index,
      auto_select: true,
    }));
    api.agentSkillsSet(agentId, assignments)
      .then((r) => {
        setSkillAssignmentRows(r.assignments || []);
        setSkillAssignments(new Set((r.assignments || []).map((item) => item.skill_id)));
        setSkillsMessage({ type: 'ok', text: 'Skills assigned and synchronized to this employee’s tenant workspace.' });
      })
      .catch((e) => setSkillsMessage({ type: 'error', text: e.message }))
      .finally(() => setSkillsSaving(false));
  };

  const createSkill = () => {
    setSkillsSaving(true);
    setSkillsMessage(null);
    api.agentSkillCreate({
      ...skillDraft,
      trigger_hints: skillDraft.trigger_hints.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
      required_tools: skillDraft.required_tools.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
      required_connector_actions: skillDraft.required_connector_actions.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
    })
      .then(async (created) => {
        await refreshSkills();
        setSkillAssignments((previous) => new Set([...previous, created.id]));
        setSkillsMessage({ type: 'ok', text: `Created ${created.name}. Select it and save assignments.` });
        setShowSkillCreate(false);
        setSkillDraft(emptySkillDraft);
      })
      .catch((e) => setSkillsMessage({ type: 'error', text: e.message }))
      .finally(() => setSkillsSaving(false));
  };

  const editSkillVersion = async (skill) => {
    setSkillsMessage(null);
    try {
      const result = await api.agentSkillsCatalog(true);
      const current = (result.skills || []).find((item) => item.id === skill.id);
      if (!current) throw new Error('Skill version could not be loaded');
      setEditingSkillId(skill.id);
      setShowSkillCreate(false);
      setSkillDraft({
        name: current.name || '',
        description: current.description || '',
        trigger_hints: (current.trigger_hints || []).join(', '),
        required_tools: (current.required_tools || []).join(', '),
        required_connector_actions: (current.required_connector_actions || []).join(', '),
        skill_md: current.skill_md || '',
      });
    } catch (e) {
      setSkillsMessage({ type: 'error', text: e.message });
    }
  };

  const saveSkillVersion = () => {
    setSkillsSaving(true);
    setSkillsMessage(null);
    api.agentSkillAddVersion(editingSkillId, {
      description: skillDraft.description,
      skill_md: skillDraft.skill_md,
      trigger_hints: skillDraft.trigger_hints.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
      required_tools: skillDraft.required_tools.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
      required_connector_actions: skillDraft.required_connector_actions.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
    })
      .then(async (updated) => {
        await refreshSkills();
        setEditingSkillId(null);
        setSkillDraft(emptySkillDraft);
        setSkillsMessage({ type: 'ok', text: `${updated.name} version ${updated.version} created. Save assignments to pin the employee to it.` });
      })
      .catch((e) => setSkillsMessage({ type: 'error', text: e.message }))
      .finally(() => setSkillsSaving(false));
  };

  const syncTemplateMd = () => {
    setSyncingMd(true);
    setError(null);
    api.agentToolsSyncTemplateMd(agentId)
      .then(() => {
        if (selected === 'tools') {
          return api.agentWorkspaceRead(agentId, 'tools').then((r) => setContent(r.text ?? ''));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setSyncingMd(false));
  };

  const saveOrg = () => {
    setOrgSaving(true);
    setOrgMessage(null);
    const department = String(orgDept || '').trim();
    api
      .agentUpdate(agentId, {
        department,
        parent_id: orgParentId || null,
        is_orchestrator: !!isOrchestrator,
      })
      .then((updated) => {
        setAgent(updated);
        setOrgMessage('Org settings saved.');
        setTimeout(() => setOrgMessage(null), 4000);
      })
      .catch((e) => setError(e.message))
      .finally(() => setOrgSaving(false));
  };

  const saveAvatar = (avatar_image) => {
    setAvatarSaving(true);
    api
      .agentUpdate(agentId, {
        avatar_image: avatar_image || '',
        clear_avatar_image: !avatar_image,
      })
      .then((updated) => setAgent(updated))
      .catch((e) => setError(e.message))
      .finally(() => setAvatarSaving(false));
  };

  if (error && !agent) return <div style={{ padding: '2rem', color: '#f87171' }}>Error: {error}. <Link to="/">Dashboard</Link></div>;

  const tabs = [...(files.files || []).map((f) => f.name), ...(files.daily || []).map((f) => `memory/${f.name}`)];
  const activeTabs = tabs.length ? tabs : FILE_NAMES;
  const showToolsPanel = selected === TOOLS_TAB;
  const showSkillsPanel = selected === SKILLS_TAB;

  return (
    <div style={{ padding: '2rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/org" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>← My Org</Link>
        <Link to="/workspace" style={{ color: 'var(--muted)', fontSize: '0.9rem', marginLeft: '1rem' }}>All agents</Link>
        <Link to={`/agents/${agentId}/channels`} style={{ color: 'var(--accent)', fontSize: '0.9rem', marginLeft: '1rem' }}>Channels</Link>
        <Link to={`/agents/${agentId}/chat`} style={{ color: 'var(--muted)', fontSize: '0.9rem', marginLeft: '1rem' }}>Chat</Link>
      </div>
      <h1 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <RobotAvatar src={agent?.avatar_image} name={agent?.name || agentId} size={44} />
        <span>Workspace — {agent?.name || agentId}</span>
      </h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Edit identity and policy docs and manage which platform tools this AI employee can invoke. MD saves write to the AgentSystem workspace and apply on the next message. Tool access changes apply immediately without restart.
        {workspaceRoot && (
          <>
            {' '}
            <span title={workspaceRoot}>Workspace: <code style={{ fontSize: '0.85rem' }}>{workspaceRoot}</code></span>
          </>
        )}
        {agent && !agent.workspace_path && !workspaceRoot && ' (Using default workspace; set workspace_path on this agent for a separate folder.)'}
      </p>

      {error && <div style={{ padding: '0.5rem 1rem', background: 'rgba(248,113,113,0.15)', borderRadius: 8, marginBottom: '1rem', color: '#f87171' }}>{error}</div>}

      <section
        style={{
          marginBottom: '1.25rem',
          padding: '1rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Org</h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
          Department and reporting line for the Dashboard org chart. Icon appears in chat and Agent Exchange.
        </p>
        <div style={{ marginBottom: '0.85rem' }}>
          <AgentAvatarPicker
            value={agent?.avatar_image || ''}
            name={agent?.name || ''}
            disabled={avatarSaving}
            onChange={saveAvatar}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-start' }}>
          <DepartmentPicker
            value={orgDept}
            onChange={setOrgDept}
            allowEmpty
            emptyLabel="Unassigned"
            compact
            ariaLabel="Department"
            selectStyle={{ background: 'var(--bg, #121216)' }}
          />
          <select
            value={orgParentId}
            onChange={(e) => setOrgParentId(e.target.value)}
            aria-label="Reports to"
            disabled={!!agent?.is_coo}
            style={{
              padding: '0.5rem 0.75rem',
              background: 'var(--bg, #121216)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              minWidth: 160,
            }}
          >
            <option value="">Reports to (none)</option>
            {allAgents
              .filter((a) => a.id !== agentId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.is_coo ? ' (COO)' : ''}{a.department ? ` · ${a.department}` : ''}
                </option>
              ))}
          </select>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0.45rem 0.7rem',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg, #121216)',
            }}
            title="Orchestrators can create goal plans and delegate only to employees who report to them."
          >
            <input
              type="checkbox"
              checked={isOrchestrator}
              disabled={!!agent?.is_coo}
              onChange={(e) => setIsOrchestrator(e.target.checked)}
            />
            <span>Orchestrator</span>
          </label>
          <button
            type="button"
            onClick={saveOrg}
            disabled={orgSaving}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              cursor: orgSaving ? 'wait' : 'pointer',
            }}
          >
            {orgSaving ? 'Saving…' : 'Save org'}
          </button>
          {orgMessage && <span style={{ color: '#22c55e', fontSize: '0.85rem' }}>{orgMessage}</span>}
        </div>
        <p style={{ margin: '0.65rem 0 0', color: 'var(--muted)', fontSize: '0.82rem' }}>
          Orchestrators can plan goals and delegate to their direct reportees. Org sync writes that scoped team roster into their workspace.
        </p>
        <div style={{ marginTop: '0.85rem' }}>
          <button
            type="button"
            onClick={() => setShowPublish(true)}
            style={{
              padding: '0.5rem 1rem',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            Publish to Agent Exchange
          </button>
        </div>
      </section>

      <section
        style={{
          marginBottom: '1.25rem',
          padding: '1rem',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}
      >
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Workspace templates</h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
          Prepopulate SOUL / AGENTS / MEMORY / TOOLS / IDENTITY / AGENT-OS-OPS from a platform template, then edit.
          Templates are shared platform-wide (not per-CEO).
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <select
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(e.target.value)}
            aria-label="Workspace template"
            style={{
              padding: '0.5rem 0.75rem',
              background: 'var(--bg, #121216)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              minWidth: 220,
            }}
          >
            {wsTemplates.length === 0 && <option value="">No templates</option>}
            {wsTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}{t.is_default ? ' (default)' : ''} · {t.source}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyWorkspaceTemplate}
            disabled={applyingTemplate || !selectedTemplateId}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              cursor: applyingTemplate ? 'wait' : 'pointer',
            }}
          >
            {applyingTemplate ? 'Applying…' : 'Apply template'}
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginTop: '0.75rem' }}>
          <input
            type="text"
            placeholder="New template name (optional)"
            value={publishName}
            onChange={(e) => setPublishName(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem',
              background: 'var(--bg, #121216)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              minWidth: 200,
            }}
          />
          <button
            type="button"
            onClick={publishAsPlatformTemplate}
            disabled={publishingTemplate}
            style={{
              padding: '0.5rem 1rem',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
              cursor: publishingTemplate ? 'wait' : 'pointer',
            }}
          >
            {publishingTemplate ? 'Publishing…' : 'Publish this agent as template'}
          </button>
        </div>
        {templateMessage && (
          <p style={{ color: '#22c55e', fontSize: '0.85rem', margin: '0.75rem 0 0' }}>{templateMessage}</p>
        )}
      </section>

      <section className={`agent-workspace-editor-shell${editorFullscreen ? ' is-fullscreen' : ''}`}>
        <div className="agent-workspace-editor-toolbar">
          <div className="agent-workspace-editor-tabs">
            {activeTabs.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setSelected(name)}
                className={selected === name ? 'is-active' : ''}
              >
                {name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelected(TOOLS_TAB)}
              className={showToolsPanel ? 'is-active' : ''}
            >
              Tool access
            </button>
            <button
              type="button"
              onClick={() => setSelected(SKILLS_TAB)}
              className={showSkillsPanel ? 'is-active' : ''}
            >
              Skills
            </button>
          </div>
          <button
            type="button"
            className="agent-workspace-fullscreen-btn"
            onClick={() => setEditorFullscreen((value) => !value)}
            aria-pressed={editorFullscreen}
            aria-label={editorFullscreen ? 'Exit full screen editor' : 'Open editor full screen'}
            title={editorFullscreen ? 'Restore workspace view (Esc)' : 'Use full screen'}
          >
            <span aria-hidden="true">{editorFullscreen ? '↙' : '↗'}</span>
            {editorFullscreen ? 'Restore' : 'Full screen'}
          </button>
        </div>

        <div className="agent-workspace-editor-content">
        {showSkillsPanel ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Employee skills</h2>
                <p style={{ color: 'var(--muted)', margin: '0.4rem 0 0', maxWidth: 820 }}>
                  Assign reusable <code>SKILL.md</code> operating procedures to this employee. Flolah recommends matching skills for chat and goal work; the employee loads the selected version at execution time. Skills never grant tools or connector actions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setEditingSkillId(null); setSkillDraft(emptySkillDraft); setShowSkillCreate((value) => !value); }}
                style={{ padding: '0.55rem 0.9rem', background: showSkillCreate ? 'transparent' : 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 7, color: showSkillCreate ? 'var(--accent)' : '#fff' }}
              >
                {showSkillCreate ? 'Cancel' : 'Create company skill'}
              </button>
            </div>

            {(showSkillCreate || editingSkillId) && (
              <section style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--accent)', borderRadius: 10, background: 'color-mix(in srgb, var(--accent) 6%, var(--surface))' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>{editingSkillId ? 'Create a new skill version' : 'New company skill'}</h3>
                  {editingSkillId && <button type="button" onClick={() => { setEditingSkillId(null); setSkillDraft(emptySkillDraft); }} style={{ border: 0, background: 'transparent', color: 'var(--muted)' }}>Cancel</button>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                  <label style={{ display: 'grid', gap: 5 }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Name</span>
                    <input value={skillDraft.name} disabled={!!editingSkillId} onChange={(e) => setSkillDraft((value) => ({ ...value, name: e.target.value }))} placeholder="Quarterly account research" style={{ padding: '0.6rem 0.7rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)', opacity: editingSkillId ? 0.7 : 1 }} />
                  </label>
                  <label style={{ display: 'grid', gap: 5 }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>When to recommend it</span>
                    <input value={skillDraft.trigger_hints} onChange={(e) => setSkillDraft((value) => ({ ...value, trigger_hints: e.target.value }))} placeholder="account research, qualify leads" style={{ padding: '0.6rem 0.7rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 5 }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Required tool names (optional)</span>
                    <input value={skillDraft.required_tools} onChange={(e) => setSkillDraft((value) => ({ ...value, required_tools: e.target.value }))} placeholder="brave_web_search" style={{ padding: '0.6rem 0.7rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 5 }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Required connector actions (optional)</span>
                    <input value={skillDraft.required_connector_actions} onChange={(e) => setSkillDraft((value) => ({ ...value, required_connector_actions: e.target.value }))} placeholder="gmail.messages.list" style={{ padding: '0.6rem 0.7rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)' }} />
                  </label>
                </div>
                <label style={{ display: 'grid', gap: 5, marginTop: '0.75rem' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Description</span>
                  <input value={skillDraft.description} onChange={(e) => setSkillDraft((value) => ({ ...value, description: e.target.value }))} placeholder="A concise statement of the outcome and when this procedure applies." style={{ padding: '0.6rem 0.7rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)' }} />
                </label>
                <label style={{ display: 'grid', gap: 5, marginTop: '0.75rem' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>SKILL.md</span>
                  <textarea value={skillDraft.skill_md} onChange={(e) => setSkillDraft((value) => ({ ...value, skill_md: e.target.value }))} spellCheck={false} style={{ minHeight: 230, padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'ui-monospace, monospace', resize: 'vertical' }} />
                </label>
                <button type="button" onClick={editingSkillId ? saveSkillVersion : createSkill} disabled={skillsSaving || !skillDraft.name.trim() || !skillDraft.skill_md.trim()} style={{ marginTop: '0.75rem', padding: '0.55rem 1rem', background: 'var(--accent)', border: 'none', borderRadius: 7, color: '#fff' }}>
                  {skillsSaving ? 'Saving…' : editingSkillId ? 'Create version' : 'Create skill'}
                </button>
              </section>
            )}

            {skillsMessage && <div style={{ marginTop: '0.8rem', padding: '0.65rem 0.8rem', borderRadius: 7, color: skillsMessage.type === 'error' ? '#f87171' : '#22c55e', background: skillsMessage.type === 'error' ? 'rgba(248,113,113,0.1)' : 'rgba(34,197,94,0.1)' }}>{skillsMessage.text}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '0.8rem', marginTop: '1rem' }}>
              {skillCatalog.map((skill) => {
                const selectedSkill = skillAssignments.has(skill.id);
                const assigned = skillAssignmentRows.find((item) => item.skill_id === skill.id);
                const ready = assigned?.ready !== false;
                return (
                  <div key={skill.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.75rem', alignItems: 'start', padding: '0.9rem', border: `1px solid ${selectedSkill ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, background: selectedSkill ? 'color-mix(in srgb, var(--accent) 7%, var(--surface))' : 'var(--surface)' }}>
                    <input aria-label={`Assign ${skill.name}`} type="checkbox" checked={selectedSkill} onChange={() => toggleSkill(skill.id)} style={{ marginTop: 4, cursor: 'pointer' }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong>{skill.name}</strong>
                        <span style={{ padding: '0.08rem 0.42rem', borderRadius: 999, border: '1px solid var(--border)', color: skill.scope === 'platform' ? '#60a5fa' : '#c084fc', fontSize: '0.7rem' }}>{skill.scope === 'platform' ? 'Platform · read-only' : 'Company'}</span>
                        <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>v{skill.version || '—'}</span>
                      </span>
                      <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.84rem', marginTop: 5 }}>{skill.description || 'Reusable operating procedure'}</span>
                      {assigned && !ready && <span style={{ display: 'block', color: '#f59e0b', fontSize: '0.78rem', marginTop: 6 }}>Not execution-ready: {[...(assigned.missing_tools || []), ...(assigned.missing_connector_actions || [])].join(', ') || 'required capability missing'}</span>}
                      {(skill.trigger_hints || []).length > 0 && <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.75rem', marginTop: 6 }}>Use for: {skill.trigger_hints.join(' · ')}</span>}
                      {skill.scope === 'company' && <button type="button" onClick={() => editSkillVersion(skill)} style={{ marginTop: '0.65rem', padding: '0.35rem 0.6rem', border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', color: 'var(--text)', fontSize: '0.78rem' }}>Create new version</button>}
                    </span>
                  </div>
                );
              })}
            </div>
            {skillCatalog.length === 0 && <p style={{ color: 'var(--muted)' }}>No platform or company skills are available.</p>}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={saveSkills} disabled={skillsSaving} style={{ padding: '0.55rem 1rem', background: skillsSaving ? 'var(--muted)' : 'var(--accent)', border: 'none', borderRadius: 7, color: '#fff' }}>
                {skillsSaving ? 'Saving…' : 'Save skill assignments'}
              </button>
              <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>{skillAssignments.size} selected · versions are pinned when saved</span>
            </div>

            <section style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Recent skill execution</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.84rem', margin: '0.35rem 0 0.75rem' }}>Trace of planner, router, and employee skill selections. A recommendation without an employee confirmation is shown separately.</p>
              {skillAuditRows.length === 0 ? <p style={{ color: 'var(--muted)' }}>No skill executions recorded yet.</p> : (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {skillAuditRows.map((row) => (
                    <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', padding: '0.65rem 0.75rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', flexWrap: 'wrap' }}>
                      <span><strong>{(row.skill_refs || []).map((item) => `${item.name || item.skill_id}@v${item.version || '?'}`).join(', ')}</strong><span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.78rem' }}>{row.selected_by} · {row.status}</span></span>
                      <time style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{row.created_at}</time>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : showToolsPanel ? (
          <>
            <p style={{ color: 'var(--muted)', marginTop: 0 }}>
              Grant or revoke content tools for <strong>{agent?.name || agentId}</strong>.
              Changes write to <code>~/.openclaw/agent-tool-allowlists.json</code> and sync <code>openclaw.json</code>.
              Client browser relay tools (<code>browse_*</code>) are optional for custom agents (auto-granted to COO, Workflow Builder, Platform Help, TechResearcher) — enable them so this agent can run free-text
              goals or replay recorded recipes on the CEO&apos;s attached Chrome / managed session.
              {' '}Risk labels come from <Link to="/settings/risk-classifications">Settings → Risk classifications</Link>.
            </p>
            <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem', background: 'var(--surface)' }}>
              {toolCatalog.length === 0 ? (
                <p style={{ color: 'var(--muted)' }}>No content tools registered.</p>
              ) : (
                (() => {
                  const browse = toolCatalog.filter((t) => String(t.name || '').startsWith('browse_'));
                  const other = toolCatalog.filter((t) => !String(t.name || '').startsWith('browse_'));
                  const renderTool = (t) => (
                    <label
                      key={t.name}
                      style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={toolGrants.has(t.name)}
                        onChange={() => toggleTool(t.name)}
                        style={{ marginTop: 4 }}
                      />
                      <span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          <strong>{t.display_name || t.name}</strong>
                          <span title={t.action_family || ''} style={{ color: riskTierColor(t.risk_tier), border: `1px solid ${riskTierColor(t.risk_tier)}`, borderRadius: 999, padding: '0.05rem 0.4rem', fontSize: '0.72rem' }}>{t.risk_tier || 'R2'}</span>
                          {t.mapping_source === 'user_override' && <span style={{ color: 'var(--accent)', fontSize: '0.7rem' }}>override</span>}
                        </span>
                        <code style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--muted)' }}>{t.name}</code>
                        {t.purpose && <div style={{ fontSize: '0.9rem', color: 'var(--muted)', marginTop: 4 }}>{t.purpose}</div>}
                      </span>
                    </label>
                  );
                  return (
                    <>
                      {browse.length > 0 && (
                        <>
                          <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>Client browser session / recipes</h3>
                          <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 0 }}>
                            Grant tools individually: <code>browse_recipe_list</code> lists recipes;
                            <code>browse_recipe_run</code> plays them; <code>browse_task_start</code> is for free-form goals.
                            CEO must have Browser Session ready for client Chrome.
                          </p>
                          {browse.map(renderTool)}
                          <h3 style={{ fontSize: '0.95rem', margin: '1rem 0 0.5rem' }}>Other tools</h3>
                        </>
                      )}
                      {other.map(renderTool)}
                    </>
                  );
                })()
              )}
              <section style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ fontSize: '1rem', margin: 0 }}>Connector action access</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0.35rem 0 0' }}>
                      Select the exact actions this agent may invoke through your connected apps. Action Control policies still decide whether an allowed action is autonomous, approval-required, or prohibited.
                    </p>
                  </div>
                  <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{connectorActionGrants.size} selected</span>
                </div>
                {connectorApps.length === 0 ? (
                  <p style={{ color: 'var(--muted)' }}>No connector apps are available. Connect an app under Settings → Connectors first.</p>
                ) : (
                  <>
                    <div className="connector-action-toolbar" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(180px, 1.4fr)', gap: '0.65rem', margin: '0.85rem 0' }}>
                      <select
                        aria-label="Connector app"
                        value={connectorAppId}
                        onChange={(e) => { setConnectorAppId(e.target.value); setConnectorQuery(''); }}
                        style={{ width: '100%', padding: '0.6rem 0.7rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)' }}
                      >
                        {connectorApps.map((app) => (
                          <option key={app.id} value={app.id}>{app.name || app.id}{app.connected ? ' · connected' : ''}</option>
                        ))}
                      </select>
                      <input
                        aria-label="Search connector actions"
                        type="search"
                        value={connectorQuery}
                        onChange={(e) => setConnectorQuery(e.target.value)}
                        placeholder="Search actions…"
                        style={{ width: '100%', padding: '0.6rem 0.7rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)' }}
                      />
                    </div>
                    {connectorLoading ? (
                      <p style={{ color: 'var(--muted)' }}>Loading actions…</p>
                    ) : connectorActions.length === 0 ? (
                      <p style={{ color: 'var(--muted)' }}>No actions returned for this connector.</p>
                    ) : (
                      <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '0 0.75rem' }}>
                        {connectorActions
                          .filter((action) => {
                            const q = connectorQuery.trim().toLowerCase();
                            return !q || `${action.id} ${action.description || ''}`.toLowerCase().includes(q);
                          })
                          .map((action) => {
                            const tier = action.risk_tier || 'R2';
                            const tierColor = riskTierColor(tier);
                            return (
                              <label key={action.id} style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start', padding: '0.65rem 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                                <input type="checkbox" checked={connectorActionGrants.has(action.id)} onChange={() => toggleConnectorAction(action.id)} style={{ marginTop: 4 }} />
                                <span style={{ minWidth: 0 }}>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                    <strong style={{ overflowWrap: 'anywhere' }}>{action.id}</strong>
                                    <span title={action.action_family || ''} style={{ color: tierColor, border: `1px solid ${tierColor}`, borderRadius: 999, padding: '0.05rem 0.4rem', fontSize: '0.72rem' }}>{tier}</span>
                                    {action.mapping_source === 'user_override' && <span style={{ color: 'var(--accent)', fontSize: '0.7rem' }}>override</span>}
                                  </span>
                                  {action.description && <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.84rem', marginTop: 3 }}>{action.description}</span>}
                                </span>
                              </label>
                            );
                          })}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={saveConnectorActions}
                      disabled={connectorSaving}
                      style={{ marginTop: '0.75rem', padding: '0.55rem 1rem', background: connectorSaving ? 'var(--muted)' : 'var(--accent)', border: 'none', borderRadius: 6, color: '#fff' }}
                    >
                      {connectorSaving ? 'Saving…' : 'Save connector actions'}
                    </button>
                    {connectorMessage && (
                      <span style={{ display: 'block', marginTop: '0.55rem', color: connectorMessage.type === 'error' ? '#f87171' : '#22c55e', fontSize: '0.85rem' }}>{connectorMessage.text}</span>
                    )}
                  </>
                )}
              </section>
              <section style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div>
                    <h3 style={{ fontSize: '1rem', margin: 0 }}>MCP tool access</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--muted)', margin: '0.35rem 0 0' }}>
                      Bind exact tools from healthy MCP servers visible to your company. The agent uses Flolah&apos;s generic MCP bridge; tenant isolation, saved OAuth/auth, server health and Action Control remain enforced.
                    </p>
                  </div>
                  <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>{mcpToolGrants.size} selected</span>
                </div>
                {mcpServers.length === 0 ? (
                  <p style={{ color: 'var(--muted)' }}>No healthy MCP servers are available. Register and connect one under MCP first.</p>
                ) : (
                  <>
                    <select
                      aria-label="MCP server"
                      value={mcpServerId}
                      onChange={(event) => setMcpServerId(event.target.value)}
                      style={{ width: '100%', maxWidth: 440, margin: '0.85rem 0', padding: '0.6rem 0.7rem', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg)', color: 'var(--text)' }}
                    >
                      {mcpServers.map((server) => (
                        <option key={server.id} value={server.id}>{server.name || server.id}{server.is_platform ? ' · platform' : ''}</option>
                      ))}
                    </select>
                    <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '0 0.75rem' }}>
                      {(mcpServers.find((server) => server.id === mcpServerId)?.tools || []).map((tool) => {
                        const key = `${mcpServerId}\u0000${tool.name}`;
                        const tier = tool.risk_tier || 'R2';
                        const tierColor = riskTierColor(tier);
                        return (
                          <label key={tool.name} style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start', padding: '0.65rem 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={mcpToolGrants.has(key)} onChange={() => toggleMcpTool(mcpServerId, tool.name)} style={{ marginTop: 4 }} />
                            <span style={{ minWidth: 0 }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                <strong style={{ overflowWrap: 'anywhere' }}>{tool.name}</strong>
                                <span title={tool.action_family || ''} style={{ color: tierColor, border: `1px solid ${tierColor}`, borderRadius: 999, padding: '0.05rem 0.4rem', fontSize: '0.72rem' }}>{tier}</span>
                                {tool.mapping_source === 'user_override' && <span style={{ color: 'var(--accent)', fontSize: '0.7rem' }}>override</span>}
                              </span>
                              {tool.description && <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.84rem', marginTop: 3 }}>{tool.description}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={saveMcpTools}
                      disabled={mcpSaving}
                      style={{ marginTop: '0.75rem', padding: '0.55rem 1rem', background: mcpSaving ? 'var(--muted)' : 'var(--accent)', border: 'none', borderRadius: 6, color: '#fff' }}
                    >
                      {mcpSaving ? 'Saving…' : 'Save MCP tool access'}
                    </button>
                    {mcpMessage && (
                      <span style={{ display: 'block', marginTop: '0.55rem', color: mcpMessage.type === 'error' ? '#f87171' : '#22c55e', fontSize: '0.85rem' }}>{mcpMessage.text}</span>
                    )}
                  </>
                )}
              </section>
            </div>
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={saveTools}
                disabled={toolsSaving}
                style={{
                  padding: '0.5rem 1.25rem',
                  background: toolsSaving ? 'var(--muted)' : 'var(--accent)',
                  border: 'none',
                  borderRadius: 6,
                  color: '#fff',
                }}
              >
                {toolsSaving ? 'Saving…' : 'Save tool access'}
              </button>
              <button
                type="button"
                onClick={syncTemplateMd}
                disabled={syncingMd}
                title="Copy TOOLS.md from workspace template (e.g. balserve) into this agent's workspace"
                style={{
                  padding: '0.5rem 1.25rem',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text)',
                }}
              >
                {syncingMd ? 'Syncing…' : 'Sync TOOLS.md from template'}
              </button>
            </div>
          </>
        ) : loading ? (
          <div>Loading…</div>
        ) : (
          <>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              style={{
                flex: 1,
                minHeight: 360,
                padding: '1rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text)',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.9rem',
                resize: 'vertical',
              }}
              spellCheck={false}
            />
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                style={{
                  padding: '0.5rem 1.25rem',
                  background: saving ? 'var(--muted)' : 'var(--accent)',
                  border: 'none',
                  borderRadius: 6,
                  color: '#fff',
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={clearSessions}
                disabled={clearingSessions}
                title="Clear AgentSystem session history for this agent"
                style={{
                  padding: '0.5rem 1.25rem',
                  background: clearingSessions ? 'var(--muted)' : 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text)',
                }}
              >
                {clearingSessions ? 'Clearing…' : 'Clear sessions'}
              </button>
            </div>
          </>
        )}
        </div>
      </section>
      {showPublish && agent && (
        <PublishAgentToExchangeModal
          agent={agent}
          onClose={() => setShowPublish(false)}
          onChanged={() => setShowPublish(false)}
        />
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import DepartmentPicker from '../components/DepartmentPicker';

const FILE_NAMES = ['soul', 'agents', 'memory', 'tools', 'ops', 'identity'];
const TOOLS_TAB = '__tool_access__';

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
  const [syncingMd, setSyncingMd] = useState(false);
  const [orgDept, setOrgDept] = useState('');
  const [orgParentId, setOrgParentId] = useState('');
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgMessage, setOrgMessage] = useState(null);
  const [wsTemplates, setWsTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('platform-standard');
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [publishingTemplate, setPublishingTemplate] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [templateMessage, setTemplateMessage] = useState(null);

  const clearSessions = () => {
    if (!window.confirm('Clear all OpenClaw sessions for this agent? Chat and task session history will be reset.')) return;
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
      })
      .catch((e) => setError(e.message));
    api.agentsList()
      .then((list) => setAllAgents(Array.isArray(list) ? list : list?.agents || []))
      .catch(() => setAllAgents([]));
  }, [agentId]);

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
    if (!agentId || !selected || selected === TOOLS_TAB) return;
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
      })
      .then((updated) => {
        setAgent(updated);
        setOrgMessage('Org settings saved.');
        setTimeout(() => setOrgMessage(null), 4000);
      })
      .catch((e) => setError(e.message))
      .finally(() => setOrgSaving(false));
  };

  if (error && !agent) return <div style={{ padding: '2rem', color: '#f87171' }}>Error: {error}. <Link to="/">Dashboard</Link></div>;

  const tabs = [...(files.files || []).map((f) => f.name), ...(files.daily || []).map((f) => `memory/${f.name}`)];
  const activeTabs = tabs.length ? tabs : FILE_NAMES;
  const showToolsPanel = selected === TOOLS_TAB;

  return (
    <div style={{ padding: '2rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/org" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>← My Org</Link>
        <Link to="/workspace" style={{ color: 'var(--muted)', fontSize: '0.9rem', marginLeft: '1rem' }}>All agents</Link>
        <Link to={`/agents/${agentId}/channels`} style={{ color: 'var(--accent)', fontSize: '0.9rem', marginLeft: '1rem' }}>Channels</Link>
        <Link to={`/agents/${agentId}/chat`} style={{ color: 'var(--muted)', fontSize: '0.9rem', marginLeft: '1rem' }}>Chat</Link>
      </div>
      <h1 style={{ marginTop: 0 }}>Workspace — {agent?.name || agentId}</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Edit workspace files and manage which Agent OS tools this agent can invoke. MD file saves write directly to OpenClaw workspace files and are picked up on the next agent message (bootstrap watcher). Tool access changes apply immediately without restart.
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
          Department and reporting line for the Dashboard org chart.
        </p>
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

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {activeTabs.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setSelected(name)}
            style={{
              padding: '0.5rem 1rem',
              background: selected === name ? 'var(--accent)' : 'var(--surface)',
              border: `1px solid ${selected === name ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 6,
              color: selected === name ? '#fff' : 'var(--text)',
            }}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSelected(TOOLS_TAB)}
          style={{
            padding: '0.5rem 1rem',
            background: showToolsPanel ? 'var(--accent)' : 'var(--surface)',
            border: `1px solid ${showToolsPanel ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 6,
            color: showToolsPanel ? '#fff' : 'var(--text)',
          }}
        >
          Tool access
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 400 }}>
        {showToolsPanel ? (
          <>
            <p style={{ color: 'var(--muted)', marginTop: 0 }}>
              Grant or revoke Agent OS content tools for <strong>{agent?.name || agentId}</strong>.
              Changes write to <code>~/.openclaw/agent-tool-allowlists.json</code> and sync <code>openclaw.json</code>.
              Client browser relay tools (<code>browse_*</code>) are optional for custom agents (auto-granted to COO, Workflow Builder, Platform Help, TechResearcher) — enable them so this agent can run free-text
              goals or replay recorded recipes on the CEO&apos;s attached Chrome / managed session.
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
                        <strong>{t.display_name || t.name}</strong>
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
                title="Clear OpenClaw session history for this agent"
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
    </div>
  );
}

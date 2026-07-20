import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowEditorShortcuts } from '../hooks/useWorkflowEditorShortcuts.js';
import { formatLocalDateTime } from '../utils/formatDateTime.js';
import { api } from '../api.js';
import MaskedSecretInput from '../components/MaskedSecretInput.jsx';
import HttpHeadersEditor from '../components/HttpHeadersEditor.jsx';
import BrainMcpToolCallingPanel from '../components/workflow/BrainMcpToolCallingPanel.jsx';
import WorkflowVariablesPanel from '../components/workflow/WorkflowVariablesPanel.jsx';
import {
  workflowNodeTypes,
  PALETTE_ITEMS,
  defaultNodeData,
  graphToFlow,
  flowToGraph,
} from '../components/workflow/WorkflowNodes.jsx';
import { InputOutputPanel, applyCatalogToNewNode } from '../components/workflow/InputOutputPanel.jsx';
import WorkflowAgentChat from '../components/workflow/WorkflowAgentChat.jsx';
import {
  formatNodeStepLabel,
  getSourceOutputKeyOptions,
  getNodeTypeMeta,
  listPriorNodes,
} from '../components/workflow/workflowEditorUtils.js';
import ActionFeedbackBanner from '../components/ActionFeedbackBanner.jsx';
import { useActionFeedback } from '../hooks/useActionFeedback.js';
import { BRAIN_PROVIDER_PRESETS } from '../components/workflow/workflowTaskMeta.js';
import {
  buildWorkflowExportDocument,
  downloadWorkflowJson,
  parseWorkflowImportDocument,
  readJsonFile,
} from '../utils/workflowDefinitionJson.js';
import PublishA2AModal from '../components/workflow/PublishA2AModal.jsx';

function migrateNodeWithCatalog(node, catalog) {
  const entry = catalog?.find((t) => t.type === node.type);
  if (!entry) return node;
  const data = { ...node.data };
  if (!data.inputBindings?.length && entry.inputs?.length) {
    data.inputBindings = entry.inputs.map((inp) => ({
      id: inp.id,
      label: inp.label,
      mode: inp.defaultMode || inp.mode || 'static',
      value: data[inp.id] || '',
      sourceNodeId: data.inputFrom || '',
      sourceOutputKey: 'text',
    }));
  }
  if (!data.outputs?.length && entry.outputs?.length) {
    data.outputs = entry.outputs.map((o) => ({ ...o }));
  }
  if (!data.taskConfig && entry.configFields?.length) {
    data.taskConfig = {};
    for (const f of entry.configFields) {
      data.taskConfig[f.id] = f.default ?? (f.type === 'boolean' ? false : '');
    }
    if (node.type === 'email') data.taskConfig.useEnvSmtp = true;
  }
  return { ...node, data };
}

function PropertiesPanel({ node, agents, tools, mcpServers, mcpLoadError, externalAgents, externalAgentsLoadError, customScripts, customScriptsLoadError, taskCatalog, allNodes, edges, hookInfo, onChange, onDelete, onRegenerateHookSecret, onFetchHookInfo, regeneratingSecret }) {
  const [secretVisible, setSecretVisible] = useState(false);
  if (!node) {
    return (
      <div className="wf-props">
        <h3>Properties</h3>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Select a node to edit its settings.</p>
      </div>
    );
  }

  const data = node.data || {};
  const set = (patch) => onChange(node.id, { ...data, ...patch });
  const typeMeta = getNodeTypeMeta(node.type, taskCatalog);

  return (
    <div className="wf-props">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>{data.label || typeMeta.label}</h3>
        <button type="button" className="wf-btn-danger" onClick={() => onDelete(node.id)}>
          Delete
        </button>
      </div>

      <div className="wf-step-id wf-node-type">
        <span className="wf-step-id-label">Node type</span>
        <div className="wf-node-type-row">
          <span className="wf-node-type-badge" style={{ borderColor: typeMeta.color, color: typeMeta.color }}>
            {typeMeta.label}
          </span>
          <code className="wf-node-type-id">{typeMeta.type}</code>
        </div>
        {typeMeta.description && <small>{typeMeta.description}</small>}
        {typeMeta.handlesHint && <small className="wf-node-type-handles">{typeMeta.handlesHint}</small>}
      </div>

      <div className="wf-step-id">
        <span className="wf-step-id-label">Step ID</span>
        <code className="wf-step-id-value">{node.id}</code>
        <small>Use this ID in IF/While conditions and {'{{nodeId.key}}'} templates</small>
      </div>

      <label className="wf-field">
        Label
        <input value={data.label || ''} onChange={(e) => set({ label: e.target.value })} />
      </label>

      {node.type !== 'trigger' && (
        <label className="wf-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={!!(data.send_notification ?? data.sendNotification)}
            onChange={(e) =>
              set({
                send_notification: e.target.checked,
                sendNotification: e.target.checked,
              })
            }
          />
          <span>
            Send notification
            <small style={{ display: 'block', color: 'var(--muted)', fontWeight: 400 }}>
              Notify the CEO when this step starts and when it completes (link to run audit)
            </small>
          </span>
        </label>
      )}

      {node.type === 'trigger' && (
        <>
          <fieldset className="wf-field">
            <legend>Trigger modes</legend>
            {['manual', 'schedule', 'chat', 'event'].map((mode) => (
              <label key={mode} style={{ display: 'block', marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={(data.triggerModes || []).includes(mode)}
                  onChange={(e) => {
                    const modes = new Set(data.triggerModes || ['manual']);
                    if (e.target.checked) modes.add(mode);
                    else modes.delete(mode);
                    const patch = { triggerModes: [...modes] };
                    if (mode === 'schedule' && !e.target.checked) patch.scheduleCron = '';
                    if (mode === 'chat' && !e.target.checked) patch.chatPhrase = '';
                    set(patch);
                    // Immediately fetch hook info when user enables event mode on a saved workflow
                    if (mode === 'event' && e.target.checked) {
                      onFetchHookInfo?.();
                    }
                  }}
                />{' '}
                {mode === 'event' ? 'event (webhook / SSE hook)' : mode}
              </label>
            ))}
          </fieldset>
          {(data.triggerModes || []).includes('event') && (
            <div className="wf-field wf-hook-info">
              {hookInfo ? (
                <>
                  <strong>Event webhook URL</strong>
                  <code className="wf-hook-url">{hookInfo.hook_url}</code>
                  {hookInfo.email_inbound_url && (
                    <>
                      <strong style={{ display: 'block', marginTop: '0.5rem' }}>Email inbound URL</strong>
                      <code className="wf-hook-url">{hookInfo.email_inbound_url}</code>
                      <small>Same secret — providers POST mail here</small>
                    </>
                  )}
                  <small>POST JSON with header <code>X-Workflow-Hook-Secret</code>. Each event-enabled workflow has its own URL.</small>
                  {hookInfo.webhook_secret ? (
                    <>
                      <strong style={{ display: 'block', marginTop: '0.5rem' }}>Secret</strong>
                      <code className={secretVisible ? '' : 'wf-hook-secret-masked'}>
                        {secretVisible ? hookInfo.webhook_secret : '•'.repeat(Math.min(32, hookInfo.webhook_secret.length || 24))}
                      </code>
                      <div className="wf-hook-secret-actions">
                        <button type="button" className="wf-btn-secondary" onClick={() => setSecretVisible((v) => !v)}>
                          {secretVisible ? 'Hide' : 'Show'}
                        </button>
                        <button
                          type="button"
                          className="wf-btn-secondary"
                          disabled={!!regeneratingSecret}
                          onClick={() => {
                            if (
                              window.confirm(
                                'Regenerate webhook secret? Existing callers with the old secret will stop working.'
                              )
                            ) {
                              onRegenerateHookSecret?.();
                              setSecretVisible(true);
                            }
                          }}
                        >
                          {regeneratingSecret ? 'Regenerating…' : 'Regenerate'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <small style={{ color: 'var(--muted)', display: 'block', marginTop: '0.35rem' }}>
                      Save draft with event mode enabled to generate the webhook secret.
                    </small>
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '0.88rem', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--text)' }}>Event webhook enabled</strong>
                  <div style={{ marginTop: '0.35rem' }}>
                    A unique webhook URL and secret will appear here after you{' '}
                    <strong>Save draft</strong>. The endpoint will be:
                  </div>
                  <code className="wf-hook-url" style={{ marginTop: '0.35rem', opacity: 0.6 }}>
                    {window.location.origin}/api/agent-workflows/hooks/{'{workflow-id}'}
                  </code>
                  <div style={{ marginTop: '0.35rem', fontSize: '0.82rem' }}>
                    Call it via <code>POST</code> with header <code>X-Workflow-Hook-Secret: &lt;secret&gt;</code>
                  </div>
                </div>
              )}
            </div>
          )}
          <label className="wf-field">
            Schedule (cron)
            <input
              placeholder="0 9 * * *"
              value={data.scheduleCron || ''}
              onChange={(e) => set({ scheduleCron: e.target.value })}
            />
            <small>Used when schedule mode is enabled</small>
          </label>
          <label className="wf-field">
            Chat trigger phrase
            <input
              placeholder="run research workflow"
              value={data.chatPhrase || ''}
              onChange={(e) => set({ chatPhrase: e.target.value })}
            />
            <small>Message containing this phrase starts the workflow</small>
          </label>
        </>
      )}

      {node.type === 'agent' && (
        <>
          <label className="wf-field">
            Agent
            <select
              value={data.agentId || ''}
              onChange={(e) => {
                const a = agents.find((x) => x.id === e.target.value);
                set({ agentId: e.target.value, agentName: a?.name || e.target.value });
              }}
            >
              <option value="">— select —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.id})
                </option>
              ))}
            </select>
          </label>
          <label className="wf-field">
            Prompt template
            <textarea
              rows={6}
              value={data.prompt || ''}
              onChange={(e) => set({ prompt: e.target.value })}
              placeholder="Use {{input}} for bound prompt input"
            />
          </label>
        </>
      )}

      {node.type === 'tool' && (
        <>
          <label className="wf-field">
            Content tool
            <select value={data.toolName || ''} onChange={(e) => set({ toolName: e.target.value })}>
              <option value="">— select —</option>
              {tools.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.display_name || t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wf-field">
            Tool payload (JSON)
            <textarea
              rows={5}
              value={JSON.stringify(data.toolPayload || {}, null, 2)}
              onChange={(e) => {
                try {
                  set({ toolPayload: JSON.parse(e.target.value) });
                } catch (_) {}
              }}
            />
          </label>
        </>
      )}

      {node.type === 'api' && (
        <>
          <label className="wf-field">
            HTTP method
            <select
              value={data.taskConfig?.method || 'GET'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, method: e.target.value } })}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="wf-field">
            Authentication
            <select
              value={data.taskConfig?.authType || 'none'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, authType: e.target.value } })}
            >
              <option value="none">None</option>
              <option value="basic">HTTP Basic</option>
              <option value="bearer">Bearer / JWT</option>
              <option value="api_key">API key header</option>
            </select>
            <small>Stored on this node — supports {'{{nodeId.body.token}}'} templates for bearer</small>
          </label>
          {(data.taskConfig?.authType || 'none') === 'basic' && (
            <>
              <label className="wf-field">
                Basic username
                <input
                  value={data.taskConfig?.basicUsername || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, basicUsername: e.target.value } })}
                  placeholder="admin"
                />
              </label>
              <label className="wf-field">
                Basic password
                <MaskedSecretInput
                  value={data.taskConfig?.basicPassword || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, basicPassword: e.target.value } })}
                  placeholder="password"
                />
              </label>
            </>
          )}
          {(data.taskConfig?.authType || 'none') === 'bearer' && (
            <label className="wf-field">
              Bearer token
              <MaskedSecretInput
                value={data.taskConfig?.bearerToken || ''}
                onChange={(e) => set({ taskConfig: { ...data.taskConfig, bearerToken: e.target.value } })}
                placeholder="token or {{api-login.body.token}}"
              />
            </label>
          )}
          {(data.taskConfig?.authType || 'none') === 'api_key' && (
            <>
              <label className="wf-field">
                API key header name
                <input
                  value={data.taskConfig?.apiKeyHeader || 'X-API-Key'}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, apiKeyHeader: e.target.value } })}
                />
              </label>
              <label className="wf-field">
                API key value
                <MaskedSecretInput
                  value={data.taskConfig?.apiKeyValue || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, apiKeyValue: e.target.value } })}
                  placeholder="MySecretKey123"
                />
              </label>
            </>
          )}
          <HttpHeadersEditor
            className="wf-field"
            value={
              data.taskConfig?.httpHeadersJson ||
              data.taskConfig?.http_headers_json ||
              '{}'
            }
            onChange={(httpHeadersJson) => set({ taskConfig: { ...data.taskConfig, httpHeadersJson } })}
          />
          <small className="wf-field-hint">
            Use HTTP Headers for Postman-style auth (e.g. Authorization: Basic …) with Authentication set to None.
          </small>
        </>
      )}

      {node.type === 'externalAgent' && (
        <>
          <label className="wf-field">
            External agent (A2A)
            <select
              value={data.taskConfig?.externalAgentId || ''}
              onChange={(e) => {
                const id = e.target.value;
                const agent = (externalAgents || []).find((a) => a.id === id);
                set({
                  taskConfig: {
                    ...data.taskConfig,
                    externalAgentId: id,
                    externalAgentName: agent?.name || id,
                    skillId: data.taskConfig?.skillId || agent?.skill_id || '',
                  },
                });
              }}
            >
              <option value="">— select —</option>
              {(externalAgents || []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.status !== 'healthy' ? `(${a.status})` : ''}
                </option>
              ))}
            </select>
            {externalAgentsLoadError && (
              <small style={{ color: '#dc2626' }}>{externalAgentsLoadError}</small>
            )}
            {!externalAgentsLoadError && !(externalAgents || []).length && (
              <small>
                No healthy external agents.{' '}
                <a href="/integrations/external-agents" target="_blank" rel="noreferrer">
                  Register one
                </a>
              </small>
            )}
          </label>
          <label className="wf-field">
            Skill ID (optional)
            <input
              value={data.taskConfig?.skillId || ''}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, skillId: e.target.value } })}
              placeholder="From agent card skills"
            />
          </label>
          <label className="wf-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={data.taskConfig?.waitForCompletion !== false}
              onChange={(e) =>
                set({ taskConfig: { ...data.taskConfig, waitForCompletion: e.target.checked } })
              }
            />
            Wait for A2A task completion (poll until done)
          </label>
          <label className="wf-field">
            Timeout (ms)
            <input
              type="number"
              min={5000}
              value={data.taskConfig?.timeoutMs ?? 120000}
              onChange={(e) =>
                set({ taskConfig: { ...data.taskConfig, timeoutMs: Number(e.target.value) || 120000 } })
              }
            />
          </label>
        </>
      )}

      {node.type === 'custom_script' && (
        <>
          <label className="wf-field">
            Custom script
            <select
              value={data.taskConfig?.customScriptId || ''}
              onChange={(e) => {
                const id = e.target.value;
                const script = (customScripts || []).find((s) => s.id === id);
                set({
                  taskConfig: {
                    ...data.taskConfig,
                    customScriptId: id,
                    customScriptName: script?.name || id,
                  },
                });
              }}
            >
              <option value="">— select —</option>
              {(customScripts || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.language})
                </option>
              ))}
            </select>
            {customScriptsLoadError && <small style={{ color: '#dc2626' }}>{customScriptsLoadError}</small>}
            {!customScriptsLoadError && !(customScripts || []).length && (
              <small>
                No approved scripts.{' '}
                <a href="/integrations/custom-scripts" target="_blank" rel="noreferrer">
                  Add one
                </a>
              </small>
            )}
          </label>
        </>
      )}

      {node.type === 'masterdata' && (
        <>
          <label className="wf-field">
            Mode
            <select
              value={data.taskConfig?.mode || 'auto'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, mode: e.target.value } })}
            >
              <option value="auto">Auto (table if table ID set, else RAG)</option>
              <option value="table">Query table</option>
              <option value="rag">RAG documents</option>
            </select>
          </label>
          <label className="wf-field">
            Table ID
            <input
              value={data.taskConfig?.tableId || ''}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, tableId: e.target.value } })}
              placeholder="mdt-… from Master Data"
            />
            <small>
              Manage tables at{' '}
              <a href="/master-data" target="_blank" rel="noreferrer">
                Master Data
              </a>
            </small>
          </label>
          <label className="wf-field">
            Document ID (optional RAG filter)
            <input
              value={data.taskConfig?.documentId || ''}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, documentId: e.target.value } })}
              placeholder="mdd-…"
            />
          </label>
          <label className="wf-field">
            RAG top-K
            <input
              type="number"
              min={1}
              max={20}
              value={data.taskConfig?.topK ?? 5}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, topK: Number(e.target.value) || 5 } })}
            />
          </label>
          <label className="wf-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={data.taskConfig?.summarize !== false}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, summarize: e.target.checked } })}
            />
            LLM summarize RAG hits
          </label>
        </>
      )}

      {node.type === 'filesystem' && (
        <>
          <label className="wf-field">
            Operation
            <select
              value={data.taskConfig?.operation || 'list'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, operation: e.target.value } })}
            >
              <option value="list">List directory</option>
              <option value="exists">Exists</option>
              <option value="stat">Stat</option>
              <option value="read_text">Read text</option>
              <option value="move">Move</option>
            </select>
          </label>
          <label className="wf-field">
            Path
            <input
              value={data.taskConfig?.path || ''}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, path: e.target.value } })}
              placeholder="inbox or absolute path under WORKFLOW_FS_ROOTS"
            />
            <small>
              Use with <strong>schedule</strong> trigger to poll a folder. Paths must be under{' '}
              <code>WORKFLOW_FS_ROOTS</code>.
            </small>
          </label>
          <label className="wf-field">
            Glob (list)
            <input
              value={data.taskConfig?.glob || '*'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, glob: e.target.value } })}
              placeholder="*.txt"
            />
          </label>
          {(data.taskConfig?.operation || 'list') === 'move' && (
            <label className="wf-field">
              Destination
              <input
                value={data.taskConfig?.destination || ''}
                onChange={(e) => set({ taskConfig: { ...data.taskConfig, destination: e.target.value } })}
                placeholder="processed/"
              />
            </label>
          )}
        </>
      )}

      {node.type === 'mcp_tool' && (
        <>
          <label className="wf-field">
            Invoke kind
            <select
              value={data.taskConfig?.mcpInvokeKind || 'tool'}
              onChange={(e) =>
                set({
                  taskConfig: {
                    ...data.taskConfig,
                    mcpInvokeKind: e.target.value,
                    toolName: '',
                    promptName: '',
                    resourceUri: '',
                  },
                })
              }
            >
              <option value="tool">Tool</option>
              <option value="prompt">Prompt</option>
              <option value="resource">Resource</option>
            </select>
          </label>
          <label className="wf-field">
            MCP server
            <select
              value={data.taskConfig?.mcpServerId || ''}
              onChange={(e) =>
                set({
                  taskConfig: {
                    ...data.taskConfig,
                    mcpServerId: e.target.value,
                    toolName: '',
                    promptName: '',
                    resourceUri: '',
                  },
                })
              }
            >
              <option value="">— select —</option>
              {(mcpServers || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.is_shared ? '(platform)' : ''}
                  {s.status !== 'healthy' ? ' (connect first)' : ''}
                </option>
              ))}
            </select>
            <small>
              {mcpLoadError
                ? mcpLoadError
                : (mcpServers || []).length
                  ? 'Healthy MCPs you own or platform-shared (same visibility as MCP registry)'
                  : 'No healthy MCPs available — connect a server in MCP Integrations first'}
            </small>
          </label>
          {(data.taskConfig?.mcpInvokeKind || 'tool') === 'tool' && (
            <label className="wf-field">
              Tool
              <select
                value={data.taskConfig?.toolName || ''}
                onChange={(e) => set({ taskConfig: { ...data.taskConfig, toolName: e.target.value } })}
                disabled={!data.taskConfig?.mcpServerId}
              >
                <option value="">— select —</option>
                {(mcpServers || [])
                  .find((s) => s.id === data.taskConfig?.mcpServerId)
                  ?.tools?.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {(data.taskConfig?.mcpInvokeKind || 'tool') === 'prompt' && (
            <label className="wf-field">
              Prompt
              <select
                value={data.taskConfig?.promptName || ''}
                onChange={(e) => set({ taskConfig: { ...data.taskConfig, promptName: e.target.value } })}
                disabled={!data.taskConfig?.mcpServerId}
              >
                <option value="">— select —</option>
                {(mcpServers || [])
                  .find((s) => s.id === data.taskConfig?.mcpServerId)
                  ?.prompts?.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {(data.taskConfig?.mcpInvokeKind || 'tool') === 'resource' && (
            <label className="wf-field">
              Resource URI
              <select
                value={data.taskConfig?.resourceUri || ''}
                onChange={(e) => set({ taskConfig: { ...data.taskConfig, resourceUri: e.target.value } })}
                disabled={!data.taskConfig?.mcpServerId}
              >
                <option value="">— select —</option>
                {(mcpServers || [])
                  .find((s) => s.id === data.taskConfig?.mcpServerId)
                  ?.resources?.map((r) => (
                    <option key={r.uri} value={r.uri}>
                      {r.name || r.uri}
                    </option>
                  ))}
              </select>
              <small>Or bind URI from a prior step via input binding.</small>
            </label>
          )}
          {((data.taskConfig?.mcpInvokeKind || 'tool') === 'tool' ||
            (data.taskConfig?.mcpInvokeKind || 'tool') === 'prompt') && (
            <label className="wf-field">
              Static arguments (JSON)
              <textarea
                rows={4}
                value={data.taskConfig?.staticArguments || '{}'}
                onChange={(e) => set({ taskConfig: { ...data.taskConfig, staticArguments: e.target.value } })}
              />
            </label>
          )}
          <HttpHeadersEditor
            className="wf-field"
            value={
              data.taskConfig?.httpHeadersJson ||
              data.taskConfig?.authHeadersJson ||
              data.taskConfig?.http_headers_json ||
              '{}'
            }
            onChange={(httpHeadersJson) =>
              set({ taskConfig: { ...data.taskConfig, httpHeadersJson, authHeadersJson: httpHeadersJson } })
            }
          />
          <small className="wf-field-hint">Auth headers for MCP transport — saved on this workflow node only.</small>
        </>
      )}

      {(node.type === 'sse_listen' || node.type === 'mcp_listen') && (
        <>
          <label className="wf-field">
            SSE stream URL
            <input
              value={data.taskConfig?.streamUrl || ''}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, streamUrl: e.target.value } })}
              placeholder="https://your-mcp.example.com/events/stream"
            />
            <small>Full URL, or leave blank and select MCP server + path below</small>
          </label>
          <label className="wf-field">
            MCP server (optional)
            <select
              value={data.taskConfig?.mcpServerId || ''}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, mcpServerId: e.target.value } })}
            >
              <option value="">— none / use stream URL —</option>
              {(mcpServers || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wf-field">
            Events path (with MCP server)
            <input
              value={data.taskConfig?.eventsPath || '/events/stream'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, eventsPath: e.target.value } })}
            />
          </label>
          <HttpHeadersEditor
            className="wf-field"
            value={data.taskConfig?.httpHeadersJson || '{}'}
            onChange={(httpHeadersJson) => set({ taskConfig: { ...data.taskConfig, httpHeadersJson } })}
          />
          <small className="wf-field-hint">
            Long-running listen — run stays active until stream ends or you stop listen on the Runs page. Wire IF → Parallel → Sub-workflow / API downstream.
          </small>
        </>
      )}

      {node.type === 'sub_workflow' && (
        <>
          <label className="wf-field">
            Target workflow ID
            <input
              value={data.taskConfig?.targetWorkflowId || ''}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, targetWorkflowId: e.target.value } })}
              placeholder="test-sse-odd"
            />
          </label>
          <label className="wf-field">
            Trigger as
            <select
              value={data.taskConfig?.triggerMode || 'manual'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, triggerMode: e.target.value } })}
            >
              <option value="manual">manual</option>
              <option value="event">event (webhook)</option>
              <option value="chat">chat</option>
            </select>
            <small>Target workflow must have this trigger mode enabled and be published</small>
          </label>
          <label className="wf-field">
            Input template (JSON)
            <textarea
              rows={4}
              value={data.taskConfig?.inputTemplate || '{{event}}'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, inputTemplate: e.target.value } })}
              placeholder='{"parent_run":"{{listen-1.event_count}}","payload":{{event}}}'
            />
          </label>
          <label className="wf-field">
            <input
              type="checkbox"
              checked={!!data.taskConfig?.waitForCompletion}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, waitForCompletion: e.target.checked } })}
            />{' '}
            Wait for child workflow to finish
          </label>
        </>
      )}

      {(node.type === 'brain' || node.type === 'if' || node.type === 'while' || node.type === 'ceo_approval') && (
        <>
          {(node.type === 'if' || node.type === 'while') && (
            <>
              <label className="wf-field">
                Source step
                <select
                  value={data.taskConfig?.sourceNodeId || ''}
                  onChange={(e) => {
                    const sourceNodeId = e.target.value;
                    const sourceNode = allNodes.find((n) => n.id === sourceNodeId);
                    const keys = getSourceOutputKeyOptions(sourceNode, taskCatalog).map((o) => o.value);
                    const patch = { sourceNodeId };
                    const currentKey = data.taskConfig?.sourceOutputKey || 'text';
                    if (keys.length && !keys.includes(currentKey)) {
                      patch.sourceOutputKey = keys.includes('text') ? 'text' : keys[0];
                    }
                    set({ taskConfig: { ...data.taskConfig, ...patch } });
                  }}
                >
                  <option value="">— select step —</option>
                  {listPriorNodes(allNodes, node.id).map((n) => (
                    <option key={n.id} value={n.id}>
                      {formatNodeStepLabel(n)}
                    </option>
                  ))}
                </select>
                <small>Step ID is shown on each canvas node and in this list</small>
              </label>
              <label className="wf-field">
                Output key
                {(() => {
                  const sourceNode = allNodes.find((n) => n.id === data.taskConfig?.sourceNodeId);
                  const options = getSourceOutputKeyOptions(sourceNode, taskCatalog);
                  const currentKey = data.taskConfig?.sourceOutputKey || 'text';
                  if (!options.length) {
                    return (
                      <input
                        value={currentKey}
                        onChange={(e) =>
                          set({ taskConfig: { ...data.taskConfig, sourceOutputKey: e.target.value } })
                        }
                        placeholder="e.g. text, decision, comment"
                      />
                    );
                  }
                  const hasCurrent = options.some((o) => o.value === currentKey);
                  const displayOptions =
                    hasCurrent || !currentKey
                      ? options
                      : [...options, { value: currentKey, label: `${currentKey} (saved)` }];
                  return (
                    <select
                      value={currentKey}
                      onChange={(e) =>
                        set({ taskConfig: { ...data.taskConfig, sourceOutputKey: e.target.value } })
                      }
                    >
                      {displayOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </label>
              <label className="wf-field">
                Operator
                <select
                  value={data.taskConfig?.operator || 'contains'}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, operator: e.target.value } })}
                >
                  {['eq', 'ne', 'contains', 'not_contains', 'gt', 'lt', 'empty', 'not_empty', 'approved', 'rejected'].map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wf-field">
                Compare value
                <input
                  value={data.taskConfig?.compareValue || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, compareValue: e.target.value } })}
                />
              </label>
              {node.type === 'while' && (
                <label className="wf-field">
                  Max iterations
                  <input
                    type="number"
                    value={data.taskConfig?.maxIterations ?? 10}
                    onChange={(e) =>
                      set({ taskConfig: { ...data.taskConfig, maxIterations: Number(e.target.value) || 10 } })
                    }
                  />
                </label>
              )}
            </>
          )}
          {node.type === 'brain' && (
            <>
              <label className="wf-field">
                Model source
                <select
                  value={data.taskConfig?.modelSource || 'openai'}
                  onChange={(e) => {
                    const modelSource = e.target.value;
                    const preset = BRAIN_PROVIDER_PRESETS[modelSource] || {};
                    set({
                      taskConfig: {
                        ...data.taskConfig,
                        modelSource,
                        apiEndpoint: preset.apiEndpoint || data.taskConfig?.apiEndpoint || '',
                        model: preset.model || data.taskConfig?.model || '',
                        ...(modelSource === 'openrouter'
                          ? {
                              httpReferer: preset.httpReferer ?? data.taskConfig?.httpReferer ?? '',
                              siteTitle: preset.siteTitle ?? data.taskConfig?.siteTitle ?? 'Agent OS',
                            }
                          : {}),
                      },
                    });
                  }}
                >
                  {Object.entries(BRAIN_PROVIDER_PRESETS).map(([id, preset]) => (
                    <option key={id} value={id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wf-field">
                API endpoint
                <input
                  value={data.taskConfig?.apiEndpoint || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, apiEndpoint: e.target.value } })}
                  placeholder={
                    BRAIN_PROVIDER_PRESETS[data.taskConfig?.modelSource || 'openai']?.apiEndpoint ||
                    'https://api.openai.com/v1'
                  }
                />
                <small>Base URL only (no /chat/completions). OpenRouter: https://openrouter.ai/api/v1</small>
              </label>
              <label className="wf-field">
                API key (required on Brain node)
                <MaskedSecretInput
                  value={data.taskConfig?.apiKey || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, apiKey: e.target.value } })}
                  placeholder={
                    (data.taskConfig?.modelSource || 'openai') === 'ollama'
                      ? 'optional for local Ollama'
                      : (data.taskConfig?.modelSource || 'openai') === 'deepseek'
                        ? 'optional for platform DeepSeek proxy'
                        : 'sk-... (not read from platform .env)'
                  }
                />
                {(data.taskConfig?.modelSource || 'openai') !== 'ollama' &&
                  (data.taskConfig?.modelSource || 'openai') !== 'deepseek' && (
                  <small>Workflow Brain nodes never use platform OPENAI_API_KEY / OPENROUTER_API_KEY from .env</small>
                )}
                {(data.taskConfig?.modelSource || 'openai') === 'deepseek' && (
                  <small>Use http://deepseek:8080/v1 (Docker) — proxy adds DEEPSEEK_API_KEY. Or api.deepseek.com/v1 with your key.</small>
                )}
              </label>
              <label className="wf-field">
                Model name
                <input
                  value={data.taskConfig?.model || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, model: e.target.value } })}
                  placeholder={
                    BRAIN_PROVIDER_PRESETS[data.taskConfig?.modelSource || 'openai']?.model || 'gpt-4o-mini'
                  }
                />
                {(data.taskConfig?.modelSource || 'openai') === 'openrouter' && (
                  <small>Use OpenRouter slugs, e.g. openai/gpt-4o-mini, anthropic/claude-sonnet-4</small>
                )}
              </label>
              {(data.taskConfig?.modelSource || 'openai') === 'openrouter' && (
                <>
                  <label className="wf-field">
                    HTTP-Referer (OpenRouter)
                    <input
                      value={data.taskConfig?.httpReferer || ''}
                      onChange={(e) => set({ taskConfig: { ...data.taskConfig, httpReferer: e.target.value } })}
                      placeholder="https://your-app.example.com or OPENROUTER_HTTP_REFERER"
                    />
                  </label>
                  <label className="wf-field">
                    X-Title (OpenRouter)
                    <input
                      value={data.taskConfig?.siteTitle || ''}
                      onChange={(e) => set({ taskConfig: { ...data.taskConfig, siteTitle: e.target.value } })}
                      placeholder="Agent OS or OPENROUTER_SITE_TITLE"
                    />
                  </label>
                </>
              )}
              <label className="wf-field">
                Max tokens
                <input
                  type="number"
                  value={data.taskConfig?.maxTokens ?? 1024}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, maxTokens: Number(e.target.value) } })}
                />
              </label>
              <label className="wf-field">
                System prompt
                <textarea
                  rows={6}
                  value={data.taskConfig?.systemPrompt || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, systemPrompt: e.target.value } })}
                  placeholder="Use {{input}} or {{nodeId.text}} bind variables"
                />
              </label>

              <BrainMcpToolCallingPanel
                taskConfig={data.taskConfig || {}}
                mcpServers={mcpServers}
                mcpLoadError={mcpLoadError}
                onTaskConfigChange={(taskConfig) => set({ taskConfig })}
              />

              <fieldset className="wf-field" style={{ marginTop: '0.75rem' }}>
                <legend>Custom script (optional)</legend>
                <label className="wf-field">
                  Mode
                  <select
                    value={data.taskConfig?.customScriptMode || 'off'}
                    onChange={(e) => set({ taskConfig: { ...data.taskConfig, customScriptMode: e.target.value } })}
                  >
                    <option value="off">Off</option>
                    <option value="fallback">Fallback if LLM fails</option>
                    <option value="post">Post-process LLM output</option>
                    <option value="only">Script only (skip LLM)</option>
                  </select>
                </label>
                {(data.taskConfig?.customScriptMode || 'off') !== 'off' && (
                  <label className="wf-field">
                    Script
                    <select
                      value={data.taskConfig?.customScriptId || ''}
                      onChange={(e) => set({ taskConfig: { ...data.taskConfig, customScriptId: e.target.value } })}
                    >
                      <option value="">— select —</option>
                      {(customScripts || []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.language})
                        </option>
                      ))}
                    </select>
                    {customScriptsLoadError && <small style={{ color: '#dc2626' }}>{customScriptsLoadError}</small>}
                  </label>
                )}
              </fieldset>
            </>
          )}
          {node.type === 'ceo_approval' && (
            <>
              <label className="wf-field">
                Kanban title
                <input
                  value={data.taskConfig?.title || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, title: e.target.value } })}
                />
              </label>
              <label className="wf-field">
                Instructions for CEO
                <textarea
                  rows={4}
                  value={data.taskConfig?.instructions || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, instructions: e.target.value } })}
                />
              </label>
            </>
          )}
        </>
      )}

      <InputOutputPanel
        node={node}
        taskCatalog={taskCatalog}
        allNodes={allNodes}
        edges={edges}
        onChange={(patch) => onChange(node.id, { ...data, ...patch })}
      />
    </div>
  );
}

function EditorInner({ workflowId }) {
  const navigate = useNavigate();
  const { setCenter, getZoom } = useReactFlow();
  const [workflow, setWorkflow] = useState(null);
  const [agents, setAgents] = useState([]);
  const [tools, setTools] = useState([]);
  const [hookInfo, setHookInfo] = useState(null);
  const [regeneratingSecret, setRegeneratingSecret] = useState(false);
  const [audit, setAudit] = useState([]);
  const [saving, setSaving] = useState(false);
  const [inlineStatus, setInlineStatus] = useState(null);
  const importFileRef = useRef(null);
  const [variablesPanelKey, setVariablesPanelKey] = useState(0);
  const { feedback, showSuccess, showError, clearFeedback } = useActionFeedback();
  const [selectedId, setSelectedId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [taskCatalog, setTaskCatalog] = useState([]);
  const [mcpServers, setMcpServers] = useState([]);
  const [mcpLoadError, setMcpLoadError] = useState(null);
  const [externalAgents, setExternalAgents] = useState([]);
  const [externalAgentsLoadError, setExternalAgentsLoadError] = useState(null);
  const [customScripts, setCustomScripts] = useState([]);
  const [customScriptsLoadError, setCustomScriptsLoadError] = useState(null);
  const [runInput, setRunInput] = useState('');
  const [a2aPublication, setA2aPublication] = useState(null);
  const [a2aModalOpen, setA2aModalOpen] = useState(false);

  const loadMcpServers = useCallback(() => {
    return api
      .mcpServersList({ forWorkflow: true })
      .then((mcpRes) => {
        setMcpServers(
          (mcpRes.servers || []).map((s) => ({
            ...s,
            tools: s.tools || [],
            prompts: s.prompts || [],
            resources: s.resources || [],
          }))
        );
        setMcpLoadError(null);
      })
      .catch((e) => {
        setMcpServers([]);
        setMcpLoadError(e.message || 'Failed to load MCP servers');
      });
  }, []);

  const loadExternalAgents = useCallback(() => {
    return api
      .externalAgentsList({ forWorkflow: true })
      .then((res) => {
        setExternalAgents(res.agents || []);
        setExternalAgentsLoadError(null);
      })
      .catch((e) => {
        setExternalAgents([]);
        setExternalAgentsLoadError(e.message || 'Failed to load external agents');
      });
  }, []);

  const loadCustomScripts = useCallback(() => {
    return api
      .customScriptsList({ forWorkflow: true })
      .then((res) => {
        setCustomScripts(res.scripts || []);
        setCustomScriptsLoadError(null);
      })
      .catch((e) => {
        setCustomScripts([]);
        setCustomScriptsLoadError(e.message || 'Failed to load custom scripts');
      });
  }, []);

  const initial = useMemo(() => graphToFlow(workflow?.draft_graph), [workflow?.id]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

  const createPastedNode = useCallback(
    (src, id, position) => {
      const node = migrateNodeWithCatalog(
        { ...structuredClone(src), id, position, selected: true },
        taskCatalog
      );
      return node;
    },
    [taskCatalog]
  );

  const { pushHistory, seedHistory } = useWorkflowEditorShortcuts({
    nodes,
    edges,
    setNodes,
    setEdges,
    selectedNodeId: selectedId,
    selectedEdgeId,
    setSelectedNodeId: setSelectedId,
    setSelectedEdgeId,
    createPastedNode,
  });

  const displayNodes = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [nodes, selectedId]
  );
  const displayEdges = useMemo(
    () => edges.map((e) => ({ ...e, selected: e.id === selectedEdgeId })),
    [edges, selectedEdgeId]
  );

  const loadA2aPublication = useCallback(() => {
    if (!workflowId) return Promise.resolve(null);
    return api
      .agentWorkflowA2APublication(workflowId)
      .then((pub) => {
        setA2aPublication(pub);
        return pub;
      })
      .catch(() => {
        setA2aPublication(null);
        return null;
      });
  }, [workflowId]);

  const load = useCallback(() => {
    if (!workflowId) return;
    Promise.all([
      api.agentWorkflowGet(workflowId),
      api.agentsList(),
      api.contentToolsMeta(),
      api.agentWorkflowAudit(workflowId),
      api.agentWorkflowTaskTypes(),
      loadMcpServers(),
      loadExternalAgents(),
    ])
      .then(async ([wf, agentList, toolMeta, auditRes, catalogRes]) => {
        const catalog = catalogRes.task_types || [];
        setTaskCatalog(catalog);
        setWorkflow(wf);
        setAgents(agentList || []);
        setTools((toolMeta?.tools || []).filter((t) => t.enabled !== 0 && t.enabled !== false));
        setAudit(auditRes.audit || []);
        const flow = graphToFlow(wf.draft_graph);
        setNodes(flow.nodes.map((n) => migrateNodeWithCatalog(n, catalog)));
        setEdges(flow.edges);
        setSelectedId(null);
        setSelectedEdgeId(null);
        setTimeout(() => seedHistory(), 0);
        if ((wf.trigger_modes || []).includes('event')) {
          api.agentWorkflowHookInfo(workflowId).then(setHookInfo).catch(() => setHookInfo(null));
        }
        if (wf.status === 'published') {
          await loadA2aPublication();
        } else {
          setA2aPublication(null);
        }
      })
      .catch((e) => showError(e.message || 'Failed to load workflow'));
  }, [workflowId, setNodes, setEdges, showError, loadMcpServers, loadExternalAgents, seedHistory, loadA2aPublication]);

  useEffect(() => {
    load();
  }, [load]);

  const onConnect = useCallback(
    (params) => {
      pushHistory();
      setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: 'var(--accent)' } }, eds));
    },
    [setEdges, pushHistory]
  );

  const selectedNode = nodes.find((n) => n.id === selectedId);

  useEffect(() => {
    if (selectedNode?.type === 'mcp_tool' || selectedNode?.type === 'mcp_listen' || selectedNode?.type === 'sse_listen' || selectedNode?.type === 'brain') loadMcpServers();
    if (selectedNode?.type === 'externalAgent') loadExternalAgents();
    if (selectedNode?.type === 'custom_script' || selectedNode?.type === 'brain') loadCustomScripts();
  }, [selectedNode?.id, selectedNode?.type, loadMcpServers, loadExternalAgents, loadCustomScripts]);

  const refreshHookInfo = useCallback(async (wf) => {
    // Prefer trigger_modes from the saved workflow object; fall back to canvas trigger node.
    const modesFromWf = Array.isArray(wf?.trigger_modes) ? wf.trigger_modes : (typeof wf?.trigger_modes === 'string' ? wf.trigger_modes.split(',').map((s) => s.trim()).filter(Boolean) : null);
    const modesFromCanvas = nodes.find((n) => n.type === 'trigger')?.data?.triggerModes || [];
    const modes = modesFromWf ?? modesFromCanvas;
    if (!modes.includes('event')) {
      setHookInfo(null);
      return;
    }
    try {
      const info = await api.agentWorkflowHookInfo(workflowId);
      setHookInfo(info);
    } catch {
      setHookInfo(null);
    }
  }, [workflowId, nodes]);

  const regenerateHookSecret = useCallback(async () => {
    setRegeneratingSecret(true);
    try {
      const info = await api.agentWorkflowHookRegenerateSecret(workflowId);
      setHookInfo(info);
      showSuccess('Webhook secret regenerated');
    } catch (e) {
      showError(e.message || 'Failed to regenerate secret');
    } finally {
      setRegeneratingSecret(false);
    }
  }, [workflowId, showSuccess, showError]);

  const updateNodeData = (nodeId, data) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data } : n)));
  };

  const deleteNode = (nodeId) => {
    pushHistory();
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedId(null);
    setSelectedEdgeId(null);
  };

  const applyAgentGraph = useCallback(
    (draftGraph, meta) => {
      if (!draftGraph) return;
      const flow = graphToFlow(draftGraph);
      setNodes(flow.nodes.map((n) => migrateNodeWithCatalog(n, taskCatalog)));
      setEdges(flow.edges);
      setSelectedId(null);
      setSelectedEdgeId(null);
      setTimeout(() => seedHistory(), 0);
      if (meta) {
        setWorkflow((w) => (w ? { ...w, ...meta } : w));
      }
    },
    [taskCatalog, setNodes, setEdges, seedHistory]
  );

  const onAgentWorkflowCreated = useCallback(
    (newId) => {
      if (newId && newId !== workflowId) {
        navigate(`/workflows/${newId}/edit`, { replace: true });
      } else {
        load();
      }
    },
    [workflowId, navigate, load]
  );

  const handleAgentEffects = useCallback(
    async (effects) => {
      if (effects.toast) showSuccess(effects.toast);

      if (effects.workflowDeleted) return;

      if (effects.runInspected?.runNumber) {
        showSuccess(`Inspected run #${effects.runInspected.runNumber}`);
      }

      if (effects.shouldReloadWorkflow) {
        load();
        return;
      }

      if (effects.shouldRefreshAudit && workflowId) {
        try {
          const auditRes = await api.agentWorkflowAudit(workflowId);
          setAudit(auditRes.audit || []);
        } catch {
          /* ignore */
        }
      }

      if (effects.lifecycleChanged && workflow) {
        const pub = effects.actions.some((a) => a.action === 'publish');
        const unpub = effects.actions.some((a) =>
          ['unpublish', 'revert_to_draft', 'unpublish_workflow'].includes(a.action)
        );
        if (pub || unpub) {
          await refreshHookInfo(workflow);
        }
      }
    },
    [workflowId, workflow, load, showSuccess, refreshHookInfo]
  );

  const onDragStart = (event, item) => {
    event.dataTransfer.setData('application/workflow-node', JSON.stringify({ type: item.type }));
    event.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (event) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('application/workflow-node');
    const agentRaw = event.dataTransfer.getData('application/workflow-agent');
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = { x: event.clientX - bounds.left - 80, y: event.clientY - bounds.top - 20 };

    if (agentRaw) {
      const agent = JSON.parse(agentRaw);
      const entry = taskCatalog.find((t) => t.type === 'agent');
      const node = applyCatalogToNewNode('agent', entry, position);
      node.data.agentId = agent.id;
      node.data.agentName = agent.name;
      node.data.label = agent.name;
      node.data.prompt =
        'Write an email body with a warm greeting and a bullet list of job opportunities you discovered. Plain text only, ready to send.\n\n{{input}}';
      pushHistory();
      setNodes((nds) => [...nds, node]);
      setSelectedId(node.id);
      setSelectedEdgeId(null);
      return;
    }

    if (!raw) return;
    const { type } = JSON.parse(raw);
    const entry = taskCatalog.find((t) => t.type === type);
    const node = entry ? applyCatalogToNewNode(type, entry, position) : defaultNodeData(type, { position });
    pushHistory();
    setNodes((nds) => [...nds, node]);
    setSelectedId(node.id);
    setSelectedEdgeId(null);
  };

  const onNodeDragStart = useCallback(() => {
    pushHistory();
  }, [pushHistory]);

  const buildGraphPayload = () => flowToGraph(nodes, edges, { x: 0, y: 0, zoom: 1 });

  const extractTriggerSettings = () => {
    const trigger = nodes.find((n) => n.type === 'trigger');
    const modes = trigger?.data?.triggerModes || ['manual'];
    return {
      trigger_modes: modes,
      schedule_cron: modes.includes('schedule') ? trigger?.data?.scheduleCron || '' : '',
      chat_trigger_phrase: modes.includes('chat') ? trigger?.data?.chatPhrase || '' : '',
    };
  };

  const exportWorkflowJson = () => {
    try {
      const triggerSettings = extractTriggerSettings();
      const doc = buildWorkflowExportDocument({
        name: workflow.name,
        description: workflow.description,
        graph: buildGraphPayload(),
        variables: workflow.variables || {},
        ...triggerSettings,
        source_id: workflow.id,
      });
      downloadWorkflowJson(doc, workflow.name || workflow.id);
      showSuccess('Workflow exported as JSON');
    } catch (e) {
      showError(e.message || 'Failed to export workflow');
    }
  };

  const applyImportedWorkflow = (parsed) => {
    const flow = graphToFlow(parsed.graph);
    const modes = parsed.trigger_modes?.length ? parsed.trigger_modes : ['manual'];
    const nodesWithTriggers = flow.nodes.map((n) => {
      const migrated = migrateNodeWithCatalog(n, taskCatalog);
      if (migrated.type !== 'trigger') return migrated;
      return {
        ...migrated,
        data: {
          ...migrated.data,
          triggerModes: modes,
          scheduleCron: modes.includes('schedule') ? parsed.schedule_cron || '' : '',
          chatPhrase: modes.includes('chat') ? parsed.chat_trigger_phrase || '' : '',
        },
      };
    });
    setNodes(nodesWithTriggers);
    setEdges(flow.edges);
    setSelectedId(null);
    setSelectedEdgeId(null);
    setWorkflow((w) =>
      w
        ? {
            ...w,
            name: parsed.name || w.name,
            description: parsed.description ?? w.description,
            variables: parsed.variables || {},
            trigger_modes: modes,
            schedule_cron: parsed.schedule_cron || '',
            chat_trigger_phrase: parsed.chat_trigger_phrase || '',
          }
        : w
    );
    setTimeout(() => seedHistory(), 0);
    setVariablesPanelKey((k) => k + 1);
  };

  const importWorkflowJson = async (file) => {
    if (!file) return;
    try {
      const raw = await readJsonFile(file);
      const parsed = parseWorkflowImportDocument(raw);
      if (
        !window.confirm(
          `Replace the current draft with imported workflow "${parsed.name}" (${parsed.graph.nodes.length} nodes)? Unsaved canvas changes will be lost until you Save draft.`
        )
      ) {
        return;
      }
      applyImportedWorkflow(parsed);
      showSuccess(`Imported "${parsed.name}" — Save draft to persist`);
      setInlineStatus({ type: 'success', message: 'Imported from JSON — Save draft to persist' });
    } catch (e) {
      showError(e.message || 'Failed to import workflow JSON');
    } finally {
      if (importFileRef.current) importFileRef.current.value = '';
    }
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const graph = buildGraphPayload();
      const triggerSettings = extractTriggerSettings();
      const updated = await api.agentWorkflowUpdate(workflowId, {
        name: workflow.name,
        description: workflow.description,
        graph,
        variables: workflow.variables || {},
        ...triggerSettings,
      });
      const final =
        updated.status === 'published'
          ? await api.agentWorkflowUpdateTriggers(workflowId, triggerSettings)
          : updated;
      setWorkflow(final);
      await refreshHookInfo(final);
      const auditRes = await api.agentWorkflowAudit(workflowId);
      setAudit(auditRes.audit || []);
      showSuccess('Draft saved');
    } catch (e) {
      showError(e.message || 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setSaving(true);
    setInlineStatus(null);
    try {
      const graph = buildGraphPayload();
      const triggerSettings = extractTriggerSettings();
      await api.agentWorkflowUpdate(workflowId, {
        name: workflow.name,
        description: workflow.description,
        graph,
        variables: workflow.variables || {},
        ...triggerSettings,
      });
      const updated = await api.agentWorkflowPublish(workflowId);
      if (updated.status !== 'published') {
        throw new Error('Publish did not set workflow status to published');
      }
      await api.agentWorkflowUpdateTriggers(workflowId, triggerSettings);
      setWorkflow(updated);
      await refreshHookInfo(updated);
      const auditRes = await api.agentWorkflowAudit(workflowId);
      setAudit(auditRes.audit || []);
      const msg =
        workflow.status === 'published'
          ? 'Changes published — live workflow updated'
          : 'Workflow published successfully';
      setInlineStatus({ type: 'success', message: msg });
      showSuccess(msg);
    } catch (e) {
      const msg = e.message || 'Failed to publish workflow';
      setInlineStatus({ type: 'error', message: msg });
      showError(msg);
    } finally {
      setSaving(false);
    }
  };

  const unpublish = async () => {
    setSaving(true);
    try {
      const updated = await api.agentWorkflowUnpublish(workflowId);
      setWorkflow(updated);
      setA2aPublication(null);
      await refreshHookInfo(updated);
      const auditRes = await api.agentWorkflowAudit(workflowId);
      setAudit(auditRes.audit || []);
      showSuccess('Workflow reverted to draft');
    } catch (e) {
      showError(e.message || 'Failed to unpublish');
    } finally {
      setSaving(false);
    }
  };

  const publishA2A = async (body) => {
    const pub = await api.agentWorkflowPublishA2A(workflowId, body);
    setA2aPublication(pub);
    showSuccess(`A2A agent published — ${pub.card_url}`);
    return pub;
  };

  const unpublishA2A = async () => {
    if (!window.confirm('Unpublish this workflow from AgentExchange? The A2A endpoint will stop working.')) return;
    setSaving(true);
    try {
      await api.agentWorkflowUnpublishA2A(workflowId);
      setA2aPublication(null);
      showSuccess('A2A agent unpublished');
    } catch (e) {
      showError(e.message || 'Failed to unpublish A2A agent');
    } finally {
      setSaving(false);
    }
  };

  const runWorkflow = async () => {
    setSaving(true);
    setInlineStatus(null);
    try {
      const run = await api.agentWorkflowRun(workflowId, { input: runInput });
      let msg;
      let type = 'success';
      if (run.status === 'completed') {
        msg = `Run #${run.run_number} completed successfully`;
      } else if (run.status === 'failed') {
        msg = `Run #${run.run_number} failed: ${run.error_message || 'unknown error'}`;
        type = 'error';
      } else {
        msg = `Run #${run.run_number} started — progress updates on the Workflows page`;
      }
      setInlineStatus({ type, message: msg });
      if (type === 'error') showError(msg);
      else showSuccess(msg);
      navigate(`/workflows?run_id=${run.id}`);
    } catch (e) {
      const msg = e.message || 'Failed to start run';
      setInlineStatus({ type: 'error', message: msg });
      showError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (!workflow) {
    return (
      <div style={{ padding: '2rem' }}>
        <ActionFeedbackBanner feedback={feedback} onDismiss={clearFeedback} />
        Loading editor…
      </div>
    );
  }

  return (
    <div className="wf-editor-layout">
      <header className="wf-editor-header">
        <div>
          <Link to="/workflows" style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
            ← Workflows
          </Link>
          <h1 style={{ margin: '0.25rem 0' }}>{workflow.name}</h1>
          <code style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{workflow.id}</code>
          <span className={`wf-status wf-status-${workflow.status}`}>{workflow.status}</span>
          <span className="wf-editor-kbd-hint" title="Keyboard shortcuts">
            Del · Ctrl+X copy · Ctrl+V paste · Ctrl+Z undo
          </span>
        </div>
        <div className="wf-editor-actions">
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json,.workflow.json"
            style={{ display: 'none' }}
            onChange={(e) => importWorkflowJson(e.target.files?.[0])}
          />
          <input
            className="wf-run-input"
            placeholder="Run input (optional)"
            value={runInput}
            onChange={(e) => setRunInput(e.target.value)}
          />
          <button type="button" className="wf-btn" onClick={exportWorkflowJson} disabled={saving}>
            Export JSON
          </button>
          <button
            type="button"
            className="wf-btn"
            onClick={() => importFileRef.current?.click()}
            disabled={saving}
            title="Replace draft graph from a .workflow.json export"
          >
            Import JSON
          </button>
          <button type="button" className="wf-btn" onClick={saveDraft} disabled={saving}>
            Save draft
          </button>
          <button type="button" className="wf-btn-primary" onClick={publish} disabled={saving}>
            {workflow.status === 'published' ? 'Publish changes' : 'Publish'}
          </button>
          {workflow.status === 'published' && (
            <button type="button" className="wf-btn" onClick={unpublish} disabled={saving}>
              Revert to draft
            </button>
          )}
          {workflow.status === 'published' && (
            <>
              <button
                type="button"
                className="wf-btn"
                onClick={() => setA2aModalOpen(true)}
                disabled={saving}
                title="Publish as A2A-compliant agent for AgentExchange"
              >
                {a2aPublication ? 'Update A2A' : 'Publish A2A'}
              </button>
              {a2aPublication && (
                <button type="button" className="wf-btn" onClick={unpublishA2A} disabled={saving}>
                  Unpublish A2A
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="wf-btn-accent"
            onClick={runWorkflow}
            disabled={saving || workflow.status !== 'published'}
            title={workflow.status !== 'published' ? 'Publish first' : 'Run workflow'}
          >
            Run
          </button>
        </div>
        {inlineStatus && (
          <div
            className={`wf-editor-inline-status wf-editor-inline-status--${inlineStatus.type}`}
            role="status"
            aria-live="polite"
          >
            {inlineStatus.message}
          </div>
        )}
      </header>

      <ActionFeedbackBanner feedback={feedback} onDismiss={clearFeedback} />

      <div className="wf-editor-body">
        <aside className="wf-palette">
          <h3>Nodes</h3>
          {PALETTE_ITEMS.map((item) => (
            <div
              key={item.type}
              className="wf-palette-item"
              draggable
              onDragStart={(e) => onDragStart(e, item)}
              style={{ borderLeftColor: item.color }}
            >
              <strong>{item.label}</strong>
              <small>{item.desc}</small>
            </div>
          ))}

          <h3 style={{ marginTop: '1.5rem' }}>Agents</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Drag agents onto canvas</p>
          <div className="wf-agent-list">
            {agents
              .filter((a) => !Number(a.is_coo))
              .map((a) => (
                <div
                  key={a.id}
                  className="wf-palette-item wf-agent-chip"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/workflow-agent', JSON.stringify(a));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  {a.name}
                </div>
              ))}
          </div>
        </aside>

        <div className="wf-canvas" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={workflowNodeTypes}
            onNodeClick={(_, n) => {
              setSelectedId(n.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedId(null);
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setSelectedEdgeId(null);
            }}
            onNodeDragStart={onNodeDragStart}
            deleteKeyCode={null}
            fitView
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background gap={16} color="#2a2a2e" />
            <Controls position="top-left" showInteractive={false} />
            <MiniMap
              position="bottom-left"
              maskColor="rgba(15, 15, 18, 0.75)"
              nodeColor={(n) => PALETTE_ITEMS.find((p) => p.type === n.type)?.color || '#6366f1'}
              pannable
              onClick={(_event, position) => {
                if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') return;
                setCenter(position.x, position.y, {
                  zoom: getZoom(),
                  duration: 200,
                });
              }}
            />
          </ReactFlow>
        </div>

        <aside className="wf-sidebar-right">
          <PropertiesPanel
            node={selectedNode}
            agents={agents}
            tools={tools}
            mcpServers={mcpServers}
            mcpLoadError={mcpLoadError}
            externalAgents={externalAgents}
            externalAgentsLoadError={externalAgentsLoadError}
            customScripts={customScripts}
            customScriptsLoadError={customScriptsLoadError}
            taskCatalog={taskCatalog}
            allNodes={nodes}
            edges={edges}
            hookInfo={hookInfo}
            onChange={updateNodeData}
            onDelete={deleteNode}
            onRegenerateHookSecret={regenerateHookSecret}
            onFetchHookInfo={() => refreshHookInfo(workflow)}
            regeneratingSecret={regeneratingSecret}
          />

          <WorkflowVariablesPanel
            key={`${workflowId}-${variablesPanelKey}`}
            variables={workflow.variables || {}}
            onChange={(variables) => setWorkflow((w) => (w ? { ...w, variables } : w))}
          />

          <div className="wf-audit">
            <h3>Audit trail</h3>
            <ul>
              {audit.slice(0, 15).map((a) => (
                <li key={a.id}>
                  <strong>{a.action}</strong>
                  <div>{a.summary}</div>
                  <small>
                    {a.changed_by_name || a.changed_by || 'system'} · {formatLocalDateTime(a.created_at)}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <WorkflowAgentChat
        workflowId={workflowId}
        onEditor
        onGraphUpdated={applyAgentGraph}
        onWorkflowCreated={onAgentWorkflowCreated}
        onWorkflowMetaUpdated={(meta) => {
          if (meta) setWorkflow((w) => (w ? { ...w, ...meta } : w));
        }}
        onAgentEffects={handleAgentEffects}
      />

      <PublishA2AModal
        open={a2aModalOpen}
        workflow={workflow}
        existingPublication={a2aPublication}
        onClose={() => setA2aModalOpen(false)}
        onPublished={publishA2A}
      />
    </div>
  );
}

export default function AgentWorkflowEditor() {
  const { workflowId } = useParams();
  return (
    <div className="page-wf-editor">
      <ReactFlowProvider>
        <EditorInner workflowId={workflowId} />
      </ReactFlowProvider>
    </div>
  );
}

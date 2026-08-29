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
import VaultOrLiteralSecret from '../components/VaultOrLiteralSecret.jsx';
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
import DesktopPackageModal from '../components/workflow/DesktopPackageModal.jsx';

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

/** Client-side JSON Schema → example object (mirrors backend exampleInputFromSchema). */
function exampleInputFromSchemaClient(schema) {
  if (!schema || typeof schema !== 'object') return {};
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    return exampleInputFromSchemaClient(schema.anyOf[0] || {});
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    return exampleInputFromSchemaClient(schema.oneOf[0] || {});
  }
  const type = schema.type;
  if (type === 'object' || schema.properties) {
    const out = {};
    for (const [key, prop] of Object.entries(schema.properties || {})) {
      out[key] = exampleInputFromSchemaClient(prop || {});
    }
    return out;
  }
  if (type === 'array') return [exampleInputFromSchemaClient(schema.items || { type: 'string' })];
  if (type === 'integer' || type === 'number') {
    if (typeof schema.minimum === 'number') {
      return schema.exclusiveMinimum === true ? schema.minimum + 1 : schema.minimum;
    }
    if (typeof schema.exclusiveMinimum === 'number') {
      return schema.exclusiveMinimum + (type === 'integer' ? 1 : Number.EPSILON);
    }
    return type === 'integer' ? 1 : 0;
  }
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  return '';
}

function isEmptyConnectorActionInput(value) {
  const cur = String(value ?? '').trim();
  return !cur || cur === '{}' || cur === '{\n}' || cur === '{\r\n}' || cur === '{{input}}';
}

function withConnectorActionInput(data, jsonText, { forceStatic = false } = {}) {
  const bindings = Array.isArray(data?.inputBindings) ? [...data.inputBindings] : [];
  const idx = bindings.findIndex((b) => b.id === 'input');
  const prev = idx >= 0 ? bindings[idx] : null;
  const keepDynamic = !forceStatic && prev?.mode === 'dynamic' && prev?.sourceNodeId;
  const nextBinding = {
    id: 'input',
    label: 'Action input',
    mode: keepDynamic ? 'dynamic' : 'static',
    value: keepDynamic ? prev.value || '' : String(jsonText ?? '{}'),
    sourceNodeId: keepDynamic ? prev.sourceNodeId || '' : '',
    sourceOutputKey: keepDynamic ? prev.sourceOutputKey || 'result' : 'result',
  };
  if (idx >= 0) bindings[idx] = { ...prev, ...nextBinding };
  else bindings.push(nextBinding);
  return bindings;
}

function PropertiesPanel({ node, agents, tools, mcpServers, mcpLoadError, connectorApps, connectorSearchResults, connectorActions, connectorGuide, connectorInputSchema, connectorExampleInput, connectorActionDescription, connectorLoadError, connectorSearchQuery, onConnectorSearchChange, externalAgents, externalAgentsLoadError, customScripts, customScriptsLoadError, taskCatalog, allNodes, edges, hookInfo, onChange, onDelete, onRegenerateHookSecret, onFetchHookInfo, regeneratingSecret, vaultKeys = [] }) {
  const [secretVisible, setSecretVisible] = useState(false);
  // Keep a string draft for trigger input schema so typing isn't fought by JSON.parse→stringify.
  const [inputSchemaDraft, setInputSchemaDraft] = useState('');
  const [inputSchemaJsonError, setInputSchemaJsonError] = useState('');

  useEffect(() => {
    if (node?.type !== 'trigger') {
      setInputSchemaDraft('');
      setInputSchemaJsonError('');
      return;
    }
    const schema = node.data?.inputSchema;
    if (schema == null || schema === '') {
      setInputSchemaDraft('');
    } else if (typeof schema === 'string') {
      setInputSchemaDraft(schema);
    } else {
      try {
        setInputSchemaDraft(JSON.stringify(schema, null, 2));
      } catch {
        setInputSchemaDraft(String(schema));
      }
    }
    setInputSchemaJsonError('');
  }, [node?.id, node?.type]);

  // Migrate legacy staticInputJson → Inputs binding; auto-fill empty Action input from schema
  useEffect(() => {
    if (!node || node.type !== 'connector') return;
    const cfg = node.data?.taskConfig || {};
    const bindings = Array.isArray(node.data?.inputBindings) ? node.data.inputBindings : [];
    const inputBinding = bindings.find((b) => b.id === 'input');
    const legacy = String(cfg.staticInputJson || '').trim();
    const hasLegacy = legacy && legacy !== '{}' && legacy !== '{\n}' && legacy !== '{\r\n}';

    if (hasLegacy && (!inputBinding || isEmptyConnectorActionInput(inputBinding.value))) {
      onChange(node.id, {
        ...node.data,
        inputBindings: withConnectorActionInput(node.data, legacy, { forceStatic: true }),
        taskConfig: { ...cfg, staticInputJson: '{}' },
      });
      return;
    }

    if (!cfg.actionId) return;
    if (inputBinding?.mode === 'dynamic' && inputBinding?.sourceNodeId) return;
    if (inputBinding && !isEmptyConnectorActionInput(inputBinding.value)) return;

    const example =
      (connectorExampleInput && typeof connectorExampleInput === 'object' && connectorExampleInput) ||
      (connectorInputSchema ? exampleInputFromSchemaClient(connectorInputSchema) : null);
    if (!example || (typeof example === 'object' && !Object.keys(example).length && !connectorInputSchema?.required?.length)) {
      return;
    }
    if (
      String(cfg.actionId || '').includes('get_user') &&
      Object.prototype.hasOwnProperty.call(example, 'username') &&
      !example.username
    ) {
      example.username = 'octocat';
    }
    onChange(node.id, {
      ...node.data,
      inputBindings: withConnectorActionInput(node.data, JSON.stringify(example, null, 2), { forceStatic: true }),
      taskConfig: { ...cfg, staticInputJson: '{}' },
    });
  }, [node?.id, node?.type, node?.data?.taskConfig?.actionId, connectorExampleInput, connectorInputSchema]);

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
          <label className="wf-field">
            Optional input JSON Schema
            <textarea
              rows={8}
              spellCheck={false}
              placeholder={`{\n  "type": "object",\n  "required": ["message"],\n  "properties": {\n    "message": { "type": "string" }\n  },\n  "additionalProperties": false\n}`}
              value={inputSchemaDraft}
              onChange={(e) => {
                const raw = e.target.value;
                setInputSchemaDraft(raw);
                if (!raw.trim()) {
                  setInputSchemaJsonError('');
                  set({ inputSchema: null });
                  return;
                }
                try {
                  JSON.parse(raw);
                  setInputSchemaJsonError('');
                } catch {
                  setInputSchemaJsonError('Invalid JSON — fix before Save / Publish');
                }
                // Store raw string while editing (parsed on save in extractTriggerSettings)
                set({ inputSchema: raw });
              }}
            />
            {inputSchemaJsonError ? (
              <small style={{ color: 'var(--danger, #b42318)' }}>{inputSchemaJsonError}</small>
            ) : (
              <small>
                When set, webhook / manual run / A2A / chat tools validate input before starting. Leave empty for
                free-form text. Use a <code>message</code> property to accept plain chat text.
              </small>
            )}
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
                <VaultOrLiteralSecret
                  literalValue={data.taskConfig?.basicPassword || ''}
                  keyRef={data.taskConfig?.basicPasswordRef || ''}
                  onLiteralChange={(v) =>
                    set({ taskConfig: { ...data.taskConfig, basicPassword: v, basicPasswordRef: '' } })
                  }
                  onKeyRefChange={(v) =>
                    set({ taskConfig: { ...data.taskConfig, basicPasswordRef: v, basicPassword: '' } })
                  }
                  vaultKeys={vaultKeys}
                  MaskedInput={MaskedSecretInput}
                  placeholder="password"
                />
              </label>
            </>
          )}
          {(data.taskConfig?.authType || 'none') === 'bearer' && (
            <label className="wf-field">
              Bearer token
              <VaultOrLiteralSecret
                literalValue={data.taskConfig?.bearerToken || ''}
                keyRef={data.taskConfig?.bearerTokenRef || ''}
                onLiteralChange={(v) =>
                  set({ taskConfig: { ...data.taskConfig, bearerToken: v, bearerTokenRef: '' } })
                }
                onKeyRefChange={(v) =>
                  set({ taskConfig: { ...data.taskConfig, bearerTokenRef: v, bearerToken: '' } })
                }
                vaultKeys={vaultKeys}
                MaskedInput={MaskedSecretInput}
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
                <VaultOrLiteralSecret
                  literalValue={data.taskConfig?.apiKeyValue || ''}
                  keyRef={data.taskConfig?.apiKeyValueRef || ''}
                  onLiteralChange={(v) =>
                    set({ taskConfig: { ...data.taskConfig, apiKeyValue: v, apiKeyValueRef: '' } })
                  }
                  onKeyRefChange={(v) =>
                    set({ taskConfig: { ...data.taskConfig, apiKeyValueRef: v, apiKeyValue: '' } })
                  }
                  vaultKeys={vaultKeys}
                  MaskedInput={MaskedSecretInput}
                  placeholder="MySecretKey123"
                />
              </label>
            </>
          )}
          <HttpHeadersEditor
            className="wf-field"
            vaultKeys={vaultKeys}
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

      {node.type === 'connector' && (
        <>
          <label className="wf-field">
            Connected connector
            <select
              value={data.taskConfig?.appId || ''}
              onChange={(e) => {
                const id = e.target.value;
                const app = (connectorApps || []).find((x) => x.id === id) || (connectorSearchResults || []).find((x) => x.id === id);
                set({
                  taskConfig: {
                    ...data.taskConfig,
                    appId: id,
                    appName: app?.name || id,
                    actionId: '',
                  },
                  label: app?.name || data.label || 'Connector',
                });
              }}
            >
              <option value="">— select connected app —</option>
              {(connectorApps || []).map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
            <small>Connected apps for this CEO appear here first.</small>
          </label>

          <label className="wf-field">
            Search all connectors
            <input
              value={connectorSearchQuery || ''}
              onChange={(e) => onConnectorSearchChange?.(e.target.value)}
              placeholder="gmail, github, notion…"
            />
            <small>Search the full OpenConnector catalog for more apps.</small>
          </label>

          {!!(connectorSearchResults || []).length && (
            <label className="wf-field">
              Search results
              <select
                value=""
                onChange={(e) => {
                  const id = e.target.value;
                  if (!id) return;
                  const app = (connectorSearchResults || []).find((x) => x.id === id);
                  set({
                    taskConfig: {
                      ...data.taskConfig,
                      appId: id,
                      appName: app?.name || id,
                      actionId: '',
                    },
                    label: app?.name || data.label || 'Connector',
                  });
                }}
              >
                <option value="">— pick from search —</option>
                {(connectorSearchResults || []).map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="wf-field">
            Action
            <select
              value={data.taskConfig?.actionId || ''}
              onChange={(e) => {
                const value = e.target.value;
                const action = (connectorActions || []).find((a) => a.id === value);
                const next = {
                  ...data.taskConfig,
                  actionId: value,
                  actionDescription: action?.description || '',
                  staticInputJson: '{}',
                };
                const patch = {
                  taskConfig: next,
                  label: value ? value.split('.').slice(1).join('.') || value : data.label,
                };
                const existing = (data.inputBindings || []).find((b) => b.id === 'input');
                const canFill =
                  !existing ||
                  existing.mode !== 'dynamic' ||
                  !existing.sourceNodeId ||
                  isEmptyConnectorActionInput(existing.value);
                if (canFill) {
                  let example = null;
                  if (action?.example_input && typeof action.example_input === 'object') {
                    example = action.example_input;
                  } else if (action?.input_schema) {
                    example = exampleInputFromSchemaClient(action.input_schema);
                  }
                  if (example) {
                    patch.inputBindings = withConnectorActionInput(
                      data,
                      JSON.stringify(example, null, 2),
                      { forceStatic: true }
                    );
                  }
                }
                set(patch);
              }}
              disabled={!data.taskConfig?.appId}
            >
              <option value="">— select action —</option>
              {(connectorActions || []).map((action) => (
                <option key={action.id} value={action.id}>
                  {action.id}{action.description ? ` — ${String(action.description).slice(0, 60)}` : ''}
                </option>
              ))}
            </select>
            <small>
              Set parameters in <strong>Inputs → Action input</strong> (Static JSON or From previous step).
            </small>
          </label>

          <label className="wf-field">
            Connection name (optional)
            <input
              value={data.taskConfig?.connectionName || ''}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, connectionName: e.target.value } })}
              placeholder="ceo-..."
            />
            <small>Leave blank to use your saved default connector alias.</small>
          </label>

          {!!(connectorInputSchema || connectorExampleInput) && (
            <div className="wf-field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong>Input schema</strong>
                <button
                  type="button"
                  className="wf-btn"
                  onClick={() => {
                    const example =
                      connectorExampleInput && typeof connectorExampleInput === 'object'
                        ? connectorExampleInput
                        : exampleInputFromSchemaClient(connectorInputSchema);
                    set({
                      taskConfig: { ...data.taskConfig, staticInputJson: '{}' },
                      inputBindings: withConnectorActionInput(
                        data,
                        JSON.stringify(example || {}, null, 2),
                        { forceStatic: true }
                      ),
                    });
                  }}
                >
                  Auto-fill Action input
                </button>
              </div>
              {!!connectorActionDescription && (
                <p style={{ margin: '0.35rem 0', fontSize: '0.85rem', color: 'var(--muted)' }}>
                  {connectorActionDescription}
                </p>
              )}
              <textarea
                rows={6}
                readOnly
                value={JSON.stringify(connectorInputSchema || { note: 'No schema returned for this action' }, null, 2)}
              />
              <small>
                Auto-fill writes sample JSON into <strong>Inputs → Action input</strong> (Static). Edit values or switch
                to From previous step / templates there.
              </small>
            </div>
          )}

          {connectorLoadError && <small style={{ color: '#dc2626' }}>{connectorLoadError}</small>}
          {!!connectorGuide && (
            <div className="wf-field">
              <strong>Action guide</strong>
              <small style={{ display: 'block', marginBottom: 4, color: 'var(--muted)' }}>
                Docs from OpenConnector for this action (parameters, curl example, scopes). Fill values in{' '}
                <strong>Inputs → Action input</strong>.
              </small>
              <textarea rows={8} value={connectorGuide} readOnly />
            </div>
          )}
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
          <label className="wf-field">
            Bearer token override (optional)
            <VaultOrLiteralSecret
              literalValue={data.taskConfig?.authBearer || data.taskConfig?.bearerToken || ''}
              keyRef={data.taskConfig?.authBearerRef || ''}
              onLiteralChange={(v) =>
                set({ taskConfig: { ...data.taskConfig, authBearer: v, authBearerRef: '' } })
              }
              onKeyRefChange={(v) =>
                set({ taskConfig: { ...data.taskConfig, authBearerRef: v, authBearer: '' } })
              }
              vaultKeys={vaultKeys}
              MaskedInput={MaskedSecretInput}
              placeholder="token or {{api-login.body.accessToken}}"
            />
            <small className="wf-field-hint">
              Overrides registry auth for this node. Supports {'{{nodeId.path}}'} templates (e.g. token from a prior API
              login step). Leave blank to use External Agents registry auth.
            </small>
          </label>
          <HttpHeadersEditor
            className="wf-field"
            vaultKeys={vaultKeys}
            value={data.taskConfig?.httpHeadersJson || '{}'}
            onChange={(httpHeadersJson) => set({ taskConfig: { ...data.taskConfig, httpHeadersJson } })}
          />
          <small className="wf-field-hint">
            Extra headers merged over registry auth. Values support {'{{api-login.body.accessToken}}'} templates.
          </small>
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
            Location
            <select
              value={data.taskConfig?.transport || 'local'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, transport: e.target.value } })}
            >
              <option value="local">Local disk (Windows or Unix path)</option>
              <option value="ftp">FTP</option>
              <option value="ftps">FTPS</option>
              <option value="sftp">SFTP</option>
            </select>
          </label>
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
              <option value="write_text">Write text</option>
              <option value="move">Move</option>
            </select>
          </label>
          <label className="wf-field">
            Path
            <input
              value={data.taskConfig?.path || ''}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, path: e.target.value } })}
              placeholder={
                (data.taskConfig?.transport || 'local') === 'local'
                  ? 'C:\\data\\inbox\\file.txt  or  /var/data/inbox/file.txt'
                  : '/remote/inbox/file.txt'
              }
            />
            <small>
              {(data.taskConfig?.transport || 'local') === 'local' ? (
                <>
                  On Flolah, paths stay under <code>WORKFLOW_FS_ROOTS</code>. With{' '}
                  <strong>Download for Windows</strong>, this path is on the laptop (Windows or Unix).
                </>
              ) : (
                <>Remote path on the FTP/SFTP host (always POSIX, e.g. <code>/inbox/file.csv</code>).</>
              )}
            </small>
          </label>
          {(data.taskConfig?.transport || 'local') !== 'local' && (
            <>
              <label className="wf-field">
                Host
                <input
                  value={data.taskConfig?.host || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, host: e.target.value } })}
                  placeholder="ftp.example.com"
                />
              </label>
              <label className="wf-field">
                Port
                <input
                  type="number"
                  value={data.taskConfig?.port ?? ''}
                  onChange={(e) =>
                    set({
                      taskConfig: {
                        ...data.taskConfig,
                        port: e.target.value === '' ? '' : Number(e.target.value),
                      },
                    })
                  }
                  placeholder={(data.taskConfig?.transport || '') === 'sftp' ? '22' : '21'}
                />
              </label>
              <label className="wf-field">
                Username
                <input
                  value={data.taskConfig?.username || ''}
                  onChange={(e) => set({ taskConfig: { ...data.taskConfig, username: e.target.value } })}
                />
              </label>
              <VaultOrLiteralSecret
                label="Password"
                literalValue={data.taskConfig?.password || ''}
                keyRef={data.taskConfig?.passwordRef || ''}
                onLiteralChange={(v) => set({ taskConfig: { ...data.taskConfig, password: v } })}
                onKeyRefChange={(v) => set({ taskConfig: { ...data.taskConfig, passwordRef: v } })}
                vaultKeys={vaultKeys}
                MaskedInput={MaskedSecretInput}
              />
              {(data.taskConfig?.transport || '') === 'sftp' && (
                <VaultOrLiteralSecret
                  label="Private key (optional)"
                  literalValue={data.taskConfig?.privateKey || ''}
                  keyRef={data.taskConfig?.privateKeyRef || ''}
                  onLiteralChange={(v) => set({ taskConfig: { ...data.taskConfig, privateKey: v } })}
                  onKeyRefChange={(v) => set({ taskConfig: { ...data.taskConfig, privateKeyRef: v } })}
                  vaultKeys={vaultKeys}
                  MaskedInput={MaskedSecretInput}
                />
              )}
            </>
          )}
          <label className="wf-field">
            When run as a desktop package
            <select
              value={data.taskConfig?.executeOn || 'auto'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, executeOn: e.target.value } })}
            >
              <option value="auto">Auto (laptop disk + FTP; SFTP on Flolah)</option>
              <option value="local">This machine (laptop)</option>
              <option value="server">Flolah server</option>
            </select>
          </label>
          <label className="wf-field">
            Glob (list)
            <input
              value={data.taskConfig?.glob || '*'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, glob: e.target.value } })}
              placeholder="*.txt"
            />
          </label>
          {(data.taskConfig?.operation || 'list') === 'write_text' && (
            <label className="wf-field">
              Default content (or bind Input <code>content</code>)
              <textarea
                rows={4}
                value={data.taskConfig?.content || ''}
                onChange={(e) => set({ taskConfig: { ...data.taskConfig, content: e.target.value } })}
                placeholder="Text to write, or bind from an upstream node"
              />
            </label>
          )}
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
          <label className="wf-field">
            Max read/write bytes
            <input
              type="number"
              min={1}
              max={2097152}
              value={data.taskConfig?.maxBytes ?? 65536}
              onChange={(e) =>
                set({ taskConfig: { ...data.taskConfig, maxBytes: Number(e.target.value) || 65536 } })
              }
            />
          </label>
        </>
      )}

      {node.type === 'web_scrape' && (
        <>
          <label className="wf-field">
            Render
            <select
              value={data.taskConfig?.render || 'auto'}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, render: e.target.value } })}
            >
              <option value="auto">Auto (HTTP, Playwright if thin)</option>
              <option value="http">HTTP (Cheerio)</option>
              <option value="playwright">Playwright (JS sites)</option>
            </select>
          </label>
          <label className="wf-field">
            Max pages
            <input
              type="number"
              min={1}
              max={200}
              value={data.taskConfig?.maxPages ?? 25}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, maxPages: Number(e.target.value) || 25 } })}
            />
          </label>
          <label className="wf-field">
            Max depth
            <input
              type="number"
              min={0}
              max={6}
              value={data.taskConfig?.maxDepth ?? 2}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, maxDepth: Number(e.target.value) || 0 } })}
            />
          </label>
          <label className="wf-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={data.taskConfig?.sameOriginOnly !== false}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, sameOriginOnly: e.target.checked } })}
            />
            Same origin only
          </label>
          <label className="wf-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={data.taskConfig?.respectRobotsTxt !== false}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, respectRobotsTxt: e.target.checked } })}
            />
            Respect robots.txt
          </label>
          <label className="wf-field">
            Include URL globs
            <input
              value={data.taskConfig?.includeGlobs || ''}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, includeGlobs: e.target.value } })}
              placeholder="https://example.com/blog/*"
            />
          </label>
          <label className="wf-field">
            Exclude URL globs
            <input
              value={data.taskConfig?.excludeGlobs || ''}
              onChange={(e) => set({ taskConfig: { ...data.taskConfig, excludeGlobs: e.target.value } })}
              placeholder="*/tag/*,*/login*"
            />
          </label>
          <small>
            Crawlee sidecar (HTTPS, robots.txt). Phrase filter is an Input. Instagram.com can use vault{' '}
            <code>INSTAGRAM_SESSIONID</code> when Cookie is empty. Logged-in Chrome still uses Browser Session.
          </small>
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
          <label className="wf-field">
            Bearer token (optional)
            <VaultOrLiteralSecret
              literalValue={data.taskConfig?.authBearer || ''}
              keyRef={data.taskConfig?.authBearerRef || ''}
              onLiteralChange={(v) =>
                set({ taskConfig: { ...data.taskConfig, authBearer: v, authBearerRef: '' } })
              }
              onKeyRefChange={(v) =>
                set({ taskConfig: { ...data.taskConfig, authBearerRef: v, authBearer: '' } })
              }
              vaultKeys={vaultKeys}
              MaskedInput={MaskedSecretInput}
              placeholder="token or {{api-login.body.accessToken}}"
            />
            <small className="wf-field-hint">
              Static token or {'{{nodeId.path}}'} from a prior step. Applied as Authorization: Bearer …
            </small>
          </label>
          <HttpHeadersEditor
            className="wf-field"
            vaultKeys={vaultKeys}
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
          <small className="wf-field-hint">
            Auth headers for MCP transport (node-only). Header values support {'{{api-login.body.accessToken}}'}{' '}
            templates at run time.
          </small>
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
            vaultKeys={vaultKeys}
            value={data.taskConfig?.httpHeadersJson || '{}'}
            onChange={(httpHeadersJson) => set({ taskConfig: { ...data.taskConfig, httpHeadersJson } })}
          />
          <small className="wf-field-hint">
            Long-running listen — run stays active until stream ends or you stop listen on the Runs page. Header values
            support {'{{nodeId.path}}'} templates. Wire IF → Parallel → Sub-workflow / API downstream.
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
                        ...(modelSource === 'openrouter' || modelSource === 'deepseek'
                          ? {
                              thinkingMode: data.taskConfig?.thinkingMode || 'enabled',
                              thinkingEffort: data.taskConfig?.thinkingEffort || 'high',
                            }
                          : {}),
                        ...(modelSource === 'openrouter'
                          ? {
                              httpReferer: preset.httpReferer ?? data.taskConfig?.httpReferer ?? '',
                              siteTitle: preset.siteTitle ?? data.taskConfig?.siteTitle ?? 'Flolah',
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
                <VaultOrLiteralSecret
                  literalValue={data.taskConfig?.apiKey || ''}
                  keyRef={data.taskConfig?.apiKeyRef || ''}
                  onLiteralChange={(v) =>
                    set({ taskConfig: { ...data.taskConfig, apiKey: v, apiKeyRef: '' } })
                  }
                  onKeyRefChange={(v) =>
                    set({ taskConfig: { ...data.taskConfig, apiKeyRef: v, apiKey: '' } })
                  }
                  vaultKeys={vaultKeys}
                  MaskedInput={MaskedSecretInput}
                  placeholder={
                    (data.taskConfig?.modelSource || 'openai') === 'ollama'
                      ? 'optional for local Ollama'
                      : (data.taskConfig?.modelSource || 'openai') === 'deepseek'
                        ? 'sk-... DeepSeek cloud key (or blank for local Ollama endpoint)'
                        : 'sk-... (not read from platform .env)'
                  }
                />
                {(data.taskConfig?.modelSource || 'openai') !== 'ollama' &&
                  (data.taskConfig?.modelSource || 'openai') !== 'deepseek' && (
                  <small>Workflow Brain nodes never use platform OPENAI_API_KEY / OPENROUTER_API_KEY from .env</small>
                )}
                {(data.taskConfig?.modelSource || 'openai') === 'deepseek' && (
                  <small>
                    Cloud: https://api.deepseek.com/v1 + API key (e.g. deepseek-v4-flash). Local Ollama: set endpoint to
                    http://ollama:11434/v1 and model deepseek-v3 (no key).
                  </small>
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
                      placeholder="Flolah or OPENROUTER_SITE_TITLE"
                    />
                  </label>
                </>
              )}
              {((data.taskConfig?.modelSource || 'openai') === 'deepseek' ||
                (data.taskConfig?.modelSource || 'openai') === 'openrouter') && (
                <>
                  <label className="wf-field">
                    Thinking mode
                    <select
                      value={data.taskConfig?.thinkingMode || 'enabled'}
                      onChange={(e) => set({ taskConfig: { ...data.taskConfig, thinkingMode: e.target.value } })}
                    >
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                      <option value="off">Off (omit — provider default)</option>
                    </select>
                    <small>
                      {(data.taskConfig?.modelSource || '') === 'deepseek'
                        ? 'DeepSeek API: thinking toggle (+ reasoning_effort). Best with cloud https://api.deepseek.com/v1.'
                        : 'OpenRouter: unified reasoning param (works for DeepSeek / Claude / OpenAI reasoning models).'}
                    </small>
                  </label>
                  {(data.taskConfig?.thinkingMode || 'enabled') === 'enabled' && (
                    <label className="wf-field">
                      Thinking effort
                      <select
                        value={data.taskConfig?.thinkingEffort || 'high'}
                        onChange={(e) =>
                          set({ taskConfig: { ...data.taskConfig, thinkingEffort: e.target.value } })
                        }
                      >
                        <option value="high">high</option>
                        <option value="max">max (DeepSeek)</option>
                        <option value="xhigh">xhigh (OpenRouter)</option>
                        <option value="medium">medium</option>
                        <option value="low">low</option>
                      </select>
                    </label>
                  )}
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

const PROPS_PANE_LS_KEY = 'agent-os-wf-props-pane-width';
const PROPS_PANE_DEFAULT = 280;
const PROPS_PANE_MIN = 200;
const PROPS_PANE_MAX = 720;

function clampPropsPaneWidth(w) {
  return Math.min(PROPS_PANE_MAX, Math.max(PROPS_PANE_MIN, Math.round(Number(w) || PROPS_PANE_DEFAULT)));
}

function readStoredPropsPaneWidth() {
  try {
    const n = Number(localStorage.getItem(PROPS_PANE_LS_KEY));
    if (Number.isFinite(n) && n > 0) return clampPropsPaneWidth(n);
  } catch {
    /* ignore */
  }
  return PROPS_PANE_DEFAULT;
}

function analyzeGraphReadinessClient(nodes, edges, taskCatalog) {
  const issues = [];
  const catalogByType = new Map((taskCatalog || []).map((entry) => [entry.type, entry]));
  const nodeIds = new Set((nodes || []).map((node) => node.id));
  if (!(nodes || []).some((node) => node.type === 'trigger')) {
    issues.push({ message: 'Workflow needs a Trigger node.' });
  }
  for (const node of nodes || []) {
    const label = node.data?.label || node.id;
    const spec = catalogByType.get(node.type);
    if (!spec) continue;
    if (node.type !== 'trigger' && !(edges || []).some((edge) => edge.target === node.id)) {
      issues.push({ nodeId: node.id, message: `${label}: connect this node from an upstream step.` });
    }
    const bindings = Array.isArray(node.data?.inputBindings) ? node.data.inputBindings : [];
    for (const input of spec.inputs || []) {
      if (!input.required) continue;
      const binding = bindings.find((candidate) => candidate.id === input.id);
      const mode = String(binding?.mode || 'static').toLowerCase();
      const valid = mode === 'static'
        ? String(binding?.value ?? '').trim().length > 0
        : mode === 'dynamic'
          ? (binding?.sourceNodeId ? nodeIds.has(binding.sourceNodeId) : (edges || []).some((edge) => edge.target === node.id))
          : ['workflow_variable', 'variable'].includes(mode)
            ? String(binding?.variableKey || binding?.sourceOutputKey || binding?.id || '').trim().length > 0
            : false;
      if (!valid) {
        issues.push({ nodeId: node.id, message: `${label} → ${input.label || input.id} is required.` });
      }
    }
    const cfg = node.data?.taskConfig || {};
    const identities = {
      agent: [['Agent', node.data?.agentId]],
      tool: [['Tool name', node.data?.toolName]],
      mcp_tool: [['MCP server', cfg.mcpServerId], ['MCP tool', cfg.toolName]],
      custom_script: [['Custom script', cfg.customScriptId]],
      connector: [['Connector app', cfg.appId], ['Connector action', cfg.actionId]],
      sub_workflow: [['Target workflow', cfg.targetWorkflowId]],
      externalAgent: [['External agent', cfg.externalAgentId]],
    };
    for (const [field, value] of identities[node.type] || []) {
      if (!String(value || '').trim()) issues.push({ nodeId: node.id, message: `${label} → ${field} is required.` });
    }
  }
  return issues;
}

function EditorInner({ workflowId }) {
  const navigate = useNavigate();
  const { setCenter, getZoom } = useReactFlow();
  const [propsPaneWidth, setPropsPaneWidth] = useState(readStoredPropsPaneWidth);
  const propsPaneWidthRef = useRef(propsPaneWidth);
  const propsResizeActiveRef = useRef(false);
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
  const [connectorApps, setConnectorApps] = useState([]);
  const [connectorSearchResults, setConnectorSearchResults] = useState([]);
  const [connectorActions, setConnectorActions] = useState([]);
  const [connectorGuide, setConnectorGuide] = useState('');
  const [connectorInputSchema, setConnectorInputSchema] = useState(null);
  const [connectorExampleInput, setConnectorExampleInput] = useState(null);
  const [connectorActionDescription, setConnectorActionDescription] = useState('');
  const [connectorLoadError, setConnectorLoadError] = useState(null);
  const [connectorSearchQuery, setConnectorSearchQuery] = useState('');
  const [externalAgents, setExternalAgents] = useState([]);
  const [externalAgentsLoadError, setExternalAgentsLoadError] = useState(null);
  const [customScripts, setCustomScripts] = useState([]);
  const [customScriptsLoadError, setCustomScriptsLoadError] = useState(null);
  const [runInput, setRunInput] = useState('');
  const [a2aPublication, setA2aPublication] = useState(null);
  const [a2aPublications, setA2aPublications] = useState([]);
  const [a2aModalOpen, setA2aModalOpen] = useState(false);
  const [desktopModalOpen, setDesktopModalOpen] = useState(false);
  const [vaultKeys, setVaultKeys] = useState([]);

  useEffect(() => {
    api
      .userApiKeysList()
      .then((r) => setVaultKeys(r.keys || []))
      .catch(() => setVaultKeys([]));
  }, [workflowId]);

  useEffect(() => {
    propsPaneWidthRef.current = propsPaneWidth;
  }, [propsPaneWidth]);

  const onPropsPaneResizePointerDown = useCallback((e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startW = propsPaneWidthRef.current;
    propsResizeActiveRef.current = true;
    document.body.classList.add('wf-props-resizing');
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }

    const onMove = (ev) => {
      if (!propsResizeActiveRef.current) return;
      // Dragging the left edge: move left → wider pane
      const next = clampPropsPaneWidth(startW + (startX - ev.clientX));
      propsPaneWidthRef.current = next;
      setPropsPaneWidth(next);
    };
    const onUp = () => {
      propsResizeActiveRef.current = false;
      document.body.classList.remove('wf-props-resizing');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      try {
        localStorage.setItem(PROPS_PANE_LS_KEY, String(propsPaneWidthRef.current));
      } catch {
        /* ignore */
      }
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, []);

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

  const loadConnectorApps = useCallback(() => {
    return api
      .openconnectorApps()
      .then((res) => {
        setConnectorApps(res.apps || []);
        setConnectorLoadError(null);
      })
      .catch((e) => {
        setConnectorApps([]);
        setConnectorLoadError(e.message || 'Failed to load connected connectors');
      });
  }, []);

  const loadConnectorSearch = useCallback((query) => {
    const q = String(query || '').trim();
    setConnectorSearchQuery(q);
    if (!q) {
      setConnectorSearchResults([]);
      return Promise.resolve([]);
    }
    return api
      .openconnectorAppsSearch(q)
      .then((res) => {
        setConnectorSearchResults(res.apps || []);
        setConnectorLoadError(null);
        return res.apps || [];
      })
      .catch((e) => {
        setConnectorSearchResults([]);
        setConnectorLoadError(e.message || 'Failed to search connectors');
        return [];
      });
  }, []);

  const loadConnectorActions = useCallback((appId, actionId = '') => {
    const id = String(appId || '').trim();
    if (!id) {
      setConnectorActions([]);
      setConnectorGuide('');
      setConnectorInputSchema(null);
      setConnectorExampleInput(null);
      setConnectorActionDescription('');
      return Promise.resolve([]);
    }
    return api
      .openconnectorActions(id)
      .then(async (res) => {
        const actions = (res.actions || []).map((a) => ({
          ...a,
          example_input:
            a.example_input ||
            (a.input_schema ? exampleInputFromSchemaClient(a.input_schema) : undefined),
        }));
        setConnectorActions(actions);
        setConnectorLoadError(null);
        const selected = actionId || '';
        if (selected) {
          try {
            const guide = await api.openconnectorActionGuide(selected);
            setConnectorGuide(guide.guide || '');
            setConnectorInputSchema(guide.input_schema || actions.find((a) => a.id === selected)?.input_schema || null);
            setConnectorExampleInput(
              guide.example_input ||
                actions.find((a) => a.id === selected)?.example_input ||
                null
            );
            setConnectorActionDescription(
              guide.description || actions.find((a) => a.id === selected)?.description || ''
            );
          } catch {
            const hit = actions.find((a) => a.id === selected);
            setConnectorGuide('');
            setConnectorInputSchema(hit?.input_schema || null);
            setConnectorExampleInput(hit?.example_input || null);
            setConnectorActionDescription(hit?.description || '');
          }
        } else {
          setConnectorGuide('');
          setConnectorInputSchema(null);
          setConnectorExampleInput(null);
          setConnectorActionDescription('');
        }
        return actions;
      })
      .catch((e) => {
        setConnectorActions([]);
        setConnectorGuide('');
        setConnectorInputSchema(null);
        setConnectorExampleInput(null);
        setConnectorActionDescription('');
        setConnectorLoadError(e.message || 'Failed to load connector actions');
        return [];
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
  const readinessIssues = useMemo(
    () => analyzeGraphReadinessClient(nodes, edges, taskCatalog),
    [nodes, edges, taskCatalog]
  );

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
      .agentWorkflowA2APublications(workflowId)
      .then((res) => {
        const list = res?.publications || [];
        setA2aPublications(list);
        setA2aPublication(list[0] || null);
        return list[0] || null;
      })
      .catch(() => {
        setA2aPublications([]);
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
      loadConnectorApps(),
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
          setA2aPublications([]);
        }
      })
      .catch((e) => showError(e.message || 'Failed to load workflow'));
  }, [workflowId, setNodes, setEdges, showError, loadMcpServers, loadConnectorApps, loadExternalAgents, seedHistory, loadA2aPublication]);

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
    if (selectedNode?.type === 'connector') {
      loadConnectorApps();
      loadConnectorActions(selectedNode?.data?.taskConfig?.appId, selectedNode?.data?.taskConfig?.actionId);
    }
    if (selectedNode?.type === 'externalAgent') loadExternalAgents();
    if (selectedNode?.type === 'custom_script' || selectedNode?.type === 'brain') loadCustomScripts();
  }, [selectedNode?.id, selectedNode?.type, selectedNode?.data?.taskConfig?.appId, selectedNode?.data?.taskConfig?.actionId, loadMcpServers, loadConnectorApps, loadConnectorActions, loadExternalAgents, loadCustomScripts]);

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

  const onConnectorDragStart = (event, app) => {
    event.dataTransfer.setData('application/workflow-connector', JSON.stringify(app));
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
    const connectorRaw = event.dataTransfer.getData('application/workflow-connector');
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

    if (connectorRaw) {
      const app = JSON.parse(connectorRaw);
      const entry = taskCatalog.find((t) => t.type === 'connector');
      const node = entry ? applyCatalogToNewNode('connector', entry, position) : defaultNodeData('connector', { position });
      node.data.taskConfig = {
        ...(node.data.taskConfig || {}),
        appId: app.id,
        appName: app.name,
      };
      node.data.label = app.name || 'Connector';
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
    let input_schema = null;
    const rawSchema = trigger?.data?.inputSchema;
    if (rawSchema != null && rawSchema !== '') {
      if (typeof rawSchema === 'string') {
        try {
          input_schema = JSON.parse(rawSchema);
        } catch {
          throw new Error('Trigger input JSON Schema is not valid JSON');
        }
      } else {
        input_schema = rawSchema;
      }
    }
    return {
      trigger_modes: modes,
      schedule_cron: modes.includes('schedule') ? trigger?.data?.scheduleCron || '' : '',
      chat_trigger_phrase: modes.includes('chat') ? trigger?.data?.chatPhrase || '' : '',
      input_schema,
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
          inputSchema: parsed.input_schema || migrated.data?.inputSchema || null,
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
            input_schema: parsed.input_schema || null,
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
      setA2aPublications([]);
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
    await loadA2aPublication();
    if (pub?.credentials?.client_secret) {
      showSuccess(`A2A agent published (secured) — save client_secret now; card ${pub.card_url}`);
    } else {
      showSuccess(`A2A agent published — ${pub.card_url}`);
    }
    return pub;
  };

  const unpublishA2A = async () => {
    const list = a2aPublications.length ? a2aPublications : a2aPublication ? [a2aPublication] : [];
    if (!list.length) return;
    let publishId = list[0].id;
    if (list.length > 1) {
      const choices = list.map((p, i) => `${i + 1}. ${p.name} (${p.id})`).join('\n');
      const pick = window.prompt(
        `Multiple A2A agents are published. Enter 1–${list.length} to unpublish one:\n${choices}`,
        '1'
      );
      const idx = Number(pick) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return;
      publishId = list[idx].id;
    }
    if (
      !window.confirm(
        `Unpublish A2A agent "${list.find((p) => p.id === publishId)?.name || publishId}" from AgentExchange? The endpoint will stop working.`
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      await api.agentWorkflowUnpublishA2A(workflowId, { publishId });
      await loadA2aPublication();
      showSuccess('A2A agent unpublished');
    } catch (e) {
      showError(e.message || 'Failed to unpublish A2A');
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
        <div className="wf-editor-header-meta">
          <Link to="/workflows" className="wf-editor-exit" title="Exit fullscreen editor">
            ← Exit to workflows
          </Link>
          <h1>{workflow.name}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <code style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{workflow.id}</code>
            <span className={`wf-status wf-status-${workflow.status}`}>{workflow.status}</span>
            <span className="wf-editor-kbd-hint" title="Keyboard shortcuts" style={{ marginTop: 0 }}>
              Del · Ctrl+X · Ctrl+V · Ctrl+Z
            </span>
          </div>
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
          {workflow.status === 'published' && (
            <button
              type="button"
              className="wf-btn"
              onClick={() => setDesktopModalOpen(true)}
              disabled={saving}
              title="Download PS1 + Node package to run this workflow on Windows"
            >
              Download for Windows
            </button>
          )}
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
          <button
            type="button"
            className="wf-btn-primary"
            onClick={publish}
            disabled={saving || readinessIssues.length > 0}
            title={readinessIssues.length ? `Resolve ${readinessIssues.length} readiness issue(s) before publishing` : 'Publish workflow'}
          >
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
                {a2aPublications.length > 1
                  ? `Update A2A (${a2aPublications.length})`
                  : a2aPublication
                    ? 'Update A2A'
                    : 'Publish A2A'}
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
        {!!readinessIssues.length && (
          <div className="wf-editor-readiness" role="status" aria-live="polite">
            <strong>Not ready to publish · {readinessIssues.length} issue{readinessIssues.length === 1 ? '' : 's'}</strong>
            <ul>
              {readinessIssues.slice(0, 6).map((issue, index) => (
                <li key={`${issue.nodeId || 'graph'}-${index}`}>
                  {issue.nodeId ? (
                    <button type="button" onClick={() => setSelectedId(issue.nodeId)}>{issue.message}</button>
                  ) : issue.message}
                </li>
              ))}
            </ul>
            {readinessIssues.length > 6 && <small>+ {readinessIssues.length - 6} more issues</small>}
          </div>
        )}
      </header>

      <ActionFeedbackBanner feedback={feedback} onDismiss={clearFeedback} />

      <div
        className="wf-editor-body"
        style={{ '--wf-props-pane-width': `${propsPaneWidth}px` }}
      >
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

          <h3 style={{ marginTop: '1.5rem' }}>Connectors</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            Drag an app chip, or use the generic <strong>Connector</strong> node and search in properties.
            Connected OAuth apps appear first; starters (HN/GitHub/Gmail) show when none are linked yet.
          </p>
          <div className="wf-agent-list">
            {(connectorApps || []).map((app) => (
              <div
                key={app.id}
                className="wf-palette-item wf-agent-chip"
                draggable
                onDragStart={(e) => onConnectorDragStart(e, app)}
                title={app.connected ? `${app.id} (connected)` : `${app.id} (catalog)`}
              >
                {app.name}
                {app.suggested ? ' · starter' : app.connected ? '' : ''}
              </div>
            ))}
            {!(connectorApps || []).length && (
              <small style={{ color: 'var(--muted)' }}>
                {connectorLoadError ||
                  'No apps loaded. Open Profile → Auto provision token, then refresh this page. Or drag Connector from Nodes and search hackernews in properties.'}
              </small>
            )}
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
            colorMode="light"
          >
            <Background gap={16} color="#e4e6ea" />
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

        <aside className="wf-sidebar-right" aria-label="Node attributes">
          <div
            className="wf-props-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize attributes pane"
            aria-valuemin={PROPS_PANE_MIN}
            aria-valuemax={PROPS_PANE_MAX}
            aria-valuenow={propsPaneWidth}
            tabIndex={0}
            onPointerDown={onPropsPaneResizePointerDown}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 40 : 16;
              let next = propsPaneWidthRef.current;
              if (e.key === 'ArrowLeft') next = clampPropsPaneWidth(next + step);
              else if (e.key === 'ArrowRight') next = clampPropsPaneWidth(next - step);
              else if (e.key === 'Home') next = PROPS_PANE_MAX;
              else if (e.key === 'End') next = PROPS_PANE_MIN;
              else return;
              e.preventDefault();
              propsPaneWidthRef.current = next;
              setPropsPaneWidth(next);
              try {
                localStorage.setItem(PROPS_PANE_LS_KEY, String(next));
              } catch {
                /* ignore */
              }
            }}
          />
          <PropertiesPanel
            node={selectedNode}
            agents={agents}
            tools={tools}
            mcpServers={mcpServers}
            mcpLoadError={mcpLoadError}
            connectorApps={connectorApps}
            connectorSearchResults={connectorSearchResults}
            connectorActions={connectorActions}
            connectorGuide={connectorGuide}
            connectorInputSchema={connectorInputSchema}
            connectorExampleInput={connectorExampleInput}
            connectorActionDescription={connectorActionDescription}
            connectorLoadError={connectorLoadError}
            connectorSearchQuery={connectorSearchQuery}
            onConnectorSearchChange={loadConnectorSearch}
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
            vaultKeys={vaultKeys}
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
        existingPublications={a2aPublications}
        onClose={() => setA2aModalOpen(false)}
        onPublished={publishA2A}
      />

      <DesktopPackageModal
        open={desktopModalOpen}
        workflowId={workflow?.id}
        workflowName={workflow?.name}
        onClose={() => setDesktopModalOpen(false)}
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

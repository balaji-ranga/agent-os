import { useState, useEffect } from 'react';
import { Fragment } from 'react';
import { api } from '../api';
import { formatLocalDateTime } from '../utils/formatDateTime.js';

function parsePayload(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (_) {
    return str;
  }
}

function PayloadBlock({ label, data }) {
  const [open, setOpen] = useState(false);
  const obj = typeof data === 'string' ? parsePayload(data) : data;
  const str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const preview = typeof obj === 'object' && obj !== null
    ? (obj.url || obj.error || obj.summary || str.slice(0, 80) + (str.length > 80 ? '…' : ''))
    : str.slice(0, 80) + (str.length > 80 ? '…' : '');
  return (
    <div style={{ marginTop: '0.25rem' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontSize: '0.85rem',
          color: 'var(--accent)',
          textAlign: 'left',
        }}
      >
        {label}: {open ? '▼' : '▶'} {preview}
      </button>
      {open && (
        <pre
          style={{
            marginTop: '0.25rem',
            padding: '0.5rem',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: '0.8rem',
            overflow: 'auto',
            maxHeight: 200,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {str}
        </pre>
      )}
    </div>
  );
}

const DEFAULT_TEST_BODIES = {
  summarize_url: { url: 'https://example.com' },
  generate_image: { prompt: 'a sunset over mountains' },
  generate_video: { prompt: 'waves on a beach' },
  ibkr_gateway_ping: {},
  ibkr_config: {},
  ibkr_day_status: {},
  ibkr_account_snapshot: {},
  ibkr_preflight: {},
  ibkr_validate_plan: {
    plan: {
      trades: [
        {
          key: 'PAXOS:BTC',
          side: 'BUY',
          qty: 0.001,
          entry: 65000,
          stop: 63000,
          tp: 70000,
          rationale: 'UI smoke-test plan — dry-run unless IBKR_TRADING_ENABLED=1.',
        },
      ],
    },
  },
  ibkr_exit_candidates: { positions: [], max_hold_days: 5 },
  ibkr_record_hold: { key: 'PAXOS:BTC', extend_days: 1, review: { decision: 'HOLD' } },
  ibkr_record_holds_batch: { holds: [] },
  ibkr_reserve: { trades_to_place: [], residual: [] },
  ibkr_release: { reservation_id: 0, reason: 'ui-test' },
  ibkr_confirm_fill: { reservation_id: 0 },
  ibkr_place: { trades: [], dry_run: true, residual: [] },
  ibkr_portfolio_analytics: { days: 30, include_live: false },
  ibkr_fills_history: {},
  ibkr_pnl: {},
  ibkr_cash_events: {},
  ibkr_order_learnings: {
    days: 7,
    response_type: 'summarized',
    limit: 40,
    purpose: 'IBKR Maker order learnings (content-tools test)',
  },
  brain_history: {
    workflow_id: ['ibkr-maker-checker-paper', 'ibkr-position-poller-paper'],
    node_id: ['maker-1', 'checker-1', 'maker-exit', 'checker-exit'],
    days: 7,
    response_type: 'summarized',
    limit: 40,
    purpose: 'IBKR maker/checker Brain history (content-tools test)',
  },
  learnings_summary: { topic: 'workflow and trading preferences', days: 30 },
  content_tools_enquire: { query: 'summarize a web page', limit: 8 },
};

export default function ContentToolsLogs() {
  const [tools, setTools] = useState([]);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsError, setToolsError] = useState(null);
  const [testName, setTestName] = useState(null);
  const [testBody, setTestBody] = useState('{}');
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onboardForm, setOnboardForm] = useState({ name: '', display_name: '', endpoint: '', method: 'POST', purpose: '', model_used: '' });
  const [onboardSubmitting, setOnboardSubmitting] = useState(false);
  const [onboardError, setOnboardError] = useState(null);

  const [modelMapOpen, setModelMapOpen] = useState(false);
  const [modelMapLoading, setModelMapLoading] = useState(false);
  const [modelMapSaving, setModelMapSaving] = useState(false);
  const [modelMapError, setModelMapError] = useState(null);
  const [modelMapData, setModelMapData] = useState(null);
  /** @type {Record<string, string>} empty string = Profile default */
  const [modelMapDraft, setModelMapDraft] = useState({});
  /** tool name -> use free-text model field */
  const [modelMapCustom, setModelMapCustom] = useState({});

  const [rateMapOpen, setRateMapOpen] = useState(false);
  const [rateMapLoading, setRateMapLoading] = useState(false);
  const [rateMapSaving, setRateMapSaving] = useState(false);
  const [rateMapError, setRateMapError] = useState(null);
  const [rateMapData, setRateMapData] = useState(null);
  /** @type {Record<string, { max_calls_per_day: string, max_calls_per_month: string }>} */
  const [rateMapDraft, setRateMapDraft] = useState({});
  const [rateMapFilter, setRateMapFilter] = useState('');
  const [rateMapKind, setRateMapKind] = useState('');
  const [rateMapResetting, setRateMapResetting] = useState(null);
  const [rateMapAuditTool, setRateMapAuditTool] = useState(null);
  const [rateMapAuditRows, setRateMapAuditRows] = useState([]);
  const [rateMapAuditLoading, setRateMapAuditLoading] = useState(false);

  const [executionOpen, setExecutionOpen] = useState(false);
  const [executionLoading, setExecutionLoading] = useState(false);
  const [executionSaving, setExecutionSaving] = useState(false);
  const [executionError, setExecutionError] = useState(null);
  const [executionTools, setExecutionTools] = useState([]);
  const [executionFilter, setExecutionFilter] = useState('');

  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toolFilter, setToolFilter] = useState('');
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  const fetchTools = () => {
    setToolsLoading(true);
    setToolsError(null);
    api
      .contentToolsMeta()
      .then(({ tools: list }) => setTools(list || []))
      .catch((e) => setToolsError(e.message))
      .finally(() => setToolsLoading(false));
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const fetchLogs = () => {
    setLoading(true);
    setError(null);
    api
      .contentToolsLogs({ limit, offset, tool: toolFilter || undefined })
      .then(({ logs: nextLogs, total: nextTotal }) => {
        setLogs(nextLogs);
        setTotal(nextTotal);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
  }, [offset, toolFilter]);

  const handleToggleEnabled = (t) => {
    api
      .contentToolsMetaUpdate(t.name, { enabled: !t.enabled })
      .then(() => fetchTools())
      .catch((e) => setToolsError(e.message));
  };

  const openTest = (t) => {
    setTestName(t.name);
    setTestBody(JSON.stringify(DEFAULT_TEST_BODIES[t.name] || {}, null, 2));
    setTestResult(null);
  };

  const runTest = () => {
    if (!testName) return;
    let body = {};
    try {
      body = JSON.parse(testBody || '{}');
    } catch {
      setTestResult({ error: 'Invalid JSON' });
      return;
    }
    setTestLoading(true);
    setTestResult(null);
    api
      .contentToolsTest(testName, body)
      .then((data) => setTestResult(data))
      .catch((e) => setTestResult({ error: e.message }))
      .finally(() => setTestLoading(false));
  };

  const submitOnboard = () => {
    const { name, display_name, endpoint } = onboardForm;
    if (!name?.trim() || !endpoint?.trim()) {
      setOnboardError('Name and endpoint are required');
      return;
    }
    setOnboardSubmitting(true);
    setOnboardError(null);
    api
      .contentToolsMetaCreate({
        ...onboardForm,
        name: name.trim(),
        display_name: (display_name || name).trim(),
        endpoint: endpoint.trim(),
      })
      .then(() => {
        setOnboardOpen(false);
        setOnboardForm({ name: '', display_name: '', endpoint: '', method: 'POST', purpose: '', model_used: '' });
        fetchTools();
      })
      .catch((e) => setOnboardError(e.message))
      .finally(() => setOnboardSubmitting(false));
  };

  const openModelMap = () => {
    setModelMapOpen(true);
    setModelMapLoading(true);
    setModelMapError(null);
    api
      .contentToolsModelMappings()
      .then((data) => {
        setModelMapData(data);
        const draft = {};
        const custom = {};
        const opts = data.model_options || [];
        for (const t of data.tools || []) {
          const m = t.llm_model || '';
          draft[t.name] = m;
          if (m && !opts.some((o) => o.id === m)) custom[t.name] = true;
        }
        setModelMapDraft(draft);
        setModelMapCustom(custom);
      })
      .catch((e) => setModelMapError(e.message))
      .finally(() => setModelMapLoading(false));
  };

  const saveModelMap = () => {
    if (!modelMapData?.tools) return;
    setModelMapSaving(true);
    setModelMapError(null);
    const mappings = modelMapData.tools.map((t) => ({
      tool_name: t.name,
      llm_model: modelMapDraft[t.name] != null ? String(modelMapDraft[t.name]) : '',
    }));
    api
      .contentToolsModelMappingsSave(mappings)
      .then((data) => {
        setModelMapData(data);
        const draft = {};
        const custom = {};
        const opts = data.model_options || [];
        for (const t of data.tools || []) {
          const m = t.llm_model || '';
          draft[t.name] = m;
          if (m && !opts.some((o) => o.id === m)) custom[t.name] = true;
        }
        setModelMapDraft(draft);
        setModelMapCustom(custom);
      })
      .catch((e) => setModelMapError(e.message))
      .finally(() => setModelMapSaving(false));
  };

  const applyRateMapData = (data) => {
    setRateMapData(data);
    const draft = {};
    for (const t of data.tools || []) {
      draft[t.name] = {
        max_calls_per_day: t.max_calls_per_day != null && t.max_calls_per_day !== '' ? String(t.max_calls_per_day) : '',
        max_calls_per_month: t.max_calls_per_month != null && t.max_calls_per_month !== '' ? String(t.max_calls_per_month) : '',
      };
    }
    setRateMapDraft(draft);
  };

  const openRateMap = () => {
    setRateMapOpen(true);
    setRateMapLoading(true);
    setRateMapError(null);
    setRateMapAuditTool(null);
    api
      .contentToolsRateLimits()
      .then(applyRateMapData)
      .catch((e) => setRateMapError(e.message))
      .finally(() => setRateMapLoading(false));
  };

  const saveRateMap = () => {
    if (!rateMapData?.tools) return;
    setRateMapSaving(true);
    setRateMapError(null);
    const mappings = rateMapData.tools.map((t) => {
      const d = rateMapDraft[t.name] || {};
      return {
        tool_name: t.name,
        max_calls_per_day: d.max_calls_per_day === '' || d.max_calls_per_day == null ? '' : d.max_calls_per_day,
        max_calls_per_month: d.max_calls_per_month === '' || d.max_calls_per_month == null ? '' : d.max_calls_per_month,
      };
    });
    api
      .contentToolsRateLimitsSave(mappings)
      .then(applyRateMapData)
      .catch((e) => setRateMapError(e.message))
      .finally(() => setRateMapSaving(false));
  };

  const resetRateMapTool = (toolName, period) => {
    setRateMapResetting(`${toolName}:${period}`);
    setRateMapError(null);
    api
      .contentToolsRateLimitsReset(toolName, period)
      .then(applyRateMapData)
      .catch((e) => setRateMapError(e.message))
      .finally(() => setRateMapResetting(null));
  };

  const openRateMapAudit = (toolName) => {
    if (rateMapAuditTool === toolName) {
      setRateMapAuditTool(null);
      setRateMapAuditRows([]);
      return;
    }
    setRateMapAuditTool(toolName);
    setRateMapAuditLoading(true);
    api
      .contentToolsRateLimitResets({ tool: toolName, limit: 20 })
      .then((data) => setRateMapAuditRows(data.resets || []))
      .catch((e) => setRateMapError(e.message))
      .finally(() => setRateMapAuditLoading(false));
  };

  const openExecutionBehaviour = () => {
    setExecutionOpen(true);
    setExecutionLoading(true);
    setExecutionError(null);
    api.contentToolsExecutionBehaviour()
      .then((data) => setExecutionTools(data.tools || []))
      .catch((e) => setExecutionError(e.message))
      .finally(() => setExecutionLoading(false));
  };

  const saveExecutionBehaviour = () => {
    setExecutionSaving(true);
    setExecutionError(null);
    const mappings = executionTools.map((t) => ({
      tool_name: t.name,
      retry_limit: Number(t.retry_limit),
      timeout_ms: Number(t.timeout_ms),
      duplicate_window_sec: Number(t.duplicate_window_sec),
      verification_mode: t.verification_mode,
      fallback_capabilities: t.fallback_capabilities || [],
    }));
    api.contentToolsExecutionBehaviourSave(mappings)
      .then((data) => setExecutionTools(data.tools || []))
      .catch((e) => setExecutionError(e.message))
      .finally(() => setExecutionSaving(false));
  };

  if (toolsLoading && tools.length === 0) {
    return (
      <div style={{ padding: '2rem' }}>Loading…</div>
    );
  }

  return (
    <div className="page page-wide">
      <header className="page-hero">
        <div className="page-hero-top">
          <div className="page-hero-titles">
            <p className="page-hero-kicker">Company Tools · Tools</p>
            <h1>Tools</h1>
          </div>
        </div>
        <p className="page-hero-sub">
          Manage tools (endpoint, purpose, model), test them, enable/disable serving, and onboard new published endpoints. Restart the AgentSystem gateway after changes so AI employees see the updated list.
        </p>
      </header>

      {toolsError && (
        <div style={{ padding: '1rem', marginBottom: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: '#f87171' }}>
          {toolsError}
        </div>
      )}

      <section style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Tools registry</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={openModelMap}
              style={{
                padding: '0.4rem 0.75rem',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              Tools → Model
            </button>
            <button
              type="button"
              onClick={openRateMap}
              style={{
                padding: '0.4rem 0.75rem',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              Tools → Rate limits
            </button>
            <button
              type="button"
              onClick={openExecutionBehaviour}
              style={{
                padding: '0.4rem 0.75rem',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              Tools → Execution behaviour
            </button>
            <button
              type="button"
              onClick={() => setOnboardOpen(true)}
              style={{
                padding: '0.4rem 0.75rem',
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: '0.9rem',
              }}
            >
              Onboard new tool
            </button>
          </div>
        </div>

        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600 }}>Name</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600 }}>Endpoint</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600 }}>Purpose</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600 }}>Model</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600 }}>Serving</th>
                <th style={{ padding: '0.75rem 1rem', width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.name} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.6rem 1rem' }}>
                    <span style={{ fontWeight: 500 }}>{t.display_name || t.name}</span>
                    {t.is_builtin ? (
                      <span style={{ marginLeft: '0.35rem', fontSize: '0.75rem', color: 'var(--muted)' }}>built-in</span>
                    ) : null}
                  </td>
                  <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', fontSize: '0.85rem', wordBreak: 'break-all' }}>
                    <span style={{ color: 'var(--muted)', marginRight: '0.35rem' }}>{(t.method || 'POST').toUpperCase()}</span>
                    {t.endpoint || '—'}
                  </td>
                  <td style={{ padding: '0.6rem 1rem', color: 'var(--muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.purpose || ''}>{t.purpose || '—'}</td>
                  <td style={{ padding: '0.6rem 1rem', fontSize: '0.85rem' }}>{t.model_used || '—'}</td>
                  <td style={{ padding: '0.6rem 1rem' }}>
                    <button
                      type="button"
                      onClick={() => handleToggleEnabled(t)}
                      style={{
                        padding: '0.2rem 0.5rem',
                        borderRadius: 4,
                        fontSize: '0.8rem',
                        background: t.enabled ? 'rgba(34, 197, 94, 0.2)' : 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: t.enabled ? 'var(--accent)' : 'var(--muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {t.enabled ? 'On' : 'Off'}
                    </button>
                  </td>
                  <td style={{ padding: '0.6rem 1rem' }}>
                    <button
                      type="button"
                      disabled={!t.enabled}
                      onClick={() => openTest(t)}
                      style={{
                        padding: '0.25rem 0.5rem',
                        fontSize: '0.85rem',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        cursor: t.enabled ? 'pointer' : 'not-allowed',
                        color: 'var(--text)',
                      }}
                    >
                      Test
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tools.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
              No tools in registry. Onboard a new tool or ensure the backend has run the content tools seed.
            </div>
          )}
        </div>
      </section>

      {testName && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
          onClick={() => setTestName(null)}
        >
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '1.5rem',
              maxWidth: 480,
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Test: {testName}</h3>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Request body (JSON)</label>
            <textarea
              value={testBody}
              onChange={(e) => setTestBody(e.target.value)}
              rows={6}
              style={{
                width: '100%',
                padding: '0.5rem',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text)',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={runTest}
                disabled={testLoading}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: testLoading ? 'wait' : 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {testLoading ? 'Running…' : 'Run test'}
              </button>
              <button
                type="button"
                onClick={() => setTestName(null)}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--text)',
                }}
              >
                Close
              </button>
            </div>
            {testResult !== null && (
              <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <strong style={{ fontSize: '0.85rem' }}>Result</strong>
                <pre style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {typeof testResult === 'object' ? JSON.stringify(testResult, null, 2) : String(testResult)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {executionOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
          onClick={() => !executionSaving && setExecutionOpen(false)}
        >
          <div
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.5rem', width: '96%', maxWidth: 1120, maxHeight: '88vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Tools → Execution behaviour</h3>
            <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
              Platform recovery and verification rules. Agent access remains in AI Employees; approvals remain in Org Policy. Safe defaults apply until you save an override.
            </p>
            <input
              type="search"
              placeholder="Filter tools or capabilities…"
              value={executionFilter}
              onChange={(e) => setExecutionFilter(e.target.value)}
              style={{ width: '100%', maxWidth: 360, padding: '0.4rem 0.55rem', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: '0.75rem' }}
            />
            {executionError && <div style={{ color: '#f87171', marginBottom: '0.75rem' }}>{executionError}</div>}
            {executionLoading ? <div style={{ color: 'var(--muted)' }}>Loading…</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: 8 }}>Tool / capability</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Access</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Retry</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Timeout</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Duplicate guard</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Verification</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Fallback</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Health</th>
                  </tr></thead>
                  <tbody>
                    {executionTools.map((t, index) => {
                      const q = executionFilter.trim().toLowerCase();
                      if (q && !`${t.name} ${t.display_name} ${t.capability}`.toLowerCase().includes(q)) return null;
                      const update = (field, value) => setExecutionTools((rows) => rows.map((row, i) => i === index ? { ...row, [field]: value } : row));
                      const calls = Number(t.stats?.calls || 0);
                      return <tr key={t.name} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: 8, minWidth: 190 }}><strong>{t.display_name || t.name}</strong><div style={{ color: 'var(--muted)' }}>{t.name}</div><div style={{ color: 'var(--accent)' }}>{t.capability}</div></td>
                        <td style={{ padding: 8 }}>{t.access === 'mutating' ? 'Mutating' : 'Read-only'}</td>
                        <td style={{ padding: 8 }}><input aria-label={`${t.name} retry limit`} type="number" min="0" max="3" value={t.retry_limit} onChange={(e) => update('retry_limit', e.target.value)} style={{ width: 54, padding: 4 }} /></td>
                        <td style={{ padding: 8 }}><input aria-label={`${t.name} timeout milliseconds`} type="number" min="1000" max="600000" step="1000" value={t.timeout_ms} onChange={(e) => update('timeout_ms', e.target.value)} style={{ width: 92, padding: 4 }} /></td>
                        <td style={{ padding: 8 }}><input aria-label={`${t.name} duplicate window seconds`} type="number" min="0" max="86400" value={t.duplicate_window_sec} onChange={(e) => update('duplicate_window_sec', e.target.value)} style={{ width: 78, padding: 4 }} /> sec</td>
                        <td style={{ padding: 8 }}><select value={t.verification_mode} onChange={(e) => update('verification_mode', e.target.value)} style={{ padding: 4 }}><option value="none">None</option><option value="evidence_coverage">Evidence</option><option value="read_back_or_receipt">Read-back / receipt</option></select></td>
                        <td style={{ padding: 8, minWidth: 170, color: 'var(--muted)' }}>{(t.fallback_capabilities || []).join(' → ') || 'Clarify'}</td>
                        <td style={{ padding: 8 }}>{calls ? `${t.stats.successes}/${calls} ok` : 'No calls'}{t.stats?.duplicates_prevented ? <div>{t.stats.duplicates_prevented} duplicate prevented</div> : null}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" onClick={saveExecutionBehaviour} disabled={executionLoading || executionSaving} style={{ padding: '0.45rem 0.8rem', background: 'var(--accent)', color: '#fff', border: 0, borderRadius: 6 }}>{executionSaving ? 'Saving…' : 'Save behaviour'}</button>
              <button type="button" onClick={() => setExecutionOpen(false)} disabled={executionSaving} style={{ padding: '0.45rem 0.8rem', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6 }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {modelMapOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
          onClick={() => !modelMapSaving && setModelMapOpen(false)}
        >
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '1.5rem',
              maxWidth: 720,
              width: '94%',
              maxHeight: '85vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Tools → Model mapping</h3>
            <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
              Override the model used for each BYOK-aware tool. Keys and base URL still follow your Profile
              (platform default or BYOK). Empty / Profile default uses your Profile primary model
              {modelMapData?.profile_model ? ` (${modelMapData.profile_model})` : ''}.
              Excludes custom-script review and master-data embeddings.
            </p>
            {modelMapData && (
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 0 }}>
                Provider: {modelMapData.provider || '—'}
                {modelMapData.using_byok ? ' · BYOK' : ' · platform'}
              </p>
            )}
            {modelMapError && (
              <div style={{ marginBottom: '0.75rem', color: '#f87171', fontSize: '0.9rem' }}>{modelMapError}</div>
            )}
            {modelMapLoading ? (
              <div style={{ padding: '1rem', color: 'var(--muted)' }}>Loading…</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Tool</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Kind</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem', minWidth: 220 }}>Model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(modelMapData?.tools || []).map((t) => {
                      const value = modelMapDraft[t.name] ?? '';
                      const options = modelMapData?.model_options || [];
                      const useCustom = !!modelMapCustom[t.name];
                      const selectValue = useCustom ? '__custom__' : value;
                      const placeholder =
                        t.kind === 'video'
                          ? 'Replicate model:owner or version id'
                          : t.kind === 'image'
                            ? 'e.g. gpt-image-1'
                            : 'model id';
                      return (
                        <tr key={t.name} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '0.5rem', verticalAlign: 'top' }}>
                            <div style={{ fontWeight: 500 }}>{t.label || t.name}</div>
                            <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{t.name}</div>
                            {t.description ? (
                              <div style={{ color: 'var(--muted)', fontSize: '0.75rem', maxWidth: 220 }}>{t.description}</div>
                            ) : null}
                          </td>
                          <td style={{ padding: '0.5rem', color: 'var(--muted)', verticalAlign: 'top' }}>{t.kind}</td>
                          <td style={{ padding: '0.5rem', verticalAlign: 'top' }}>
                            <select
                              value={selectValue}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '__custom__') {
                                  setModelMapCustom((c) => ({ ...c, [t.name]: true }));
                                  return;
                                }
                                setModelMapCustom((c) => {
                                  const next = { ...c };
                                  delete next[t.name];
                                  return next;
                                });
                                setModelMapDraft((d) => ({ ...d, [t.name]: v }));
                              }}
                              style={{
                                width: '100%',
                                padding: '0.35rem',
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: 6,
                                color: 'var(--text)',
                                marginBottom: useCustom ? 4 : 0,
                              }}
                            >
                              <option value="">
                                Profile default{modelMapData?.profile_model ? ` (${modelMapData.profile_model})` : ''}
                              </option>
                              {options.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.label || m.id}
                                </option>
                              ))}
                              <option value="__custom__">Custom…</option>
                            </select>
                            {useCustom ? (
                              <input
                                type="text"
                                value={value}
                                placeholder={placeholder}
                                onChange={(e) =>
                                  setModelMapDraft((d) => ({ ...d, [t.name]: e.target.value }))
                                }
                                style={{
                                  width: '100%',
                                  padding: '0.35rem',
                                  fontFamily: 'monospace',
                                  fontSize: '0.8rem',
                                  background: 'var(--surface)',
                                  border: '1px solid var(--border)',
                                  borderRadius: 6,
                                  color: 'var(--text)',
                                  boxSizing: 'border-box',
                                }}
                              />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={saveModelMap}
                disabled={modelMapLoading || modelMapSaving || !modelMapData}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: modelMapSaving ? 'wait' : 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {modelMapSaving ? 'Saving…' : 'Save mappings'}
              </button>
              <button
                type="button"
                onClick={() => setModelMapOpen(false)}
                disabled={modelMapSaving}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--text)',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {rateMapOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
          onClick={() => !rateMapSaving && !rateMapResetting && setRateMapOpen(false)}
        >
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '1.5rem',
              maxWidth: 980,
              width: '96%',
              maxHeight: '88vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Tools → Rate limits</h3>
            <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
              Per-user call budgets for tools that use API keys or external tokens. Empty = unlimited.
              Actuals reset automatically at day/month end ({rateMapData?.tz || 'UTC'}) and are audited
              (budget vs used) before zeroing. Agent token budgets are unchanged — this is on top.
              When a cap is hit, the agent gets a failure and should try Browser Session / Playwright.
            </p>
            {rateMapData && (
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 0 }}>
                Period: {rateMapData.day} · month {rateMapData.month}
              </p>
            )}
            {rateMapError && (
              <div style={{ marginBottom: '0.75rem', color: '#f87171', fontSize: '0.9rem' }}>{rateMapError}</div>
            )}
            {rateMapLoading ? (
              <div style={{ padding: '1rem', color: 'var(--muted)' }}>Loading…</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  <input
                    type="search"
                    placeholder="Filter tools…"
                    value={rateMapFilter}
                    onChange={(e) => setRateMapFilter(e.target.value)}
                    style={{
                      flex: '1 1 180px',
                      padding: '0.35rem 0.5rem',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      color: 'var(--text)',
                    }}
                  />
                  <select
                    value={rateMapKind}
                    onChange={(e) => setRateMapKind(e.target.value)}
                    style={{
                      padding: '0.35rem 0.5rem',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      color: 'var(--text)',
                    }}
                  >
                    <option value="">All kinds</option>
                    {[...new Set((rateMapData?.tools || []).map((t) => t.kind).filter(Boolean))]
                      .sort()
                      .map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                  </select>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ textAlign: 'left', padding: '0.45rem' }}>Tool</th>
                        <th style={{ textAlign: 'left', padding: '0.45rem' }}>Kind</th>
                        <th style={{ textAlign: 'left', padding: '0.45rem', minWidth: 90 }}>Max / day</th>
                        <th style={{ textAlign: 'left', padding: '0.45rem', minWidth: 90 }}>Max / month</th>
                        <th style={{ textAlign: 'left', padding: '0.45rem' }}>Used today</th>
                        <th style={{ textAlign: 'left', padding: '0.45rem' }}>Used month</th>
                        <th style={{ textAlign: 'left', padding: '0.45rem' }}>Reset</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(rateMapData?.tools || [])
                        .filter((t) => {
                          if (rateMapKind && t.kind !== rateMapKind) return false;
                          const q = rateMapFilter.trim().toLowerCase();
                          if (!q) return true;
                          return [t.name, t.label, t.provider, t.description, t.kind]
                            .join(' ')
                            .toLowerCase()
                            .includes(q);
                        })
                        .map((t) => {
                          const draft = rateMapDraft[t.name] || { max_calls_per_day: '', max_calls_per_month: '' };
                          const dayBusy = rateMapResetting === `${t.name}:day`;
                          const monthBusy = rateMapResetting === `${t.name}:month`;
                          const bothBusy = rateMapResetting === `${t.name}:both`;
                          return (
                            <Fragment key={t.name}>
                              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '0.45rem', verticalAlign: 'top' }}>
                                  <div style={{ fontWeight: 500 }}>{t.label || t.name}</div>
                                  <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{t.name}</div>
                                  <div style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>{t.provider}</div>
                                </td>
                                <td style={{ padding: '0.45rem', color: 'var(--muted)', verticalAlign: 'top' }}>{t.kind}</td>
                                <td style={{ padding: '0.45rem', verticalAlign: 'top' }}>
                                  <input
                                    type="number"
                                    min="0"
                                    placeholder="∞"
                                    value={draft.max_calls_per_day}
                                    onChange={(e) =>
                                      setRateMapDraft((d) => ({
                                        ...d,
                                        [t.name]: { ...draft, max_calls_per_day: e.target.value },
                                      }))
                                    }
                                    style={{
                                      width: 88,
                                      padding: '0.3rem',
                                      background: 'var(--surface)',
                                      border: '1px solid var(--border)',
                                      borderRadius: 6,
                                      color: 'var(--text)',
                                    }}
                                  />
                                </td>
                                <td style={{ padding: '0.45rem', verticalAlign: 'top' }}>
                                  <input
                                    type="number"
                                    min="0"
                                    placeholder="∞"
                                    value={draft.max_calls_per_month}
                                    onChange={(e) =>
                                      setRateMapDraft((d) => ({
                                        ...d,
                                        [t.name]: { ...draft, max_calls_per_month: e.target.value },
                                      }))
                                    }
                                    style={{
                                      width: 88,
                                      padding: '0.3rem',
                                      background: 'var(--surface)',
                                      border: '1px solid var(--border)',
                                      borderRadius: 6,
                                      color: 'var(--text)',
                                    }}
                                  />
                                </td>
                                <td style={{ padding: '0.45rem', verticalAlign: 'top' }}>
                                  {t.calls_today || 0}
                                  {t.max_calls_per_day ? ` / ${t.max_calls_per_day}` : ''}
                                </td>
                                <td style={{ padding: '0.45rem', verticalAlign: 'top' }}>
                                  {t.calls_this_month || 0}
                                  {t.max_calls_per_month ? ` / ${t.max_calls_per_month}` : ''}
                                </td>
                                <td style={{ padding: '0.45rem', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                  <button
                                    type="button"
                                    disabled={!!rateMapResetting || !t.limited}
                                    onClick={() => resetRateMapTool(t.name, 'day')}
                                    title="Audit then zero today's actuals"
                                    style={{
                                      marginRight: 4,
                                      padding: '0.2rem 0.4rem',
                                      fontSize: '0.75rem',
                                      background: 'var(--surface)',
                                      border: '1px solid var(--border)',
                                      borderRadius: 4,
                                      color: 'var(--text)',
                                      cursor: t.limited ? 'pointer' : 'not-allowed',
                                    }}
                                  >
                                    {dayBusy ? '…' : 'Day'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!!rateMapResetting || !t.limited}
                                    onClick={() => resetRateMapTool(t.name, 'month')}
                                    title="Audit then zero this month's actuals"
                                    style={{
                                      marginRight: 4,
                                      padding: '0.2rem 0.4rem',
                                      fontSize: '0.75rem',
                                      background: 'var(--surface)',
                                      border: '1px solid var(--border)',
                                      borderRadius: 4,
                                      color: 'var(--text)',
                                      cursor: t.limited ? 'pointer' : 'not-allowed',
                                    }}
                                  >
                                    {monthBusy ? '…' : 'Month'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!!rateMapResetting || !t.limited}
                                    onClick={() => resetRateMapTool(t.name, 'both')}
                                    title="Audit then zero day and month actuals"
                                    style={{
                                      marginRight: 4,
                                      padding: '0.2rem 0.4rem',
                                      fontSize: '0.75rem',
                                      background: 'var(--surface)',
                                      border: '1px solid var(--border)',
                                      borderRadius: 4,
                                      color: 'var(--text)',
                                      cursor: t.limited ? 'pointer' : 'not-allowed',
                                    }}
                                  >
                                    {bothBusy ? '…' : 'Both'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openRateMapAudit(t.name)}
                                    style={{
                                      padding: '0.2rem 0.4rem',
                                      fontSize: '0.75rem',
                                      background: 'none',
                                      border: 'none',
                                      color: 'var(--accent)',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {rateMapAuditTool === t.name ? 'Hide audit' : 'Audit'}
                                  </button>
                                </td>
                              </tr>
                              {rateMapAuditTool === t.name ? (
                                <tr>
                                  <td colSpan={7} style={{ padding: '0.4rem 0.45rem 0.8rem', background: 'var(--surface)' }}>
                                    {rateMapAuditLoading ? (
                                      <span style={{ color: 'var(--muted)' }}>Loading audit…</span>
                                    ) : rateMapAuditRows.length === 0 ? (
                                      <span style={{ color: 'var(--muted)' }}>No resets recorded yet.</span>
                                    ) : (
                                      <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
                                        <thead>
                                          <tr>
                                            <th style={{ textAlign: 'left', padding: '0.2rem' }}>When</th>
                                            <th style={{ textAlign: 'left', padding: '0.2rem' }}>Kind</th>
                                            <th style={{ textAlign: 'left', padding: '0.2rem' }}>Budget day/month</th>
                                            <th style={{ textAlign: 'left', padding: '0.2rem' }}>Actuals day/month</th>
                                            <th style={{ textAlign: 'left', padding: '0.2rem' }}>By</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {rateMapAuditRows.map((r) => (
                                            <tr key={r.id}>
                                              <td style={{ padding: '0.2rem' }}>{formatLocalDateTime(r.created_at)}</td>
                                              <td style={{ padding: '0.2rem' }}>{r.reset_kind}</td>
                                              <td style={{ padding: '0.2rem' }}>
                                                {r.budget_max_day ?? '∞'} / {r.budget_max_month ?? '∞'}
                                              </td>
                                              <td style={{ padding: '0.2rem' }}>
                                                {r.actuals_day ?? 0} / {r.actuals_month ?? 0}
                                              </td>
                                              <td style={{ padding: '0.2rem' }}>{r.reset_by || '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={saveRateMap}
                disabled={rateMapLoading || rateMapSaving || !rateMapData}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: rateMapSaving ? 'wait' : 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {rateMapSaving ? 'Saving…' : 'Save limits'}
              </button>
              <button
                type="button"
                onClick={() => setRateMapOpen(false)}
                disabled={rateMapSaving || !!rateMapResetting}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--text)',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {onboardOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
          onClick={() => !onboardSubmitting && setOnboardOpen(false)}
        >
          <div
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '1.5rem',
              maxWidth: 480,
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Onboard new tool</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
              Add a published endpoint. It will be registered in the registry and in AgentSystem (after gateway restart). Use full URL for external endpoints.
            </p>
            {onboardError && (
              <div style={{ padding: '0.5rem', marginBottom: '1rem', background: 'rgba(248,113,113,0.15)', borderRadius: 6, color: '#f87171', fontSize: '0.9rem' }}>
                {onboardError}
              </div>
            )}
            {['name', 'display_name', 'endpoint', 'method', 'purpose', 'model_used'].map((key) => (
              <label key={key} style={{ display: 'block', marginBottom: '0.75rem' }}>
                <span style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem', color: 'var(--muted)' }}>
                  {key.replace('_', ' ')}
                </span>
                <input
                  type="text"
                  value={onboardForm[key] || ''}
                  onChange={(e) => setOnboardForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={key === 'endpoint' ? 'https://api.example.com/run or /api/tools/...' : ''}
                  style={{
                    width: '100%',
                    padding: '0.4rem 0.5rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text)',
                    boxSizing: 'border-box',
                  }}
                />
              </label>
            ))}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={submitOnboard}
                disabled={onboardSubmitting}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: onboardSubmitting ? 'wait' : 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {onboardSubmitting ? 'Adding…' : 'Add tool'}
              </button>
              <button
                type="button"
                onClick={() => !onboardSubmitting && setOnboardOpen(false)}
                style={{
                  padding: '0.4rem 0.75rem',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--text)',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <section>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>Invocation logs</h2>
        {error && (
          <div style={{ padding: '1rem', marginBottom: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: '#f87171' }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Tool</span>
            <select
              value={toolFilter}
              onChange={(e) => { setToolFilter(e.target.value); setOffset(0); }}
              style={{
                padding: '0.4rem 0.75rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text)',
              }}
            >
              <option value="">All</option>
              {tools.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => fetchLogs()}
            style={{
              padding: '0.4rem 0.75rem',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Refresh
          </button>
          <button
            type="button"
            title="Remove old or all API logs"
            disabled={cleanupLoading || total === 0}
            onClick={() => {
              if (!window.confirm('Delete logs older than 7 days? (Cancel to abort)')) return;
              setCleanupLoading(true);
              api.contentToolsLogsCleanup({ older_than_days: 7 })
                .then(({ deleted }) => {
                  if (deleted != null) fetchLogs();
                })
                .catch((e) => setError(e.message))
                .finally(() => setCleanupLoading(false));
            }}
            style={{
              padding: '0.4rem 0.75rem',
              background: 'var(--surface)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              cursor: cleanupLoading || total === 0 ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
            }}
          >
            {cleanupLoading ? '…' : 'Cleanup (older than 7 days)'}
          </button>
          <button
            type="button"
            title="Delete all logs"
            disabled={cleanupLoading || total === 0}
            onClick={() => {
              if (!window.confirm('Delete ALL invocation logs? This cannot be undone.')) return;
              setCleanupLoading(true);
              api.contentToolsLogsCleanup({ all: true })
                .then(({ deleted }) => {
                  if (deleted != null) fetchLogs();
                })
                .catch((e) => setError(e.message))
                .finally(() => setCleanupLoading(false));
            }}
            style={{
              padding: '0.4rem 0.75rem',
              background: 'var(--surface)',
              color: '#e11',
              border: '1px solid var(--border)',
              borderRadius: 6,
              cursor: cleanupLoading || total === 0 ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Delete all logs
          </button>
          <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
            {total} log{total !== 1 ? 's' : ''}
          </span>
        </div>

        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {logs.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
              No content tool calls yet. Invocations will appear here.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600 }}>Time</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600 }}>Tool</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600 }}>Source</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem', width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {logs.map((row) => (
                  <Fragment key={row.id}>
                    <tr
                      style={{
                        borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                        background: expandedId === row.id ? 'var(--surface)' : undefined,
                      }}
                      onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                    >
                      <td style={{ padding: '0.6rem 1rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
                        {row.created_at ? formatLocalDateTime(row.created_at) : '—'}
                      </td>
                      <td style={{ padding: '0.6rem 1rem' }}>{row.tool_name || '—'}</td>
                      <td style={{ padding: '0.6rem 1rem', color: 'var(--muted)' }}>{row.source || '—'}</td>
                      <td style={{ padding: '0.6rem 1rem' }}>
                        <span
                          style={{
                            padding: '0.2rem 0.5rem',
                            borderRadius: 4,
                            fontSize: '0.8rem',
                            background: row.status === 'ok' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(248, 113, 113, 0.15)',
                            color: row.status === 'ok' ? 'var(--accent)' : '#f87171',
                          }}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 1rem' }}>{expandedId === row.id ? '▼' : '▶'}</td>
                    </tr>
                    {expandedId === row.id && (
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={5} style={{ padding: '0.75rem 1rem', background: 'var(--surface)', verticalAlign: 'top' }}>
                          <PayloadBlock label="Request" data={row.request_payload} />
                          <PayloadBlock label="Response" data={row.response_payload} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {total > limit && (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              style={{
                padding: '0.4rem 0.75rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: offset === 0 ? 'not-allowed' : 'pointer',
                color: 'var(--text)',
              }}
            >
              Previous
            </button>
            <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
              {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </span>
            <button
              type="button"
              disabled={offset + limit >= total}
              onClick={() => setOffset((o) => o + limit)}
              style={{
                padding: '0.4rem 0.75rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                cursor: offset + limit >= total ? 'not-allowed' : 'pointer',
                color: 'var(--text)',
              }}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

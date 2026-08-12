import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  A2A_ENQUIRE_INPUT_SAMPLE,
  A2A_ENQUIRE_RESPONSE_SAMPLE,
  ENQUIRE_SKILL_ID,
  buildA2ATestSample,
} from '../utils/a2aTestSample';
import AddToOrgDialog from '../components/AddToOrgDialog';
import RobotAvatar from '../components/RobotAvatar.jsx';

/** Inline ⋯ menu for AgentExchange card actions (keeps the card uncluttered). */
function CardActionsMenu({ items }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const visible = (items || []).filter((it) => it && !it.hidden);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!visible.length) return null;

  return (
    <div className="mcp-pg-card-menu" ref={rootRef}>
      <button
        type="button"
        className="mcp-pg-card-menu-btn"
        aria-label="Agent actions"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div className="mcp-pg-card-menu-dropdown" role="menu">
          {visible.map((it) => {
            const closeAndRun = () => {
              setOpen(false);
              it.onClick?.();
            };
            if (it.href) {
              return (
                <a
                  key={it.id}
                  role="menuitem"
                  className={`mcp-pg-card-menu-item${it.danger ? ' danger' : ''}`}
                  href={it.href}
                  target={it.external ? '_blank' : undefined}
                  rel={it.external ? 'noreferrer' : undefined}
                  onClick={() => setOpen(false)}
                >
                  {it.label}
                </a>
              );
            }
            return (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                className={`mcp-pg-card-menu-item${it.danger ? ' danger' : ''}`}
                disabled={it.disabled}
                onClick={closeAndRun}
              >
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Sample Flolah async A2A callback body (not A2A JSON-RPC). */
export const A2A_CALLBACK_JSON_SAMPLE = {
  event: 'a2a.workflow.completed',
  task_id: '<uuid from async accept>',
  publish_id: '<a2a publish id>',
  final_output: 'Final step output text',
  run: {
    run_id: 123,
    status: 'completed',
    progress_pct: 100,
    error_message: null,
    started_at: '…',
    completed_at: '…',
    steps: [{ node_id: '…', node_type: '…', status: 'completed' }],
  },
  status: { state: 'completed' },
};

function isAsyncAgent(a) {
  return (
    a?.invoke_mode === 'async' ||
    a?.agent_card?.metadata?.invokeMode === 'async' ||
    (a?.agent_card?.skills || []).some((s) => s?.id === ENQUIRE_SKILL_ID)
  );
}

function hasCallback(a) {
  return !!(a?.callback_url || a?.agent_card?.capabilities?.pushNotifications);
}

function JsonSampleTip({ title, note, sample, ariaLabel, align = 'left' }) {
  const [open, setOpen] = useState(false);
  const text = useMemo(
    () => (typeof sample === 'string' ? sample : JSON.stringify(sample, null, 2)),
    [sample]
  );

  return (
    <span className={`a2a-callback-tip a2a-tip-align-${align}`}>
      <button
        type="button"
        className="a2a-callback-tip-btn"
        aria-label={ariaLabel || title}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        i
      </button>
      {open && (
        <div className="a2a-callback-tip-pop" role="dialog" aria-label={title}>
          <div className="a2a-callback-tip-pop-head">
            <strong>{title}</strong>
            <button
              type="button"
              className="a2a-callback-tip-close"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {note ? <p className="a2a-callback-tip-note">{note}</p> : null}
          <pre className="a2a-callback-tip-pre">{text}</pre>
        </div>
      )}
    </span>
  );
}

function CallbackTip({ agent }) {
  const sample = useMemo(
    () => ({
      ...A2A_CALLBACK_JSON_SAMPLE,
      ...(agent?.callback_url
        ? { _note: `Flolah POSTs this JSON to your callback URL (${agent.callback_url}).` }
        : {
            _note:
              'Optional: set a callback URL at publish time or per-invoke via params.metadata.callbackUrl. Events: a2a.workflow.completed | failed | cancelled.',
          }),
    }),
    [agent?.callback_url]
  );

  return (
    <JsonSampleTip
      title="Async callback JSON"
      ariaLabel="Callback JSON sample"
      note={
        <>
          Flolah POSTs this webhook body when the run finishes (<strong>not</strong> an A2A JSON-RPC
          envelope). Also poll <code>tasks/get</code> or skill <code>{ENQUIRE_SKILL_ID}</code>.
          {agent?.callback_url ? (
            <>
              {' '}
              Configured: <code>{agent.callback_url}</code>
            </>
          ) : (
            <> No callback URL on this listing yet — enquiry still works.</>
          )}
        </>
      }
      sample={sample}
    />
  );
}

function PublishInfoTip({ agent }) {
  const published = agent?.published_at
    ? new Date(String(agent.published_at).includes('T') ? agent.published_at : `${agent.published_at}Z`)
    : null;
  const dateLabel =
    published && !Number.isNaN(published.getTime())
      ? published.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
      : agent?.published_at || 'Unknown';
  const kind = agent?.listing_kind === 'agent' ? 'AI employee' : 'Workflow A2A';
  const vis =
    agent?.listing_kind === 'agent'
      ? agent.visibility === 'public'
        ? 'Public (internet A2A)'
        : 'Flolah (in-app only)'
      : agent?.visibility === 'private'
        ? 'Private (org only)'
        : 'Public';
  return (
    <JsonSampleTip
      title="Listing info"
      ariaLabel="Published by and date"
      note={
        <>
          <strong>{kind}</strong>
          <br />
          Published by {agent?.owner_name || agent?.owner_email || 'Unknown'}
          <br />
          Published {dateLabel}
          <br />
          Visibility: {vis}
        </>
      }
      sample={{
        listing_kind: agent?.listing_kind || 'workflow',
        published_by: agent?.owner_name || agent?.owner_email || null,
        published_at: agent?.published_at || null,
        visibility: agent?.visibility || null,
      }}
    />
  );
}

function EnquireTip() {
  return (
    <JsonSampleTip
      title="Enquire progress — input & response"
      ariaLabel="Enquiry sample input and response"
      note={
        <>
          After an async <code>message/send</code>, poll with skill <code>{ENQUIRE_SKILL_ID}</code>{' '}
          (or JSON-RPC <code>tasks/get</code>) using <code>taskId</code> from{' '}
          <code>result.task.id</code>. Optional alternative: <code>runId</code>.
        </>
      }
      sample={{
        input_message_send: {
          skillId: ENQUIRE_SKILL_ID,
          input: A2A_ENQUIRE_INPUT_SAMPLE,
        },
        or_jsonrpc_tasks_get: {
          jsonrpc: '2.0',
          id: '1',
          method: 'tasks/get',
          params: { id: '<taskId>' },
        },
        sample_response: A2A_ENQUIRE_RESPONSE_SAMPLE,
      }}
    />
  );
}

function AgentAccessControls({ agent, open, onClose, onChanged }) {
  const [settings, setSettings] = useState(null);
  const [rule, setRule] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await api.agentExchangeAccessGet(agent.id);
      setSettings(next);
    } catch (e) {
      setError(e.message || 'Failed to load access settings');
    }
  }, [agent.id]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  const setPolicy = async (policy) => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.agentExchangeAccessSet(agent.id, policy);
      setSettings(next);
      await onChanged();
    } catch (e) {
      setError(e.message || 'Failed to update access policy');
    } finally {
      setSaving(false);
    }
  };

  const setVisibility = async (visibility) => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.agentExchangeVisibilitySet(agent.id, visibility);
      setSettings(next);
      await onChanged();
    } catch (e) {
      setError(e.message || 'Failed to update visibility');
    } finally {
      setSaving(false);
    }
  };

  const addRule = async (e) => {
    e.preventDefault();
    if (!rule.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api.agentExchangeIpAdd(agent.id, {
        cidr_or_ip: rule.trim(),
        label: label.trim(),
      });
      setSettings(next);
      setRule('');
      setLabel('');
      if (next.access_policy !== 'whitelist') {
        const enabled = await api.agentExchangeAccessSet(agent.id, 'whitelist');
        setSettings(enabled);
      }
      await onChanged();
    } catch (e) {
      setError(e.message || 'Failed to add IP/CIDR');
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (entryId) => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.agentExchangeIpRemove(agent.id, entryId);
      setSettings(next);
    } catch (e) {
      setError(e.message || 'Failed to remove IP/CIDR');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const policy = settings?.access_policy || agent.access_policy || 'deny_all';
  const visibility = settings?.visibility || agent.visibility || 'public';
  const isPrivate = visibility === 'private';

  return (
    <div className="a2a-access-controls">
      <div className="a2a-access-panel">
        <div className="a2a-panel-head">
          <strong>Security</strong>
          {onClose ? (
            <button type="button" className="mcp-pg-btn-ghost mcp-pg-btn-sm" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
        <p className="a2a-access-help">
          Public (default) lists the agent on AgentExchange for other CEOs. Private disables all
          public calling — only the COO or the org reports-to lead can invoke (after Add to org).
          Owner Test agent still works.
        </p>
        {error && <div className="mcp-pg-alert mcp-pg-alert-error">{error}</div>}
        {!settings ? (
          <p className="a2a-access-help">Loading…</p>
        ) : (
          <>
            <strong>Visibility</strong>
            <div className="a2a-access-options">
              {[
                ['public', 'Public'],
                ['private', 'Private (org only)'],
              ].map(([value, text]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`a2a-visibility-${agent.id}`}
                    checked={visibility === value}
                    onChange={() => setVisibility(value)}
                    disabled={saving}
                  />
                  <span>{text}</span>
                </label>
              ))}
            </div>

            <strong style={{ display: 'block', marginTop: '0.85rem' }}>Public endpoint access</strong>
            {isPrivate ? (
              <p className="a2a-access-help">
                Visibility is Private — public card / invoke / OAuth / enquiry are always denied.
                IP policy below applies only after you switch back to Public.
              </p>
            ) : (
              <p className="a2a-access-help">
                New agents deny all by default. This policy protects the card, invoke, OAuth token
                and enquiry endpoints. Whitelist IPs are stored centrally (
                <Link to="/settings/ip-whitelists">Settings → IP Whitelists</Link>) with the A2A
                flag.
              </p>
            )}
            <div className="a2a-access-options">
              {[
                ['deny_all', 'Deny all'],
                ['allow_all', 'Allow all'],
                ['whitelist', 'IP whitelist'],
              ].map(([value, text]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`a2a-access-${agent.id}`}
                    checked={policy === value}
                    onChange={() => setPolicy(value)}
                    disabled={saving || isPrivate}
                  />
                  <span>{text}</span>
                </label>
              ))}
            </div>

            {!isPrivate && policy === 'whitelist' && (
              <>
                {settings.current_ip && (
                  <div className="a2a-access-current">
                    Current IP: <code>{settings.current_ip}</code>{' '}
                    <button
                      type="button"
                      className="mcp-pg-btn-ghost mcp-pg-btn-sm"
                      onClick={() => setRule(settings.current_ip)}
                    >
                      Use
                    </button>
                  </div>
                )}
                <form className="a2a-access-add" onSubmit={addRule}>
                  <input
                    value={rule}
                    onChange={(e) => setRule(e.target.value)}
                    placeholder="IP or IPv4 CIDR, e.g. 203.0.113.10"
                    required
                  />
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Label (optional)"
                  />
                  <button
                    type="submit"
                    className="mcp-pg-btn-primary mcp-pg-btn-sm"
                    disabled={saving || !rule.trim()}
                  >
                    Add
                  </button>
                </form>
                <div className="a2a-access-rules">
                  {(settings.entries || []).length ? (
                    settings.entries.map((entry) => (
                      <div key={entry.id} className="a2a-access-rule">
                        <span>
                          <code>{entry.cidr_or_ip}</code>
                          {entry.label ? ` — ${entry.label}` : ''}
                        </span>
                        <button
                          type="button"
                          className="mcp-pg-btn-ghost mcp-pg-btn-sm"
                          onClick={() => removeRule(entry.id)}
                          disabled={saving}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="a2a-access-help">
                      Empty whitelist — all public requests are denied.
                    </p>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AgentTestPanel({ agent, open, onClose }) {
  const seed = useMemo(() => buildA2ATestSample(agent), [agent]);
  const [skillId, setSkillId] = useState(seed.skillId);
  const [inputText, setInputText] = useState(
    seed.mode === 'json' ? JSON.stringify(seed.value, null, 2) : String(seed.value)
  );
  const [inputHelp, setInputHelp] = useState(seed.help || '');
  const [accessToken, setAccessToken] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [meta, setMeta] = useState(null);

  const skills = useMemo(() => {
    const fromCard = (agent?.agent_card?.skills || [])
      .filter((s) => s?.id)
      .map((s) => ({
        id: s.id,
        name: s.name || s.id,
        description: s.description || '',
      }));
    if (fromCard.length) return fromCard;
    return [{ id: agent?.skill_id || 'default', name: agent?.skill_id || 'default', description: '' }];
  }, [agent]);

  const isEnquire = skillId === ENQUIRE_SKILL_ID;
  const selectedSkill = skills.find((s) => s.id === skillId) || null;

  const applySample = (nextSkillId) => {
    const next = buildA2ATestSample(agent, nextSkillId);
    setSkillId(next.skillId);
    setInputHelp(next.help || '');
    setInputText(
      next.mode === 'json' ? JSON.stringify(next.value, null, 2) : String(next.value)
    );
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setError(null);
      setResult(null);
      try {
        const sample = await api.agentExchangeTestSample(agent.id);
        if (cancelled) return;
        setMeta(sample);
        const sid = sample.skill_id || seed.skillId;
        applySample(sid);
        if (sample.help) setInputHelp(sample.help);
        if (sample.mode === 'json' || sample.sample != null) {
          setInputText(
            sample.mode === 'json'
              ? JSON.stringify(sample.sample, null, 2)
              : String(sample.sample ?? '')
          );
        }
      } catch (_) {
        if (!cancelled) applySample(seed.skillId);
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload sample when panel opens
  }, [open, agent.id]);

  const runTest = async (e) => {
    e?.preventDefault?.();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let input = inputText;
      const trimmed = String(inputText || '').trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          input = JSON.parse(trimmed);
        } catch (parseErr) {
          throw new Error(`Invalid JSON input: ${parseErr.message}`);
        }
      }
      if (
        isEnquire &&
        input &&
        typeof input === 'object' &&
        String(input.taskId || '').includes('<')
      ) {
        throw new Error(
          'Replace taskId with the real UUID from the async accept (result.task.id). Run the primary skill first if you do not have one yet.'
        );
      }
      const body = {
        skillId,
        input,
      };
      if (accessToken.trim()) body.access_token = accessToken.trim();
      if (callbackUrl.trim()) body.callbackUrl = callbackUrl.trim();
      const out = await api.agentExchangeTest(agent.id, body);
      setResult(out);
    } catch (err) {
      setError(err.message || 'Test invoke failed');
    } finally {
      setBusy(false);
    }
  };

  const needsTokenHint =
    (agent.auth_mode === 'secured' || agent.has_auth) && !agent.can_manage;

  const acceptedTaskId =
    result?.result?.result?.task?.id ||
    result?.result?.task?.id ||
    null;

  if (!open) return null;

  return (
    <div className="a2a-test-controls">
      <form className="a2a-access-panel a2a-test-panel" onSubmit={runTest}>
        <div className="a2a-panel-head">
          <strong>Test invoke</strong>
          {onClose ? (
            <button type="button" className="mcp-pg-btn-ghost mcp-pg-btn-sm" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
        <p className="a2a-access-help">
          Choose a skill, then use the autofilled sample. Primary skill runs the workflow;{' '}
          <code>{ENQUIRE_SKILL_ID}</code> polls an async task.
          {agent.can_manage
            ? ' As owner, this bypasses public IP deny/whitelist and OAuth so you can verify the agent.'
            : ' Public IP and OAuth rules still apply for non-owners.'}
        </p>
        {meta?.can_bypass_access && (
          <p className="a2a-access-help">Owner bypass active for this call.</p>
        )}
        {error && <div className="mcp-pg-alert mcp-pg-alert-error">{error}</div>}
        <label className="a2a-test-label">
          Skill
          <select
            value={skillId}
            onChange={(e) => applySample(e.target.value)}
            disabled={busy}
          >
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === ENQUIRE_SKILL_ID ? `${s.name} (poll async)` : s.name}
              </option>
            ))}
          </select>
        </label>
        {selectedSkill?.description ? (
          <p className="a2a-access-help">{selectedSkill.description}</p>
        ) : null}
        <div className="a2a-test-input-head">
          <span className="a2a-test-input-title">
            {isEnquire ? 'Enquiry input (taskId or runId)' : 'Agent input (JSON object or text)'}
          </span>
          <span className="a2a-test-input-tips">
            {isEnquire ? (
              <EnquireTip />
            ) : (
              <JsonSampleTip
                title="Primary skill input"
                ariaLabel="Primary skill input help"
                note={inputHelp || 'Use the agent card inputSchema / examples for this skill.'}
                sample={
                  (() => {
                    try {
                      return JSON.parse(inputText);
                    } catch {
                      return { text: inputText };
                    }
                  })()
                }
              />
            )}
            {isAsyncAgent(agent) && <CallbackTip agent={agent} />}
          </span>
        </div>
        {inputHelp ? <p className="a2a-access-help">{inputHelp}</p> : null}
        <label className="a2a-test-label a2a-test-label-bare">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={8}
            spellCheck={false}
            disabled={busy}
            placeholder={
              isEnquire
                ? '{\n  "taskId": "<uuid from async accept>"\n}'
                : '{\n  …fields from agent card inputSchema\n}'
            }
          />
        </label>
        {isAsyncAgent(agent) && !isEnquire && (
          <label className="a2a-test-label">
            <span className="a2a-test-label-row">
              Callback URL (optional override)
              <CallbackTip agent={agent} />
            </span>
            <input
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value)}
              placeholder={agent.callback_url || 'https://… or leave blank to poll enquire-progress'}
              disabled={busy}
            />
          </label>
        )}
        {(agent.auth_mode === 'secured' || agent.has_auth) && (
          <label className="a2a-test-label">
            Access token{needsTokenHint ? ' (required)' : ' (optional if you own this agent)'}
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Bearer token from /token"
              autoComplete="off"
              disabled={busy}
            />
          </label>
        )}
        <div className="mcp-pg-card-actions">
          <button
            type="button"
            className="mcp-pg-btn-ghost mcp-pg-btn-sm"
            disabled={busy}
            onClick={() => applySample(skillId)}
          >
            Reset sample
          </button>
          <button type="submit" className="mcp-pg-btn-primary mcp-pg-btn-sm" disabled={busy}>
            {busy ? 'Invoking…' : isEnquire ? 'Enquire' : 'Run test'}
          </button>
        </div>
        {acceptedTaskId && !isEnquire && (
          <p className="a2a-access-help">
            Async task id: <code>{acceptedTaskId}</code>. Switch skill to{' '}
            <button
              type="button"
              className="a2a-inline-link"
              onClick={() => {
                const next = buildA2ATestSample(agent, ENQUIRE_SKILL_ID);
                setSkillId(ENQUIRE_SKILL_ID);
                setInputHelp(next.help || '');
                setInputText(JSON.stringify({ taskId: acceptedTaskId }, null, 2));
              }}
            >
              {ENQUIRE_SKILL_ID}
            </button>{' '}
            to poll.
          </p>
        )}
        {result && (
          <pre className="a2a-callback-tip-pre a2a-test-result">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </form>
    </div>
  );
}

function PublishedAgentCard({
  agent: a,
  copied,
  onCopy,
  orgMember,
  onOrgDialog,
  onRemoveFromOrg,
  onChanged,
}) {
  const [panel, setPanel] = useState(null); // 'test' | 'security' | null
  const asyncMode = isAsyncAgent(a);
  const callbackOn = hasCallback(a);
  const [busyUnpublish, setBusyUnpublish] = useState(false);
  const [busyOrg, setBusyOrg] = useState(false);

  const unpublish = async () => {
    const isAgent = a.listing_kind === 'agent';
    if (
      !window.confirm(
        isAgent
          ? `Unpublish "${a.name}" from Agent Exchange? Public A2A (if any) stops immediately. Importers keep their copies. Your AI employee stays in your workspace.`
          : `Unpublish "${a.name}"? Its public card, invoke, token and enquiry endpoints will stop immediately. The workflow remains published for authenticated UI/API use.`
      )
    ) {
      return;
    }
    setBusyUnpublish(true);
    try {
      await api.agentExchangeUnpublish(a.id);
      await onChanged();
    } catch (e) {
      window.alert(e.message || 'Failed to unpublish agent');
    } finally {
      setBusyUnpublish(false);
    }
  };

  const removeFromOrg = async () => {
    if (!orgMember?.id) return;
    if (
      !window.confirm(
        'Remove this agent from the org chart? The A2A publication itself is not deleted. Sync org when you want AGENTS.md updated.'
      )
    ) {
      return;
    }
    setBusyOrg(true);
    try {
      await onRemoveFromOrg?.(orgMember.id);
    } catch (e) {
      window.alert(e?.message || 'Failed to remove from org');
    } finally {
      setBusyOrg(false);
    }
  };

  const isAgentListing = a.listing_kind === 'agent';
  const alreadyImported = !!a.imported_agent_id;
  const canAddToOrg = isAgentListing ? !!a.can_add_to_org && !alreadyImported : !!a.can_manage;
  const canTest = a.can_test !== false;

  const menuItems = [
    {
      id: 'copy-ep',
      label: copied === `${a.id}-ep` ? 'Copied endpoint' : 'Copy endpoint',
      onClick: () => onCopy(a.endpoint_url, `${a.id}-ep`),
      hidden: isAgentListing && a.visibility === 'flolah',
    },
    {
      id: 'copy-card',
      label: copied === `${a.id}-card` ? 'Copied card URL' : 'Copy card URL',
      onClick: () => onCopy(a.card_url, `${a.id}-card`),
      hidden: !a.card_url,
    },
    {
      id: 'open-card',
      label: 'Open card',
      href: a.card_url,
      external: true,
      hidden: !a.card_url,
    },
    {
      id: 'test',
      label: panel === 'test' ? 'Close test' : 'Test agent',
      onClick: () => setPanel((p) => (p === 'test' ? null : 'test')),
      hidden: !canTest,
    },
    {
      id: 'org',
      label: alreadyImported ? 'Already in workspace' : orgMember ? 'Edit org placement' : 'Add to org',
      hidden: isAgentListing ? !canAddToOrg && !alreadyImported : !a.can_manage,
      disabled: alreadyImported,
      onClick: () =>
        onOrgDialog({
          kind: isAgentListing ? 'agent_publish' : 'a2a_publish',
          refId: a.id,
          defaultName: a.name,
          defaultPurpose: a.description || '',
          existing: orgMember,
        }),
    },
    {
      id: 'open-imported',
      label: 'Open in workspace',
      href: alreadyImported ? `/agents/${encodeURIComponent(a.imported_agent_id)}/workspace` : undefined,
      hidden: !alreadyImported,
    },
    {
      id: 'org-remove',
      label: busyOrg ? 'Removing…' : 'Remove from org',
      hidden: !a.can_manage || !orgMember || isAgentListing,
      disabled: busyOrg,
      onClick: removeFromOrg,
    },
    {
      id: 'security',
      label: panel === 'security' ? 'Close security' : 'Security',
      hidden: !a.can_manage || isAgentListing,
      onClick: () => setPanel((p) => (p === 'security' ? null : 'security')),
    },
    {
      id: 'unpublish',
      label: busyUnpublish ? 'Unpublishing…' : 'Unpublish',
      danger: true,
      hidden: !a.can_manage,
      disabled: busyUnpublish,
      onClick: unpublish,
    },
  ];

  return (
    <article className="mcp-pg-card" style={{ cursor: 'default' }}>
      <div className="mcp-pg-card-head">
        <div className="mcp-pg-card-icon mcp-pg-card-icon-avatar">
          {isAgentListing ? (
            <RobotAvatar src={a.avatar_image} name={a.name} size={40} />
          ) : (
            a.name?.charAt(0)?.toUpperCase() || 'A'
          )}
        </div>
        <div className="mcp-pg-card-head-end">
          <div className="mcp-pg-card-badges">
            <span className="mcp-pg-status mcp-pg-status-healthy">published</span>
            <span className="mcp-pg-transport">{isAgentListing ? 'AI employee' : 'A2A'}</span>
            {isAgentListing ? (
              a.visibility === 'public' ? (
                <span className="mcp-pg-tag mine">Public</span>
              ) : (
                <span className="mcp-pg-tag platform">Flolah</span>
              )
            ) : asyncMode ? (
              <span className="mcp-pg-tag platform" title="Async invoke">
                Async
              </span>
            ) : (
              <span className="mcp-pg-tag mine">Sync</span>
            )}
            {(a.auth_mode === 'secured' || a.has_auth) && !isAgentListing && (
              <span className="mcp-pg-tag platform">Secured</span>
            )}
            {a.auth_mode !== 'secured' && !a.has_auth && !isAgentListing && (
              <span className="mcp-pg-tag mine">Public auth</span>
            )}
            {!isAgentListing && (
              <>
                {a.visibility === 'private' ? (
                  <span className="mcp-pg-tag platform">Private</span>
                ) : (
                  <span className="mcp-pg-tag mine">Listed</span>
                )}
                <span
                  className={`mcp-pg-tag ${
                    a.visibility === 'private'
                      ? 'platform'
                      : (a.access_policy || 'deny_all') === 'allow_all'
                        ? 'mine'
                        : 'platform'
                  }`}
                >
                  {a.visibility === 'private'
                    ? 'Org only'
                    : (a.access_policy || 'deny_all') === 'allow_all'
                      ? 'Allow all IPs'
                      : (a.access_policy || 'deny_all') === 'whitelist'
                        ? 'IP whitelist'
                        : 'Deny all IPs'}
                </span>
              </>
            )}
          </div>
          <PublishInfoTip agent={a} />
          <CardActionsMenu items={menuItems} />
        </div>
      </div>
      <h3>{a.name}</h3>
      <p className="mcp-pg-card-desc">{a.description || 'No description'}</p>
      {!(isAgentListing && a.visibility === 'flolah') && (
        <code className="mcp-pg-card-url">{a.endpoint_url}</code>
      )}
      {isAgentListing && a.visibility === 'flolah' && (
        <p className="mcp-pg-card-desc">Flolah listing — add to org to use in your workspace. Not callable on the public internet.</p>
      )}
      {alreadyImported && (
        <p className="mcp-pg-card-desc">In your Agent Workspace as a hired AI employee.</p>
      )}
      <div className="mcp-pg-card-meta">
        <span>by {a.owner_name || 'Unknown'}</span>
        {a.workflow_name && <span>{a.workflow_name}</span>}
        {(a.auth_mode === 'secured' || a.has_auth) && (
          <span className="mcp-pg-tag platform">OAuth client credentials</span>
        )}
      </div>
      {asyncMode && (
        <div className="mcp-pg-card-meta a2a-async-help-row">
          <span className="a2a-async-help-item">
            {callbackOn ? 'Callback' : 'Callback (optional)'} <CallbackTip agent={a} />
          </span>
          <span className="a2a-async-help-item">
            Enquire <EnquireTip />
          </span>
          {!callbackOn && (
            <span className="a2a-access-help" style={{ margin: 0 }}>
              Poll <code>{ENQUIRE_SKILL_ID}</code> / <code>tasks/get</code>
            </span>
          )}
        </div>
      )}
      {a.auth_mode === 'secured' && a.token_url && (
        <div className="mcp-pg-card-meta">
          <span>
            token: <code style={{ wordBreak: 'break-all' }}>{a.token_url}</code>
          </span>
        </div>
      )}
      {(a.metadata?.tags || []).length > 0 && (
        <div className="mcp-pg-card-meta">
          {(a.metadata.tags || []).map((tag) => (
            <span key={tag} className="mcp-pg-tag mine">
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="mcp-pg-card-meta">
        <span>
          skill: <code>{a.skill_id}</code>
        </span>
        {a.published_at && <span>{new Date(a.published_at).toLocaleString()}</span>}
      </div>
      {orgMember && (
        <div className="mcp-pg-card-meta">
          <span>
            In org: {orgMember.department || 'Unassigned'} · reports to {orgMember.parent_id}
          </span>
        </div>
      )}
      <AgentTestPanel agent={a} open={panel === 'test'} onClose={() => setPanel(null)} />
      {a.can_manage && a.listing_kind !== 'agent' && (
        <AgentAccessControls
          agent={a}
          open={panel === 'security'}
          onClose={() => setPanel(null)}
          onChanged={onChanged}
        />
      )}
    </article>
  );
}

export default function AgentExchange() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(null);
  const [orgMembers, setOrgMembers] = useState([]);
  const [orgDialog, setOrgDialog] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .agentExchangeList({ limit: 200 })
      .then((r) => setAgents(r.agents || []))
      .catch((e) => {
        setError(e.message);
        setAgents([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadOrgMembers = useCallback(() => {
    api
      .orgMembers()
      .then((r) => setOrgMembers(r.members || []))
      .catch(() => setOrgMembers([]));
  }, []);

  useEffect(() => {
    loadOrgMembers();
  }, [loadOrgMembers]);

  const orgMemberFor = (publishId) =>
    orgMembers.find((m) => m.kind === 'a2a_publish' && m.ref_id === publishId) || null;

  const removeFromOrg = async (memberId) => {
    await api.orgMemberDelete(memberId);
    loadOrgMembers();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const tags = (a.metadata?.tags || []).join(' ');
      const hay = [
        a.name,
        a.description,
        a.owner_name,
        a.owner_email,
        a.workflow_name,
        a.listing_kind,
        a.visibility,
        a.skill_id,
        a.endpoint_url,
        a.invoke_mode,
        tags,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [agents, search]);

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch (_) {}
  };

  return (
    <div className="mcp-pg mcp-pg-registry">
      <header className="page-hero">
        <div className="page-hero-top">
          <div className="page-hero-titles">
            <p className="page-hero-kicker">Company Tools · Marketplace</p>
            <h1>AgentExchange</h1>
          </div>
          <button
            type="button"
            className="mcp-pg-btn-primary page-hero-action"
            onClick={() => navigate('/workflows')}
          >
            + Publish from Workflow
          </button>
        </div>
        <p className="page-hero-sub">
          Browse published <strong>AI employees</strong> (Flolah or Public) and workflow A2A cards.
          Publish an employee from <Link to="/workspace">AI Employees</Link>. Workflow A2A still uses{' '}
          <strong>Publish A2A</strong> in the editor. Public AI employees are callable as{' '}
          <a href="https://a2a-protocol.org/" target="_blank" rel="noreferrer">
            A2A
          </a>
          ; Flolah listings are in-app only — Add to org imports them into your workspace.
        </p>
      </header>

      {error && <div className="mcp-pg-alert mcp-pg-alert-error">{error}</div>}

      <div className="mcp-pg-toolbar">
        <input
          type="search"
          className="mcp-pg-search"
          placeholder="Search published agents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="mcp-pg-loading">
          <div className="mcp-pg-spinner" />
          <p>Loading published agents…</p>
        </div>
      ) : (
        <>
          <p className="mcp-pg-count">
            {filtered.length} published agent{filtered.length === 1 ? '' : 's'}
          </p>
          <div className="mcp-pg-grid">
            {filtered.map((a) => (
              <PublishedAgentCard
                key={a.id}
                agent={a}
                copied={copied}
                onCopy={copy}
                orgMember={orgMemberFor(a.id)}
                onOrgDialog={setOrgDialog}
                onRemoveFromOrg={removeFromOrg}
                onChanged={() => {
                  load();
                  loadOrgMembers();
                }}
              />
            ))}
          </div>
          {!filtered.length && (
            <div className="mcp-pg-empty">
              <p>{agents.length ? 'No published agents match your search.' : 'No agents published yet.'}</p>
              <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                Publish an AI employee from <strong>AI Employees</strong>, or open a published workflow and use{' '}
                <strong>Publish A2A</strong>.
              </p>
              <Link to="/workflows" className="mcp-pg-btn-primary" style={{ display: 'inline-block', textDecoration: 'none' }}>
                Go to Workflows
              </Link>
            </div>
          )}
        </>
      )}

      {orgDialog && (
        <AddToOrgDialog
          kind={orgDialog.kind || 'a2a_publish'}
          refId={orgDialog.refId}
          defaultName={orgDialog.defaultName}
          defaultPurpose={orgDialog.defaultPurpose}
          existing={orgDialog.existing}
          onClose={() => setOrgDialog(null)}
          onSaved={loadOrgMembers}
        />
      )}
    </div>
  );
}

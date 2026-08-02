import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

const WIZARD_STEPS = [
  { id: 1, title: 'Channel' },
  { id: 2, title: 'Prep' },
  { id: 3, title: 'Credentials' },
  { id: 4, title: 'Who can message' },
  { id: 5, title: 'Enable' },
  { id: 6, title: 'Link phone' },
];

const SLACK_CHECKLIST = [
  'Create a Slack app at api.slack.com with Bot + Socket Mode enabled.',
  'Add bot scopes: chat:write, app_mentions:read, im:history, im:read, im:write.',
  'Install the app to your workspace and copy the Bot Token (xoxb-…).',
  'Enable Socket Mode and copy the App-Level Token (xapp-…).',
];

const WHATSAPP_CHECKLIST = [
  'Have your WhatsApp phone nearby — you will scan a QR on the last step.',
  'Decide who may message the agent: pairing (approve new people) or allowlist (only listed numbers).',
  'After Enable, scan the QR shown here with WhatsApp → Linked devices.',
  'Then send a WhatsApp message — this agent replies.',
];

function WizardStepper({ step }) {
  return (
    <ol
      style={{
        display: 'flex',
        gap: '0.35rem',
        listStyle: 'none',
        padding: 0,
        margin: '0 0 1rem',
        flexWrap: 'wrap',
      }}
    >
      {WIZARD_STEPS.map((s) => {
        const active = s.id === step;
        const done = s.id < step;
        return (
          <li
            key={s.id}
            style={{
              flex: '1 1 5rem',
              minWidth: '4.5rem',
              padding: '0.45rem 0.5rem',
              borderRadius: 6,
              textAlign: 'center',
              fontSize: '0.8rem',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border, #ddd)'}`,
              background: done
                ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                : active
                  ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
                  : 'transparent',
              color: active || done ? 'var(--text)' : 'var(--muted)',
              fontWeight: active ? 600 : 400,
            }}
          >
            {s.id}. {s.title}
          </li>
        );
      })}
    </ol>
  );
}

function statusBadge(status) {
  const colors = {
    draft: { bg: 'rgba(148,163,184,0.2)', fg: 'var(--muted)' },
    pairing: { bg: 'rgba(251,191,36,0.2)', fg: '#fbbf24' },
    enabled: { bg: 'rgba(34,197,94,0.2)', fg: '#22c55e' },
    disabled: { bg: 'rgba(248,113,113,0.15)', fg: '#f87171' },
  };
  const c = colors[status] || colors.draft;
  return (
    <span
      style={{
        fontSize: '0.75rem',
        padding: '0.15rem 0.5rem',
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        textTransform: 'capitalize',
      }}
    >
      {status || 'draft'}
    </span>
  );
}

function AgentChannelsPanel() {
  const { agentId } = useParams();
  const [agent, setAgent] = useState(null);
  const [channels, setChannels] = useState([]);
  const [record, setRecord] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [channelType, setChannelType] = useState('slack');
  const [setupConfirmed, setSetupConfirmed] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [teamId, setTeamId] = useState('');
  const [dmPolicy, setDmPolicy] = useState('pairing');
  const [allowFrom, setAllowFrom] = useState('');
  const [groupPolicy, setGroupPolicy] = useState('disabled');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [qrStatus, setQrStatus] = useState(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [applyInfo, setApplyInfo] = useState(null);
  const qrPollRef = useRef(null);

  const stopQrPoll = useCallback(() => {
    if (qrPollRef.current) {
      clearTimeout(qrPollRef.current);
      qrPollRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [a, ch] = await Promise.all([
        api.agentGet(agentId),
        api.agentChannelsList({ agentId }),
      ]);
      setAgent(a);
      setChannels(ch.channels || []);
    } catch (e) {
      setError(e.message || String(e));
    }
  }, [agentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => () => stopQrPoll(), [stopQrPoll]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await fn();
      if (okMsg) setMessage(okMsg);
      await refresh();
      return result;
    } catch (e) {
      setError(e.message || String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const openWizard = (existing = null) => {
    stopQrPoll();
    setRecord(existing);
    setWizardOpen(true);
    setWizardStep(existing ? 3 : 1);
    setChannelType(existing?.channel || 'slack');
    setSetupConfirmed(!!existing);
    setBotToken('');
    setAppToken('');
    setTeamId(existing?.config?.teamId || '');
    setDmPolicy(existing?.config?.dmPolicy || 'pairing');
    setAllowFrom((existing?.config?.allowFrom || []).join('\n'));
    setGroupPolicy(existing?.config?.groupPolicy || 'disabled');
    setTestResult(null);
    setQrStatus(null);
    setApplyInfo(null);
    setError(null);
    setMessage(null);
  };

  const ensureRecord = async () => {
    if (record?.id) return record;
    const created = await api.agentChannelsCreate({
      agentId,
      channel: channelType,
      config: {
        dmPolicy,
        ...(channelType === 'whatsapp' ? { groupPolicy } : {}),
      },
    });
    setRecord(created.channel);
    return created.channel;
  };

  const saveCredentials = () =>
    run(async () => {
      const ch = await ensureRecord();
      const body = {
        credentials:
          channelType === 'slack'
            ? { slackBotToken: botToken, slackAppToken: appToken }
            : {},
        config: { teamId: teamId || undefined },
      };
      const { channel } = await api.agentChannelsUpdate(ch.id, body);
      setRecord(channel);
      setBotToken('');
      setAppToken('');
      return true;
    }, 'Credentials saved');

  const savePolicies = () =>
    run(async () => {
      const ch = await ensureRecord();
      const allow = allowFrom
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const { channel } = await api.agentChannelsUpdate(ch.id, {
        config: {
          dmPolicy,
          allowFrom: allow,
          teamId: teamId || undefined,
          ...(channelType === 'whatsapp'
            ? { groupPolicy, groupAllowFrom: groupPolicy === 'allowlist' ? allow : undefined }
            : {}),
        },
      });
      setRecord(channel);
      return true;
    }, 'Access rules saved');

  const scheduleQrWait = useCallback(
    (channelId, currentQr) => {
      stopQrPoll();
      qrPollRef.current = setTimeout(async () => {
        try {
          const out = await api.agentChannelsWhatsAppQrWait(channelId, {
            timeoutMs: 40000,
            currentQrDataUrl: currentQr || undefined,
          });
          setQrStatus(out);
          if (out.channel) setRecord(out.channel);
          if (out.status === 'paired' || out.connected) {
            setMessage('Phone linked. You can message the agent on WhatsApp.');
            stopQrPoll();
            await refresh();
            return;
          }
          scheduleQrWait(channelId, out.qr_data_url || currentQr);
        } catch {
          scheduleQrWait(channelId, currentQr);
        }
      }, 1500);
    },
    [refresh, stopQrPoll]
  );

  const startQr = async (force = false, channelId = null) => {
    const chId =
      channelId ||
      record?.id ||
      channels.find((c) => c.channel === 'whatsapp')?.id;
    if (!chId) {
      setError('Save and enable the WhatsApp channel first');
      return;
    }
    setQrBusy(true);
    setError(null);
    try {
      const out = await api.agentChannelsWhatsAppQrStart(chId, { force });
      setQrStatus(out);
      if (out.channel) setRecord(out.channel);
      if (out.status === 'paired' || out.connected) {
        setMessage('Phone already linked.');
        stopQrPoll();
      } else if (out.qr_data_url) {
        setMessage('Scan the QR with WhatsApp on your phone.');
        scheduleQrWait(chId, out.qr_data_url);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setQrBusy(false);
    }
  };

  const doApply = () =>
    run(async () => {
      const ch = await ensureRecord();
      const out = await api.agentChannelsApply(ch.id);
      setRecord(out.channel);
      setApplyInfo(out.apply || null);
      setWizardStep(6);
      if (channelType === 'whatsapp' && out.channel?.id) {
        setTimeout(() => startQr(false, out.channel.id), 0);
      }
    }, channelType === 'whatsapp' ? 'Enabled — scan the QR next' : 'Channel enabled');

  const doTest = () =>
    run(async () => {
      const ch = record || channels[0];
      if (!ch?.id) throw new Error('Save channel first');
      const out = await api.agentChannelsTest(ch.id);
      setTestResult(out);
      setRecord(out.channel || ch);
    });

  const cancelWizard = () => {
    stopQrPoll();
    setWizardOpen(false);
    setWizardStep(1);
    setRecord(null);
    setQrStatus(null);
    refresh();
  };

  const canNext = () => {
    if (wizardStep === 1) return channelType === 'slack' || channelType === 'whatsapp';
    if (wizardStep === 2) return setupConfirmed;
    if (wizardStep === 3) {
      if (channelType === 'slack') return !!(botToken.trim() || record?.credentials_present?.slack_bot_token);
      return true;
    }
    if (wizardStep === 4) return true;
    return true;
  };

  const nextStep = async () => {
    if (wizardStep === 3 && channelType === 'slack' && botToken.trim()) {
      const ok = await saveCredentials();
      if (!ok) return;
    }
    if (wizardStep === 4) {
      const ok = await savePolicies();
      if (!ok) return;
    }
    setWizardStep((s) => Math.min(6, s + 1));
  };

  return (
    <div style={{ padding: '2rem', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/org" style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
          ← My Org
        </Link>
        <Link
          to={`/agents/${agentId}/workspace`}
          style={{ color: 'var(--muted)', fontSize: '0.9rem', marginLeft: '1rem' }}
        >
          Workspace
        </Link>
      </div>

      <h1 style={{ marginTop: 0 }}>Channels — {agent?.name || agentId}</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1.25rem' }}>
        Connect Slack or WhatsApp so people can chat with this agent from those apps. For WhatsApp, enable the channel
        then scan a QR with your phone.
      </p>

      {error && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(248,113,113,0.15)',
            borderRadius: 8,
            marginBottom: '1rem',
            color: '#f87171',
          }}
        >
          {error}
        </div>
      )}
      {message && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(34,197,94,0.12)',
            borderRadius: 8,
            marginBottom: '1rem',
            color: '#22c55e',
          }}
        >
          {message}
        </div>
      )}

      {!wizardOpen && (
        <>
          <div style={{ marginBottom: '1rem' }}>
            <button
              type="button"
              onClick={() => openWizard(null)}
              style={{
                padding: '0.55rem 1rem',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              + Add channel
            </button>
          </div>

          {channels.length === 0 ? (
            <p style={{ color: 'var(--muted)' }}>No channels configured yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {channels.map((ch) => (
                <li
                  key={ch.id}
                  style={{
                    padding: '1rem',
                    marginBottom: '0.75rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <strong style={{ textTransform: 'capitalize' }}>{ch.channel}</strong>{' '}
                    {statusBadge(ch.status)}
                    <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 4 }}>
                      DM policy: {ch.config?.dmPolicy || 'pairing'}
                      {ch.channel === 'whatsapp' && (
                        <> · Groups: {ch.config?.groupPolicy || 'disabled'}</>
                      )}
                      {ch.last_test_at && <> · Last test: {new Date(ch.last_test_at).toLocaleString()}</>}
                    </div>
                  </div>
                  <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => openWizard(ch)} style={ghostBtn}>
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => api.agentChannelsApply(ch.id), 'Applied')}
                      style={ghostBtn}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => api.agentChannelsTest(ch.id).then(setTestResult))}
                      style={ghostBtn}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() => api.agentChannelsDisable(ch.id), 'Disabled')
                      }
                      style={ghostBtn}
                    >
                      Disable
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {testResult && (
            <pre
              style={{
                marginTop: '1rem',
                padding: '1rem',
                background: 'var(--surface)',
                borderRadius: 8,
                fontSize: '0.8rem',
                overflow: 'auto',
              }}
            >
              {JSON.stringify(testResult, null, 2)}
            </pre>
          )}
        </>
      )}

      {wizardOpen && (
        <div
          style={{
            padding: '1.25rem',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
          }}
        >
          <WizardStepper step={wizardStep} />

          {wizardStep === 1 && (
            <>
              <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Choose channel</h2>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {['slack', 'whatsapp'].map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setChannelType(id)}
                    style={{
                      padding: '1rem 1.25rem',
                      minWidth: 140,
                      borderRadius: 8,
                      border: `2px solid ${channelType === id ? 'var(--accent)' : 'var(--border)'}`,
                      background: channelType === id ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                      color: 'var(--text)',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {id}
                  </button>
                ))}
                <button
                  type="button"
                  disabled
                  title="Coming soon"
                  style={{
                    padding: '1rem 1.25rem',
                    minWidth: 140,
                    borderRadius: 8,
                    border: '1px dashed var(--border)',
                    background: 'transparent',
                    color: 'var(--muted)',
                    cursor: 'not-allowed',
                  }}
                >
                  Telegram (soon)
                </button>
              </div>
            </>
          )}

          {wizardStep === 2 && (
            <>
              <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>
                {channelType === 'slack' ? 'Slack setup' : 'WhatsApp prep'}
              </h2>
              <ol style={{ margin: '0 0 1rem', paddingLeft: '1.25rem', color: 'var(--text)' }}>
                {(channelType === 'slack' ? SLACK_CHECKLIST : WHATSAPP_CHECKLIST).map((line) => (
                  <li key={line} style={{ marginBottom: 8, fontSize: '0.9rem' }}>
                    {line}
                  </li>
                ))}
              </ol>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.9rem' }}>
                <input
                  type="checkbox"
                  checked={setupConfirmed}
                  onChange={(e) => setSetupConfirmed(e.target.checked)}
                />
                I have my phone ready (or Slack tokens ready).
              </label>
            </>
          )}

          {wizardStep === 3 && (
            <>
              <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Credentials</h2>
              {channelType === 'slack' ? (
                <>
                  {record?.credentials_present?.slack_bot_token && (
                    <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Bot token on file — paste only to replace.</p>
                  )}
                  <label style={fieldLabel}>
                    Bot token (xoxb-…)
                    <input type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} style={inputStyle} />
                  </label>
                  <label style={fieldLabel}>
                    App token (xapp-…, Socket Mode)
                    <input type="password" value={appToken} onChange={(e) => setAppToken(e.target.value)} style={inputStyle} />
                  </label>
                  <label style={fieldLabel}>
                    Team ID (optional)
                    <input value={teamId} onChange={(e) => setTeamId(e.target.value)} style={inputStyle} placeholder="T01234567" />
                  </label>
                </>
              ) : (
                <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                  No API tokens needed. On the last step you will scan a QR code with WhatsApp on your phone.
                </p>
              )}
            </>
          )}

          {wizardStep === 4 && (
            <>
              <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Who can message</h2>
              <label style={fieldLabel}>
                Access rule
                <select value={dmPolicy} onChange={(e) => setDmPolicy(e.target.value)} style={inputStyle}>
                  <option value="pairing">pairing — new people get an approval code</option>
                  <option value="allowlist">allowlist — only numbers / IDs you list</option>
                  <option value="open">open — anyone (use carefully)</option>
                  <option value="disabled">disabled — ignore direct messages</option>
                </select>
              </label>
              <label style={fieldLabel}>
                Allowed senders (one per line — phone numbers, Slack user IDs, or * for open)
                <textarea
                  value={allowFrom}
                  onChange={(e) => setAllowFrom(e.target.value)}
                  rows={4}
                  style={{ ...inputStyle, resize: 'vertical' }}
                  placeholder={channelType === 'whatsapp' ? '+15551234567' : 'U01234567'}
                />
              </label>
              {channelType === 'whatsapp' && (
                <label style={fieldLabel}>
                  WhatsApp groups
                  <select value={groupPolicy} onChange={(e) => setGroupPolicy(e.target.value)} style={inputStyle}>
                    <option value="disabled">disabled — ignore all group chats (recommended)</option>
                    <option value="allowlist">allowlist — only group messages from allowed senders above</option>
                    <option value="open">open — any group the linked phone is in (not recommended)</option>
                  </select>
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 4 }}>
                    DM allowlist does not apply to groups unless you set this. Disabled blocks group media before it is downloaded.
                  </span>
                </label>
              )}
            </>
          )}

          {wizardStep === 5 && (
            <>
              <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Enable</h2>
              <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                {channelType === 'slack'
                  ? 'This connects your Slack bot to the agent and stores tokens securely.'
                  : 'This turns on WhatsApp for the agent. Next you will scan a QR with your phone.'}
              </p>
              {applyInfo && (
                <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                  Ready. Account: {applyInfo.account_id || '—'}
                </p>
              )}
            </>
          )}

          {wizardStep === 6 && (
            <>
              <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>
                {channelType === 'whatsapp' ? 'Link your phone' : 'Test'}
              </h2>
              {channelType === 'whatsapp' ? (
                <div>
                  <ol style={{ margin: '0 0 1rem', paddingLeft: '1.25rem', fontSize: '0.9rem' }}>
                    <li style={{ marginBottom: 6 }}>Open WhatsApp on your phone</li>
                    <li style={{ marginBottom: 6 }}>Go to Settings → Linked devices → Link a device</li>
                    <li style={{ marginBottom: 6 }}>Scan the QR below</li>
                  </ol>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <button type="button" disabled={busy || qrBusy} onClick={() => startQr(false)} style={primaryBtn}>
                      {qrBusy ? 'Loading…' : qrStatus?.qr_data_url ? 'Refresh QR' : 'Show QR code'}
                    </button>
                    <button type="button" disabled={busy || qrBusy} onClick={() => startQr(true)} style={ghostBtn}>
                      New QR (force)
                    </button>
                    <button type="button" disabled={busy} onClick={doTest} style={ghostBtn}>
                      Check link status
                    </button>
                  </div>
                  {qrStatus?.status === 'paired' || qrStatus?.connected ? (
                    <p style={{ color: '#22c55e', fontWeight: 600 }}>Linked — send a WhatsApp message to chat with this agent.</p>
                  ) : qrStatus?.qr_data_url ? (
                    <div
                      style={{
                        display: 'inline-block',
                        padding: 12,
                        background: '#fff',
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                      }}
                    >
                      <img
                        src={qrStatus.qr_data_url}
                        alt="WhatsApp pairing QR"
                        width={260}
                        height={260}
                        style={{ display: 'block' }}
                        draggable={false}
                      />
                    </div>
                  ) : (
                    <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                      {qrStatus?.message || 'Click “Show QR code” to display the pairing code.'}
                    </p>
                  )}
                  {qrStatus?.message && qrStatus?.qr_data_url && (
                    <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{qrStatus.message}</p>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <button type="button" disabled={busy} onClick={doTest} style={primaryBtn}>
                      Run test
                    </button>
                  </div>
                  {testResult && (
                    <pre style={{ fontSize: '0.8rem', background: 'var(--bg)', padding: '0.75rem', borderRadius: 8 }}>
                      {JSON.stringify(testResult, null, 2)}
                    </pre>
                  )}
                </>
              )}
              {channelType === 'whatsapp' && testResult && (
                <pre
                  style={{
                    marginTop: '1rem',
                    fontSize: '0.8rem',
                    background: 'var(--bg)',
                    padding: '0.75rem',
                    borderRadius: 8,
                  }}
                >
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              )}
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: '1.25rem', flexWrap: 'wrap' }}>
            <button type="button" onClick={cancelWizard} style={ghostBtn}>
              {wizardStep >= 5 ? 'Close' : 'Cancel'}
            </button>
            {wizardStep > 1 && wizardStep < 5 && (
              <button type="button" onClick={() => setWizardStep((s) => s - 1)} style={ghostBtn}>
                Back
              </button>
            )}
            {wizardStep < 5 && (
              <button type="button" disabled={busy || !canNext()} onClick={nextStep} style={primaryBtn}>
                Next
              </button>
            )}
            {wizardStep === 5 && (
              <button type="button" disabled={busy} onClick={doApply} style={primaryBtn}>
                Enable messaging
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const fieldLabel = { display: 'block', marginBottom: '0.75rem', fontSize: '0.9rem' };
const inputStyle = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: '0.5rem 0.75rem',
  background: 'var(--bg, #121216)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  boxSizing: 'border-box',
};
const primaryBtn = {
  padding: '0.5rem 1rem',
  background: 'var(--accent)',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer',
};
const ghostBtn = {
  padding: '0.35rem 0.75rem',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: '0.85rem',
};

export default function AgentChannels() {
  return (
    <RequireAuth>
      <AgentChannelsPanel />
    </RequireAuth>
  );
}

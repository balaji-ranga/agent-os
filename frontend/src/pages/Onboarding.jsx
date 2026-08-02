import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const btnPrimary = {
  padding: '0.45rem 0.85rem',
  background: 'var(--accent)',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.9rem',
};

const btnSecondary = {
  padding: '0.45rem 0.85rem',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.9rem',
};

function Stepper({ steps, stepIndex, onGo }) {
  return (
    <ol className="onboarding-stepper" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {(steps || []).map((s, i) => {
        const active = i === stepIndex;
        const done = i < stepIndex;
        return (
          <li key={s.id} style={{ marginBottom: '0.35rem' }}>
            <button
              type="button"
              onClick={() => onGo(i)}
              style={{
                ...btnSecondary,
                width: '100%',
                textAlign: 'left',
                borderColor: active ? 'var(--accent)' : 'var(--border)',
                background: active ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))' : 'var(--surface)',
                fontWeight: active ? 600 : 400,
              }}
            >
              <span style={{ opacity: 0.7, marginRight: '0.35rem' }}>{done ? '✓' : i + 1}.</span>
              {s.title}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ChatActions({ actions, busy, onAction }) {
  if (!actions?.length) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
        margin: '0.25rem 0 0.75rem',
      }}
    >
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={busy}
          onClick={() => onAction(a.id)}
          style={a.id === 'apply' || a.id === 'confirm' || a.id === 'continue' ? btnPrimary : btnSecondary}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

function ConfirmationCard({ state, onConfirm, onBack, onApply, onSelectionChange, busy }) {
  const card = state?.card || {};
  const proposal = state?.proposal || {};
  const selectableItems = state?.selectable_items || [];

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '1rem',
        background: 'var(--surface)',
      }}
    >
      <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>{card.title || 'Step'}</h2>
      {card.hint && <p style={{ margin: '0 0 0.75rem', color: 'var(--muted, #888)', fontSize: '0.9rem' }}>{card.hint}</p>}
      {card.body && <p style={{ margin: '0 0 0.75rem' }}>{card.body}</p>}
      {card.prompt && <p style={{ margin: '0 0 0.75rem', fontStyle: 'italic' }}>{card.prompt}</p>}
      {card.value && (
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            background: 'var(--bg)',
            padding: '0.75rem',
            borderRadius: 8,
            fontSize: '0.85rem',
            margin: '0 0 0.75rem',
          }}
        >
          {card.value}
        </pre>
      )}
      {card.profile_hint && (
        <p style={{ margin: '0 0 0.75rem' }}>
          Detected profile: <strong>{card.profile_hint}</strong>
        </p>
      )}
      {Array.isArray(card.list) && card.list.length > 0 && (
        <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem' }}>
          {card.list.map((item, idx) => (
            <li key={idx} style={{ marginBottom: '0.35rem' }}>
              {typeof item === 'string' ? item : `${item.name}${item.role ? ` — ${item.role}` : ''}${item.department ? ` (${item.department})` : ''}`}
            </li>
          ))}
        </ul>
      )}
      {card.map && (
        <div style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
          {Object.entries(card.map).map(([name, tools]) => (
            <div key={name} style={{ marginBottom: '0.5rem' }}>
              <strong>{name}</strong>
              <div style={{ color: 'var(--muted, #888)' }}>{(tools || []).join(', ')}</div>
            </div>
          ))}
        </div>
      )}
      {card.step_id === 'review' && card.summary && (
        <div style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          <div>
            <strong>Purpose:</strong> {proposal.purpose || '—'}
          </div>
          <div>
            <strong>Vision:</strong> {proposal.vision || '—'}
          </div>
          <div>
            <strong>Profile:</strong> {proposal.profile_label}
          </div>
          {card.override_required && !card.override_ack && (
            <p style={{ color: 'var(--warning, #b8860b)', marginTop: '0.5rem' }}>
              Custom agents detected. Acknowledge override in chat before applying.
            </p>
          )}
        </div>
      )}
      {(card.step_id === 'review' || selectableItems.length > 0) && selectableItems.length > 0 && (
        <fieldset style={{ margin: '0 0 0.75rem', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem' }}>
          <legend style={{ padding: '0 0.25rem' }}>Select items to apply</legend>
          {selectableItems.map((item) => (
            <label key={item.id} style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
              <input
                type="checkbox"
                checked={item.selected !== false}
                disabled={busy}
                onChange={(event) => onSelectionChange(item.id, event.target.checked)}
                style={{ marginRight: '0.45rem' }}
              />
              <span style={{ textTransform: 'capitalize', color: 'var(--muted, #888)' }}>{item.kind}: </span>
              {item.label}
            </label>
          ))}
        </fieldset>
      )}
      {Array.isArray(card.links) && (
        <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem' }}>
          {card.links.map((l) => (
            <li key={l.path}>
              <Link to={l.path}>{l.label}</Link>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {card.can_back && (
          <button type="button" style={btnSecondary} disabled={busy} onClick={onBack}>
            Back
          </button>
        )}
        {card.can_confirm && card.step_id !== 'review' && (
          <button type="button" style={btnPrimary} disabled={busy} onClick={onConfirm}>
            Confirm
          </button>
        )}
        {card.can_apply && (
          <button type="button" style={btnPrimary} disabled={busy} onClick={onApply}>
            Apply override
          </button>
        )}
      </div>
    </div>
  );
}

export default function Onboarding() {
  const [state, setState] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  const refresh = useCallback(async () => {
    setError('');
    const s = await api.onboardingHelperGet();
    setState(s);
    const log = s?.journey?.chat_log;
    if (Array.isArray(log) && log.length && messages.length === 0) {
      setMessages(log.map((m) => ({ role: m.role, text: m.text })));
    }
  }, [messages.length]);

  useEffect(() => {
    refresh().catch((e) => setError(e?.message || 'Failed to load onboarding'));
  }, [refresh]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, state?.chat_actions]);

  async function sendChatText(text, { echoUser = true } = {}) {
    const trimmed = String(text || '').trim();
    if (!trimmed || busy) return;
    if (echoUser) setMessages((m) => [...m, { role: 'user', text: trimmed }]);
    setBusy(true);
    setError('');
    try {
      const out = await api.onboardingHelperChat(trimmed);
      setState(out);
      if (out.reply) setMessages((m) => [...m, { role: 'assistant', text: out.reply }]);
    } catch (err) {
      setError(err?.message || 'Chat failed');
    } finally {
      setBusy(false);
    }
  }

  async function sendChat(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    await sendChatText(text);
  }

  async function handleConfirm() {
    setBusy(true);
    setError('');
    try {
      setMessages((m) => [...m, { role: 'user', text: 'Confirm & continue' }]);
      const out = await api.onboardingHelperConfirmStep();
      setState(out);
      if (out.reply) setMessages((m) => [...m, { role: 'assistant', text: out.reply }]);
    } catch (err) {
      setError(err?.message || 'Confirm failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleBack() {
    if (!state || state.step_index <= 0) return;
    setBusy(true);
    setError('');
    try {
      const out = await api.onboardingHelperGoStep(state.step_index - 1);
      setState(out);
      const prompt = out?.card?.prompt || out?.current_step?.hint;
      if (prompt) setMessages((m) => [...m, { role: 'assistant', text: `Back to ${out.current_step?.title || 'previous step'}.\n\n${prompt}` }]);
    } catch (err) {
      setError(err?.message || 'Back failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleGoStep(index) {
    setBusy(true);
    setError('');
    try {
      const out = await api.onboardingHelperGoStep(index);
      setState(out);
    } catch (err) {
      setError(err?.message || 'Navigation failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    const ok = window.confirm(
      'Apply this org proposal? Existing custom agents may be superseded by new recommendations.'
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      setMessages((m) => [...m, { role: 'user', text: 'Apply override' }]);
      const out = await api.onboardingHelperApply(state?.journey?.selected_apply);
      setState(out);
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: `Applied: ${out?.applied?.departments_inserted ?? 0} department(s), ${out?.applied?.agents_created?.length ?? 0} agent(s) created.`,
        },
      ]);
    } catch (err) {
      setError(err?.message || 'Apply failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectionChange(itemId, selected) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const next = { ...(state?.journey?.selected_apply || {}), [itemId]: selected };
      const out = await api.onboardingHelperSaveDraft({ draft_journey: { selected_apply: next } });
      setState(out);
    } catch (err) {
      setError(err?.message || 'Failed to save selection');
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    const ok = window.confirm(
      'Reset the onboarding journey and start from the beginning?\n\nThis clears only your onboarding answers and chat. Departments, agents, and org setup already applied stay as they are.'
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      const out = await api.onboardingHelperReset();
      setState(out);
      setMessages([]);
      const prompt = out?.card?.prompt || out?.card?.body || out?.current_step?.hint;
      if (prompt) {
        setMessages([{ role: 'assistant', text: prompt }]);
      }
    } catch (err) {
      setError(err?.message || 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleChatAction(actionId) {
    if (busy) return;
    if (actionId === 'continue') return sendChatText('continue');
    if (actionId === 'confirm') return handleConfirm();
    if (actionId === 'ack_override') return sendChatText('apply override');
    if (actionId === 'apply') return handleApply();
  }

  const chatActions = state?.chat_actions || [];

  return (
    <div style={{ padding: '1rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>Onboarding</h1>
          <p style={{ margin: '0.35rem 0 0', color: 'var(--muted, #888)' }}>
            Strategic guided setup — answer in chat; use the inline Confirm button when a step is ready.
          </p>
        </div>
        <button type="button" style={btnSecondary} disabled={busy || !state} onClick={handleReset} title="Clears onboarding answers and chat only">
          Reset journey
        </button>
      </header>
      {state?.proposal_source === 'openclaw_onboardinghelper' && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))' }}>
          Your Onboarding Helper proposal is ready. Select the items you want to apply, then confirm.
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            borderRadius: 8,
            border: '1px solid var(--danger, #c44)',
            color: 'var(--danger, #c44)',
          }}
        >
          {error}
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 360px)',
          gap: '1rem',
          alignItems: 'start',
        }}
      >
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 420,
            background: 'var(--surface)',
          }}
        >
          <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', maxHeight: '60vh' }}>
            {messages.length === 0 && (
              <p style={{ color: 'var(--muted, #888)' }}>
                Say <strong>continue</strong> or use the button below to start.
              </p>
            )}
            {messages.map((m, i) => {
              const isLastAssistant = m.role === 'assistant' && i === messages.length - 1;
              return (
                <div key={i} style={{ marginBottom: isLastAssistant ? '0.35rem' : '0.75rem', textAlign: m.role === 'user' ? 'right' : 'left' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      maxWidth: '90%',
                      padding: '0.5rem 0.75rem',
                      borderRadius: 10,
                      background: m.role === 'user' ? 'var(--accent)' : 'var(--bg)',
                      color: m.role === 'user' ? '#fff' : 'var(--text)',
                      whiteSpace: 'pre-wrap',
                      fontSize: '0.92rem',
                      textAlign: 'left',
                    }}
                  >
                    {m.text}
                  </span>
                  {isLastAssistant && (
                    <ChatActions actions={chatActions} busy={busy} onAction={handleChatAction} />
                  )}
                </div>
              );
            })}
            {messages.length === 0 && (
              <ChatActions actions={chatActions.length ? chatActions : [{ id: 'continue', label: 'Continue' }]} busy={busy} onAction={handleChatAction} />
            )}
            <div ref={scrollRef} />
          </div>
          <form
            onSubmit={sendChat}
            style={{
              display: 'flex',
              gap: '0.5rem',
              padding: '0.75rem',
              borderTop: '1px solid var(--border)',
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Answer or describe changes…"
              disabled={busy}
              style={{
                flex: 1,
                padding: '0.5rem 0.75rem',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                font: 'inherit',
              }}
            />
            <button type="submit" style={btnPrimary} disabled={busy || !input.trim()}>
              Send
            </button>
          </form>
        </section>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {state?.steps && (
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '0.75rem',
                background: 'var(--surface)',
              }}
            >
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Steps</h3>
              <Stepper steps={state.steps} stepIndex={state.step_index ?? 0} onGo={handleGoStep} />
            </div>
          )}
          {state && (
            <ConfirmationCard
              state={state}
              onConfirm={handleConfirm}
              onBack={handleBack}
              onApply={handleApply}
              onSelectionChange={handleSelectionChange}
              busy={busy}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
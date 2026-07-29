import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

const PAGE_SIZE = 8;

function BrowserSessionPanel() {
  const [status, setStatus] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [tasksTotal, setTasksTotal] = useState(0);
  const [tasksOffset, setTasksOffset] = useState(0);
  const [recipes, setRecipes] = useState([]);
  const [recipesTotal, setRecipesTotal] = useState(0);
  const [recipesOffset, setRecipesOffset] = useState(0);
  const [goal, setGoal] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [recipeName, setRecipeName] = useState('');
  const [activeTask, setActiveTask] = useState(null);
  const [captureLabel, setCaptureLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);
  const [renameDrafts, setRenameDrafts] = useState({});
  const [showUrlPolicy, setShowUrlPolicy] = useState(false);
  const [allowlistDraft, setAllowlistDraft] = useState('');
  const [denylistDraft, setDenylistDraft] = useState('');

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [st, tPage, rPage] = await Promise.all([
        api.browserSessionStatus(),
        api.browserSessionTasks({ limit: PAGE_SIZE, offset: tasksOffset, days: 7 }),
        api.browserSessionRecipes({ limit: PAGE_SIZE, offset: recipesOffset }),
      ]);
      setStatus(st);
      setTasks(tPage.tasks || []);
      setTasksTotal(tPage.total || 0);
      setRecipes(rPage.recipes || []);
      setRecipesTotal(rPage.total || 0);
      if (activeTask?.id) {
        const one = await api.browserSessionTaskGet(activeTask.id);
        setActiveTask(one.task);
      }
    } catch (e) {
      setError(e.message || String(e));
    }
  }, [activeTask?.id, tasksOffset, recipesOffset]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const run = async (fn, okMsg) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      if (okMsg) setMessage(okMsg);
      await refresh();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const startAutonomous = () =>
    run(async () => {
      const { task } = await api.browserSessionStartTask({
        mode: 'autonomous',
        goal,
        start_url: startUrl || undefined,
      });
      setActiveTask(task);
    }, 'Autonomous task started');

  const startRecorder = () =>
    run(async () => {
      const name =
        recipeName.trim() || goal.trim() || `Recording ${new Date().toISOString().slice(0, 16)}`;
      const { task } = await api.browserSessionStartTask({
        mode: 'recorder',
        goal: goal || name,
        recipe_name: name,
        name,
        start_url: startUrl || undefined,
      });
      setActiveTask(task);
      setRecipeName(name);
    }, 'Recorder started — navigate in Chrome, then Capture current page');

  const openUrlPolicy = async () => {
    setError(null);
    try {
      const policy = status?.url_policy || (await api.browserSessionUrlPolicy());
      setAllowlistDraft((policy?.allowlist || []).join('\n'));
      setDenylistDraft((policy?.denylist || []).join('\n'));
      setShowUrlPolicy(true);
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const saveUrlPolicy = () =>
    run(async () => {
      await api.browserSessionSetUrlPolicy({
        allowlist: allowlistDraft.split('\n'),
        denylist: denylistDraft.split('\n'),
      });
      setShowUrlPolicy(false);
    }, 'URL policy saved');

  useEffect(() => {
    if (!showUrlPolicy) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') setShowUrlPolicy(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showUrlPolicy]);

  const pairing =
    status?.client_setup?.pairing_string || status?.client_setup?.pair_hint || '';
  const setupSteps = status?.client_setup?.steps || [];

  const copyPairing = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select the pairing string manually');
    }
  };

  const tasksPages = Math.max(1, Math.ceil(tasksTotal / PAGE_SIZE));
  const recipesPages = Math.max(1, Math.ceil(recipesTotal / PAGE_SIZE));
  const tasksPage = Math.floor(tasksOffset / PAGE_SIZE) + 1;
  const recipesPage = Math.floor(recipesOffset / PAGE_SIZE) + 1;

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <header className="page-hero" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0 }}>Browser Session</h1>
        <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)', maxWidth: 640 }}>
          Run natural-language browser goals without scripting. Default is managed Playwright; opt into
          Client mode to drive tabs in your own Chrome via OpenClaw Browser Relay. Recorder saves reusable
          recipes (Capture records the current page URL for replay).
        </p>
      </header>

      {error && <p style={{ color: 'var(--danger, #b91c1c)' }}>{error}</p>}
      {message && <p style={{ color: 'var(--ok, #15803d)' }}>{message}</p>}

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>Connect your Chrome</h2>
        <ol style={{ fontSize: '0.9rem', color: 'var(--muted)', paddingLeft: '1.25rem', lineHeight: 1.5 }}>
          {(setupSteps.length
            ? setupSteps
            : [
                'Download the OpenClaw chrome-extension zip, unzip, Load unpacked.',
                'Paste the pairing WSS string below into the extension popup.',
                'Share the tab(s) you want agents to control.',
                'Opt in and mark ready below.',
              ]
          ).map((step) => (
            <li key={step.slice(0, 48)} style={{ marginBottom: 6 }}>
              {step}
            </li>
          ))}
        </ol>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <button
            type="button"
            disabled={busy || status?.client_setup?.extension_download?.available === false}
            onClick={() =>
              run(
                () => api.browserSessionChromeExtensionDownload(),
                'Downloaded openclaw-chrome-extension.zip — unzip and Load unpacked'
              )
            }
          >
            Download Chrome extension (zip)
          </button>
          {status?.client_setup?.extension_download?.version && (
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)', alignSelf: 'center' }}>
              v{status.client_setup.extension_download.version} · Load unpacked folder:{' '}
              <code>chrome-extension</code>
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.75rem',
            border: '1px solid var(--border, #ddd)',
            borderRadius: 8,
            background: 'var(--surface, #fafafa)',
          }}
        >
          <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 6 }}>
            Pairing string (paste into extension)
          </div>
          {pairing ? (
            <>
              <code
                style={{
                  display: 'block',
                  wordBreak: 'break-all',
                  fontSize: '0.8rem',
                  marginBottom: 8,
                }}
              >
                {pairing}
              </code>
              <button type="button" disabled={busy} onClick={copyPairing}>
                {copied ? 'Copied' : 'Copy pairing string'}
              </button>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--warn, #a16207)' }}>
              Pairing string unavailable — OpenClaw relay secret not found on this host.
            </p>
          )}
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: '0.75rem 0 0' }}>
            {status?.client_setup?.uniqueness_note ||
              'This WSS uses the OpenClaw gateway relay token for this server — shared across users on this instance.'}
          </p>
        </div>
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>Session</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
          Mode: <strong>{status?.session?.mode || '…'}</strong> · Resolved profile:{' '}
          <strong>{status?.resolved_profile || '…'}</strong>
          {status?.using_fallback ? ' (fallback to managed)' : ''} · Gateway:{' '}
          {status?.gateway_reachable ? 'up' : 'down'} · Client ready:{' '}
          {status?.session?.session_ready ? 'yes' : 'no'}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button type="button" disabled={busy} onClick={() => run(() => api.browserSessionOptIn(), 'Client mode on')}>
            Use my Chrome (opt in)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => api.browserSessionMarkReady({ ready: true }), 'Marked ready')}
          >
            Mark client session ready
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => api.browserSessionOptOut(), 'Back to managed')}>
            Opt out (managed Playwright)
          </button>
          <button type="button" disabled={busy} onClick={openUrlPolicy}>
            URL allow / deny lists
          </button>
        </div>
      </section>

      {showUrlPolicy && (
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowUrlPolicy(false); }} style={{ position: 'fixed', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center', padding: '1rem', background: 'rgba(0, 0, 0, 0.4)' }}>
          <div role="dialog" aria-modal="true" aria-labelledby="url-policy-title" style={{ width: 'min(620px, 100%)', padding: '1rem', borderRadius: 8, background: 'var(--surface, #fff)', boxShadow: '0 12px 30px rgba(0,0,0,0.25)' }}>
            <h2 id="url-policy-title" style={{ marginTop: 0, fontSize: '1.05rem' }}>URL allow / deny lists</h2>
            <p style={{ marginTop: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>One pattern per line. Examples: <code>*</code>, <code>*.domain.com</code>, <code>domain.com/*</code>, <code>https://domain/path/*</code>. Deny rules win; a non-empty allow list blocks everything else.</p>
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>Allow list<textarea value={allowlistDraft} onChange={(event) => setAllowlistDraft(event.target.value)} rows={6} style={{ width: '100%', display: 'block', marginTop: 4 }} placeholder="*.example.com" /></label>
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>Deny list<textarea value={denylistDraft} onChange={(event) => setDenylistDraft(event.target.value)} rows={6} style={{ width: '100%', display: 'block', marginTop: 4 }} placeholder="https://example.com/checkout/*" /></label>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}><button type="button" disabled={busy} onClick={() => setShowUrlPolicy(false)}>Cancel</button><button type="button" disabled={busy} onClick={saveUrlPolicy}>Save</button></div>
          </div>
        </div>
      )}

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>New task</h2>
        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          Goal
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            style={{ width: '100%', display: 'block', marginTop: 4 }}
            placeholder="e.g. Open LinkedIn notifications and summarize. Do not send messages."
          />
        </label>
        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          Recipe name (for recorder / agent replay by name)
          <input
            value={recipeName}
            onChange={(e) => setRecipeName(e.target.value)}
            style={{ width: '100%', display: 'block', marginTop: 4 }}
            placeholder="e.g. LinkedIn notifications"
          />
        </label>
        <label style={{ display: 'block', marginBottom: '0.75rem' }}>
          Start URL (optional)
          <input
            value={startUrl}
            onChange={(e) => setStartUrl(e.target.value)}
            style={{ width: '100%', display: 'block', marginTop: 4 }}
            placeholder="https://www.linkedin.com/"
          />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button type="button" disabled={busy || !goal.trim()} onClick={startAutonomous}>
            Start autonomous
          </button>
          <button type="button" disabled={busy} onClick={startRecorder}>
            Start recorder
          </button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.6rem' }}>
          Recorder: navigate in your attached Chrome tab, then <strong>Capture current page</strong> after each
          important URL (home → Notifications). Agents replay with{' '}
          <code>{`browse_recipe_run { recipe_name: "…" }`}</code> (requires that tool grant).
        </p>
      </section>

      {activeTask && (
        <section style={{ marginBottom: '1.5rem', padding: '0.75rem', border: '1px solid var(--border, #ddd)' }}>
          <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>Active task</h2>
          <p style={{ fontSize: '0.9rem' }}>
            <code>{activeTask.id}</code> · {activeTask.mode} · <strong>{activeTask.status}</strong>
          </p>
          {activeTask.wait_reason && (
            <p style={{ color: 'var(--warn, #a16207)' }}>Waiting: {activeTask.wait_reason}</p>
          )}
          {activeTask.result?.summary && (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>{activeTask.result.summary}</pre>
          )}
          {activeTask.status === 'blocked_on_input' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => api.browserSessionResumeTask(activeTask.id), 'Resumed')}
            >
              Resume after login / approval
            </button>
          )}
          {activeTask.mode === 'recorder' && activeTask.status === 'recording' && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem', alignItems: 'center' }}>
              <input
                value={captureLabel}
                onChange={(e) => setCaptureLabel(e.target.value)}
                placeholder="Step label (e.g. Notifications)"
                style={{ flex: 1, minWidth: 180 }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      api.browserSessionCapture(activeTask.id, {
                        label: captureLabel || undefined,
                        action: 'page',
                      }),
                    'Current page URL captured'
                  )
                }
              >
                Capture current page
              </button>
              <input
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                placeholder="Save as recipe name"
                style={{ minWidth: 160 }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      api.browserSessionStopRecorder(activeTask.id, {
                        publish: true,
                        name: recipeName.trim() || undefined,
                      }),
                    'Recording saved'
                  )
                }
              >
                Stop &amp; save recipe
              </button>
            </div>
          )}
        </section>
      )}

      <section style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Recent tasks</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Last 7 days · {tasksTotal} total</span>
          <button
            type="button"
            disabled={busy || !tasksTotal}
            onClick={() => {
              if (!window.confirm('Clear all recent browser tasks for your account?')) return;
              run(() => api.browserSessionTasksClear(), 'Task history cleared');
            }}
          >
            Clear history
          </button>
        </div>
        <ul style={{ paddingLeft: '1.1rem', fontSize: '0.9rem' }}>
          {tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                }}
                onClick={() => setActiveTask(t)}
              >
                {t.status}
              </button>{' '}
              {t.mode} — {(t.goal_text || '').slice(0, 80)}
            </li>
          ))}
          {!tasks.length && <li style={{ color: 'var(--muted)' }}>No tasks in the last 7 days</li>}
        </ul>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
          <button
            type="button"
            disabled={busy || tasksOffset <= 0}
            onClick={() => setTasksOffset(Math.max(0, tasksOffset - PAGE_SIZE))}
          >
            Prev
          </button>
          <span>
            Page {tasksPage} / {tasksPages}
          </span>
          <button
            type="button"
            disabled={busy || tasksOffset + PAGE_SIZE >= tasksTotal}
            onClick={() => setTasksOffset(tasksOffset + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Recipes</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{recipesTotal} total</span>
        </div>
        <ul style={{ paddingLeft: '1.1rem', fontSize: '0.9rem' }}>
          {recipes.map((r) => (
            <li key={r.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                <strong>{r.name}</strong>
                <span style={{ color: 'var(--muted)' }}>
                  ({r.status}
                  {r.actionable_steps != null ? ` · ${r.actionable_steps} actionable` : ''}
                  {r.step_count != null ? ` / ${r.step_count} steps` : ''})
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const { task } = await api.browserSessionStartTask({
                        mode: 'recipe_replay',
                        recipe_name: r.name,
                        recipe_id: r.id,
                        goal: `Replay ${r.name}`,
                      });
                      setActiveTask(task);
                    }, `Replay "${r.name}" started`)
                  }
                >
                  Replay
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Delete recipe "${r.name}"?`)) return;
                    run(() => api.browserSessionRecipeDelete(r.id), 'Recipe deleted');
                  }}
                >
                  Delete
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: 4, flexWrap: 'wrap' }}>
                <input
                  value={renameDrafts[r.id] ?? r.name}
                  onChange={(e) => setRenameDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                  style={{ minWidth: 180 }}
                  aria-label={`Rename ${r.name}`}
                />
                <button
                  type="button"
                  disabled={busy || !(renameDrafts[r.id] ?? r.name).trim()}
                  onClick={() =>
                    run(
                      () => api.browserSessionRecipeRename(r.id, (renameDrafts[r.id] ?? r.name).trim()),
                      'Recipe renamed'
                    )
                  }
                >
                  Save name
                </button>
              </div>
            </li>
          ))}
          {!recipes.length && (
            <li style={{ color: 'var(--muted)' }}>No recipes yet — use Start recorder + Capture current page</li>
          )}
        </ul>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
          <button
            type="button"
            disabled={busy || recipesOffset <= 0}
            onClick={() => setRecipesOffset(Math.max(0, recipesOffset - PAGE_SIZE))}
          >
            Prev
          </button>
          <span>
            Page {recipesPage} / {recipesPages}
          </span>
          <button
            type="button"
            disabled={busy || recipesOffset + PAGE_SIZE >= recipesTotal}
            onClick={() => setRecipesOffset(recipesOffset + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}

export default function BrowserSession() {
  return (
    <RequireAuth>
      <BrowserSessionPanel />
    </RequireAuth>
  );
}
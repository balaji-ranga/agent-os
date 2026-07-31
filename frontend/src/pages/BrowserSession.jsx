import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { RequireAuth } from '../context/AuthContext';

const PAGE_SIZE = 8;

const WIZARD_STEPS = [
  { id: 1, title: 'Name' },
  { id: 2, title: 'Ready' },
  { id: 3, title: 'Capture' },
  { id: 4, title: 'Save' },
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
              background: done ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : active ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
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
  const [wizardStartUrl, setWizardStartUrl] = useState('');
  const [activeTask, setActiveTask] = useState(null);
  const [recordingSteps, setRecordingSteps] = useState([]);
  const [captureLabel, setCaptureLabel] = useState('');
  const [lastCapturedUrl, setLastCapturedUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);
  const [renameDrafts, setRenameDrafts] = useState({});
  const [showUrlPolicy, setShowUrlPolicy] = useState(false);
  const [allowlistDraft, setAllowlistDraft] = useState('');
  const [denylistDraft, setDenylistDraft] = useState('');
  const [mainTab, setMainTab] = useState('run'); // run | record
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);

  const loadRecipeSteps = useCallback(async (recipeId) => {
    if (!recipeId) {
      setRecordingSteps([]);
      return;
    }
    try {
      const r = await api.browserSessionRecipeGet(recipeId);
      const steps = r?.recipe?.steps || r?.steps || [];
      setRecordingSteps(Array.isArray(steps) ? steps : []);
      const opens = [...steps].reverse().find((s) => String(s.action || '').toLowerCase() === 'open');
      if (opens?.args?.url) setLastCapturedUrl(opens.args.url);
    } catch {
      /* keep previous */
    }
  }, []);

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
        if (one.task?.mode === 'recorder' && one.task?.recipe_id) {
          await loadRecipeSteps(one.task.recipe_id);
        }
      }
    } catch (e) {
      setError(e.message || String(e));
    }
  }, [activeTask?.id, tasksOffset, recipesOffset, loadRecipeSteps]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  // Resume wizard if a recording is already in progress
  useEffect(() => {
    if (activeTask?.mode === 'recorder' && activeTask?.status === 'recording') {
      setMainTab('record');
      setWizardOpen(true);
      setWizardStep(3);
      if (activeTask.recipe_id) loadRecipeSteps(activeTask.recipe_id);
    }
  }, [activeTask?.id, activeTask?.mode, activeTask?.status, activeTask?.recipe_id, loadRecipeSteps]);

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

  const startAutonomous = () =>
    run(async () => {
      const { task } = await api.browserSessionStartTask({
        mode: 'autonomous',
        goal,
        start_url: startUrl || undefined,
      });
      setActiveTask(task);
    }, 'Autonomous task started');

  const openRecordWizard = () => {
    setMainTab('record');
    setWizardOpen(true);
    setWizardStep(1);
    setError(null);
    setMessage(null);
    setRecordingSteps([]);
    setLastCapturedUrl('');
    setCaptureLabel('');
  };

  const cancelWizard = async () => {
    if (activeTask?.mode === 'recorder' && activeTask?.status === 'recording') {
      const ok = window.confirm('Stop recording without saving? Captured steps will be discarded.');
      if (!ok) return;
      try {
        await api.browserSessionStopRecorder(activeTask.id, { publish: false });
      } catch {
        /* ignore */
      }
    }
    setWizardOpen(false);
    setWizardStep(1);
    setActiveTask(null);
    setRecordingSteps([]);
    setMessage(null);
    await refresh();
  };

  const startWizardRecording = () =>
    run(async () => {
      const name = recipeName.trim();
      if (!name) {
        throw new Error('Enter a recipe name first');
      }
      const { task } = await api.browserSessionStartTask({
        mode: 'recorder',
        goal: `Record recipe: ${name}`,
        recipe_name: name,
        name,
        start_url: wizardStartUrl.trim() || undefined,
      });
      setActiveTask(task);
      setWizardStep(3);
      if (task.recipe_id) await loadRecipeSteps(task.recipe_id);
    }, 'Recording started — navigate in Chrome, then capture each page');

  const capturePage = () =>
    run(async () => {
      if (!activeTask?.id) throw new Error('No active recording');
      const out = await api.browserSessionCapture(activeTask.id, {
        label: captureLabel.trim() || undefined,
        action: 'page',
      });
      setCaptureLabel('');
      if (activeTask.recipe_id) await loadRecipeSteps(activeTask.recipe_id);
      else if (out?.task?.recipe_id) await loadRecipeSteps(out.task.recipe_id);
      const url = out?.captured?.url || out?.captured?.args?.url;
      if (url) setLastCapturedUrl(url);
    }, 'Page captured');

  const finishWizard = () =>
    run(async () => {
      if (!activeTask?.id) throw new Error('No active recording');
      const actionable = recordingSteps.filter((s) =>
        ['open', 'act', 'click', 'type', 'press', 'scroll'].includes(String(s.action || '').toLowerCase())
      );
      if (!actionable.length) {
        throw new Error('Capture at least one page URL before saving (navigate, then Capture this page)');
      }
      await api.browserSessionStopRecorder(activeTask.id, {
        publish: true,
        name: recipeName.trim() || undefined,
      });
      setWizardStep(4);
      setActiveTask(null);
    }, 'Recipe saved');

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
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setShowUrlPolicy(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showUrlPolicy]);

  const pairing = status?.client_setup?.pairing_string || status?.client_setup?.pair_hint || '';
  const setupSteps = status?.client_setup?.steps || [];
  const clientReady = !!status?.session?.session_ready;
  const gatewayUp = !!status?.gateway_reachable;
  const chromeLease = status?.chrome_lease || null;
  const leaseHeldByOther = Boolean(
    chromeLease?.holder_ceo_user_id && !chromeLease?.is_holder
  );

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

  const tabBtn = (id, label) => (
    <button
      type="button"
      onClick={() => {
        setMainTab(id);
        if (id === 'record' && !wizardOpen) {
          /* stay collapsed until Start wizard */
        }
      }}
      style={{
        padding: '0.55rem 1rem',
        borderRadius: 8,
        border: `1px solid ${mainTab === id ? 'var(--accent)' : 'var(--border, #ddd)'}`,
        background: mainTab === id ? 'var(--accent)' : 'transparent',
        color: mainTab === id ? '#fff' : 'var(--text)',
        cursor: 'pointer',
        fontWeight: mainTab === id ? 600 : 400,
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      <header className="page-hero" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0 }}>Browser Session</h1>
        <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)', maxWidth: 640 }}>
          Run goals in managed Playwright or your Chrome, or record a reusable recipe (a trail of page URLs agents can replay).
        </p>
      </header>

      {error && <p style={{ color: 'var(--danger, #b91c1c)' }}>{error}</p>}
      {message && <p style={{ color: 'var(--ok, #15803d)' }}>{message}</p>}

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>1. Connect your Chrome</h2>
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
              <code style={{ display: 'block', wordBreak: 'break-all', fontSize: '0.8rem', marginBottom: 8 }}>
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
        </div>
      </section>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>2. Session</h2>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
          Mode: <strong>{status?.session?.mode || '…'}</strong> · Profile:{' '}
          <strong>{status?.resolved_profile || '…'}</strong>
          {status?.using_fallback ? ' (fallback to managed)' : ''} · Gateway:{' '}
          {gatewayUp ? 'up' : 'down'} · Client ready: {clientReady ? 'yes' : 'no'}
          {chromeLease?.is_holder ? ' · Chrome lease: you' : ''}
        </p>
        {chromeLease?.note && (
          <p
            style={{
              fontSize: '0.88rem',
              color: leaseHeldByOther ? 'var(--warn, #a16207)' : 'var(--muted)',
              marginTop: 0,
              maxWidth: 640,
            }}
          >
            {chromeLease.note}
          </p>
        )}
        {status?.client_setup?.uniqueness_note && (
          <p style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 0, maxWidth: 640 }}>
            {status.client_setup.uniqueness_note}
          </p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button type="button" disabled={busy} onClick={() => run(() => api.browserSessionOptIn(), 'Client mode on')}>
            Use my Chrome (opt in)
          </button>
          <button
            type="button"
            disabled={busy || leaseHeldByOther}
            title={
              leaseHeldByOther
                ? `Client Chrome held by ${chromeLease?.holder_label || 'another user'}`
                : undefined
            }
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
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowUrlPolicy(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            display: 'grid',
            placeItems: 'center',
            padding: '1rem',
            background: 'rgba(0, 0, 0, 0.4)',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="url-policy-title"
            style={{
              width: 'min(620px, 100%)',
              padding: '1rem',
              borderRadius: 8,
              background: 'var(--surface, #fff)',
              boxShadow: '0 12px 30px rgba(0,0,0,0.25)',
            }}
          >
            <h2 id="url-policy-title" style={{ marginTop: 0, fontSize: '1.05rem' }}>
              URL allow / deny lists
            </h2>
            <p style={{ marginTop: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
              One pattern per line. Deny rules win; a non-empty allow list blocks everything else.
            </p>
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Allow list
              <textarea
                value={allowlistDraft}
                onChange={(event) => setAllowlistDraft(event.target.value)}
                rows={6}
                style={{ width: '100%', display: 'block', marginTop: 4 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Deny list
              <textarea
                value={denylistDraft}
                onChange={(event) => setDenylistDraft(event.target.value)}
                rows={6}
                style={{ width: '100%', display: 'block', marginTop: 4 }}
              />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" disabled={busy} onClick={() => setShowUrlPolicy(false)}>
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={saveUrlPolicy}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>3. What do you want to do?</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {tabBtn('run', 'Run a goal')}
          {tabBtn('record', 'Record a recipe')}
        </div>

        {mainTab === 'run' && (
          <div
            style={{
              padding: '1rem',
              border: '1px solid var(--border, #ddd)',
              borderRadius: 10,
            }}
          >
            <p style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--muted)' }}>
              Describe what the browser should do. This starts an autonomous task (not a saved recipe).
            </p>
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
            <label style={{ display: 'block', marginBottom: '0.75rem' }}>
              Start URL (optional)
              <input
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
                style={{ width: '100%', display: 'block', marginTop: 4 }}
                placeholder="https://www.linkedin.com/feed/"
              />
            </label>
            <button type="button" disabled={busy || !goal.trim()} onClick={startAutonomous}>
              Start autonomous task
            </button>
          </div>
        )}

        {mainTab === 'record' && !wizardOpen && (
          <div
            style={{
              padding: '1.25rem',
              border: '1px solid var(--border, #ddd)',
              borderRadius: 10,
            }}
          >
            <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Record a reusable recipe</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.5 }}>
              A recipe is a <strong>trail of page URLs</strong> you visit. You navigate in Chrome; after each
              important page you click <strong>Capture this page</strong>. Later, agents replay those URLs with{' '}
              <code>browse_recipe_run</code>.
            </p>
            <ol style={{ fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.55 }}>
              <li>Name the recipe</li>
              <li>Confirm Chrome is ready</li>
              <li>Navigate → Capture → repeat</li>
              <li>Save</li>
            </ol>
            <button type="button" disabled={busy} onClick={openRecordWizard}>
              Start record wizard
            </button>
          </div>
        )}

        {mainTab === 'record' && wizardOpen && (
          <div
            style={{
              padding: '1.25rem',
              border: '2px solid var(--accent)',
              borderRadius: 10,
              background: 'var(--surface, #fafafa)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Record recipe wizard</h3>
              <button type="button" disabled={busy} onClick={cancelWizard}>
                Cancel
              </button>
            </div>
            <WizardStepper step={wizardStep} />

            {wizardStep === 1 && (
              <div>
                <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                  Pick a clear name agents will use later (exact match). Example:{' '}
                  <code>GitHub vulnerabilities insights</code>.
                </p>
                <label style={{ display: 'block', marginBottom: '0.75rem' }}>
                  Recipe name <span style={{ color: 'var(--danger, #b91c1c)' }}>*</span>
                  <input
                    value={recipeName}
                    onChange={(e) => setRecipeName(e.target.value)}
                    style={{ width: '100%', display: 'block', marginTop: 4, padding: '0.5rem' }}
                    placeholder="e.g. GitHub vulnerabilities insights"
                    autoFocus
                  />
                </label>
                <label style={{ display: 'block', marginBottom: '1rem' }}>
                  Optional first URL (opens when recording starts)
                  <input
                    value={wizardStartUrl}
                    onChange={(e) => setWizardStartUrl(e.target.value)}
                    style={{ width: '100%', display: 'block', marginTop: 4, padding: '0.5rem' }}
                    placeholder="https://github.com/OWNER/REPO"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !recipeName.trim()}
                  onClick={() => setWizardStep(2)}
                  style={{
                    padding: '0.55rem 1.1rem',
                    background: recipeName.trim() ? 'var(--accent)' : 'var(--muted)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: recipeName.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  Next: check Chrome ready
                </button>
              </div>
            )}

            {wizardStep === 2 && (
              <div>
                <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                  Recording uses your attached Chrome tab. Confirm the session is ready before capturing.
                </p>
                {leaseHeldByOther && (
                  <p style={{ fontSize: '0.88rem', color: 'var(--warn, #a16207)' }}>
                    {chromeLease?.note ||
                      'Another user holds Client Chrome. Recording will use managed Playwright until they release the lease.'}
                  </p>
                )}
                <ul style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>
                  <li>
                    Gateway: {gatewayUp ? <strong style={{ color: 'var(--ok, #15803d)' }}>up</strong> : <strong style={{ color: 'var(--danger, #b91c1c)' }}>down</strong>}
                  </li>
                  <li>
                    Client ready:{' '}
                    {clientReady && chromeLease?.is_holder ? (
                      <strong style={{ color: 'var(--ok, #15803d)' }}>yes</strong>
                    ) : (
                      <strong style={{ color: 'var(--warn, #a16207)' }}>
                        {leaseHeldByOther ? 'blocked — lease held by another user' : 'no — Mark ready above'}
                      </strong>
                    )}
                  </li>
                  <li>
                    Recipe: <strong>{recipeName || '(unnamed)'}</strong>
                  </li>
                </ul>
                <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
                  Tip: share only the tab you will use for this trail. You navigate; the wizard only saves URLs when you
                  click Capture.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" disabled={busy} onClick={() => setWizardStep(1)}>
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={busy || leaseHeldByOther}
                    title={
                      leaseHeldByOther
                        ? `Client Chrome held by ${chromeLease?.holder_label || 'another user'}`
                        : undefined
                    }
                    onClick={() => run(() => api.browserSessionMarkReady({ ready: true }), 'Marked ready')}
                  >
                    Mark ready now
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={startWizardRecording}
                    style={{
                      padding: '0.55rem 1.1rem',
                      background: 'var(--accent)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                    }}
                  >
                    Begin capturing pages
                  </button>
                </div>
              </div>
            )}

            {wizardStep === 3 && (
              <div>
                <div
                  style={{
                    padding: '0.75rem',
                    marginBottom: '1rem',
                    borderRadius: 8,
                    background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                    fontSize: '0.9rem',
                    lineHeight: 1.5,
                  }}
                >
                  <strong>How to capture</strong>
                  <ol style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
                    <li>In your attached Chrome tab, go to the next page you want in the trail.</li>
                    <li>Wait until the address bar shows the final URL.</li>
                    <li>Optionally type a short label (e.g. Vulnerabilities).</li>
                    <li>
                      Click <strong>Capture this page</strong> — that URL is saved for replay.
                    </li>
                    <li>Repeat for each stop (e.g. repo → vulnerabilities → insights).</li>
                  </ol>
                </div>

                <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 0 }}>
                  Recording: <code>{activeTask?.id || '…'}</code> · Recipe <strong>{recipeName}</strong>
                  {lastCapturedUrl ? (
                    <>
                      <br />
                      Last captured: <code style={{ wordBreak: 'break-all' }}>{lastCapturedUrl}</code>
                    </>
                  ) : null}
                </p>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'stretch', marginBottom: '1rem' }}>
                  <input
                    value={captureLabel}
                    onChange={(e) => setCaptureLabel(e.target.value)}
                    placeholder="Label for this stop (optional)"
                    style={{ flex: '1 1 200px', padding: '0.55rem' }}
                  />
                  <button
                    type="button"
                    disabled={busy || !activeTask?.id}
                    onClick={capturePage}
                    style={{
                      padding: '0.65rem 1.25rem',
                      background: 'var(--accent)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      fontWeight: 600,
                      fontSize: '0.95rem',
                    }}
                  >
                    Capture this page
                  </button>
                </div>

                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                  Captured trail ({recordingSteps.filter((s) => String(s.action).toLowerCase() === 'open').length} page
                  {recordingSteps.filter((s) => String(s.action).toLowerCase() === 'open').length === 1 ? '' : 's'})
                </h4>
                <ol style={{ fontSize: '0.85rem', paddingLeft: '1.2rem', marginTop: 0 }}>
                  {recordingSteps.length === 0 && (
                    <li style={{ color: 'var(--muted)' }}>No pages yet — navigate in Chrome, then Capture this page.</li>
                  )}
                  {recordingSteps.map((s, i) => (
                    <li key={s.id || i} style={{ marginBottom: 6 }}>
                      <strong>{s.label || s.action}</strong>
                      {s.args?.url ? (
                        <>
                          {' '}
                          — <code style={{ wordBreak: 'break-all' }}>{s.args.url}</code>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ol>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                  <button type="button" disabled={busy} onClick={cancelWizard}>
                    Discard recording
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !recordingSteps.some((s) => String(s.action).toLowerCase() === 'open')
                    }
                    onClick={finishWizard}
                    style={{
                      padding: '0.55rem 1.1rem',
                      background: recordingSteps.some((s) => String(s.action).toLowerCase() === 'open')
                        ? 'var(--accent)'
                        : 'var(--muted)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                    }}
                  >
                    Done — save recipe
                  </button>
                </div>
              </div>
            )}

            {wizardStep === 4 && (
              <div>
                <p style={{ fontSize: '1rem', color: 'var(--ok, #15803d)', fontWeight: 600 }}>
                  Recipe saved: {recipeName}
                </p>
                <p style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                  Agents with <code>browse_recipe_run</code> can replay it by name. You can also use Replay under Recipes
                  below.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setWizardOpen(false);
                      setWizardStep(1);
                      setRecipeName('');
                      setWizardStartUrl('');
                      setRecordingSteps([]);
                    }}
                  >
                    Close wizard
                  </button>
                  <button type="button" disabled={busy} onClick={openRecordWizard}>
                    Record another
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {activeTask && activeTask.mode !== 'recorder' && (
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
                onClick={() => {
                  setActiveTask(t);
                  if (t.mode === 'recorder' && t.status === 'recording') {
                    setMainTab('record');
                    setWizardOpen(true);
                    setWizardStep(3);
                  }
                }}
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
          <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Saved recipes</h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{recipesTotal} total</span>
          <button type="button" disabled={busy} onClick={openRecordWizard}>
            Record new…
          </button>
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
                      setMainTab('run');
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
            <li style={{ color: 'var(--muted)' }}>No recipes yet — use Record a recipe wizard</li>
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

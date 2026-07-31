/**
 * Client browser session + browser tasks / recipes (CEO entitled).
 */
import { Router } from 'express';
import { requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  getBrowserSessionStatus,
  optInClientBrowser,
  optOutClientBrowser,
  markClientSessionReady,
} from '../services/client-browser-session.js';
import { openChromeExtensionZipStream } from '../services/chrome-extension-pack.js';
import { getUrlPolicy, setUrlPolicy } from '../services/browser-url-policy.js';
import {
  startBrowserTask,
  listBrowserTasks,
  getBrowserTask,
  waitForBrowserTask,
  resumeBrowserTask,
  captureRecorderStep,
  stopRecorder,
  clearBrowserTasks,
  toolBrowseSnapshot,
  toolBrowseAct,
} from '../services/browser-tasks.js';
import {
  listRecipes,
  getRecipe,
  deleteRecipe,
  publishRecipe,
  renameRecipe,
} from '../services/browser-recipes.js';
import {
  ensureManagedBrowserReady,
  invokeBrowserOpen,
  persistBrowserSession,
  markPortalLoggedIn,
} from '../services/job-browser-auth.js';

const router = Router();

function ceoId(req, body = {}) {
  return resolveAuthenticatedCeoUserId(req, body);
}

router.get('/status', requireCeoOrAdmin, async (req, res) => {
  try {
    const ceoUserId = ceoId(req);
    const status = await getBrowserSessionStatus(ceoUserId);
    res.json(status);
  } catch (e) {
    console.error('[browser-session] status error: %s', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/url-policy', requireCeoOrAdmin, (req, res) => {
  try {
    res.json(getUrlPolicy(ceoId(req)));
  } catch (e) {
    console.error('[browser-session] get URL policy: %s', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/url-policy', requireCeoOrAdmin, (req, res) => {
  try {
    const policy = setUrlPolicy(ceoId(req, req.body), {
      allowlist: req.body?.allowlist,
      denylist: req.body?.denylist,
    });
    res.json(policy);
  } catch (e) {
    console.error('[browser-session] set URL policy: %s', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Authenticated download: OpenClaw Browser Relay extension (Load unpacked). */
router.get('/chrome-extension.zip', requireCeoOrAdmin, (req, res) => {
  try {
    const { stream, filename, bytes, meta } = openChromeExtensionZipStream();
    console.info(
      '[browser-session] chrome-extension.zip download ceo=%s bytes=%s version=%s',
      ceoId(req),
      bytes,
      meta?.version || '?'
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(bytes));
    stream.pipe(res);
  } catch (e) {
    console.error('[browser-session] chrome-extension.zip: %s', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/opt-in', requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    const session = optInClientBrowser(ceoUserId, {
      pair_hint: req.body?.pair_hint,
      relay_notes: req.body?.relay_notes,
    });
    res.json({ ok: true, session });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/opt-out', requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    const session = optOutClientBrowser(ceoUserId);
    res.json({ ok: true, session });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/mark-ready', requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    const ready = req.body?.ready !== false;
    const session = markClientSessionReady(ceoUserId, ready, req.body?.logged_in_domains || null);
    res.json({ ok: true, session });
  } catch (e) {
    const body = { error: e.message };
    if (e.code) body.code = e.code;
    if (e.holder_ceo_user_id) body.holder_ceo_user_id = e.holder_ceo_user_id;
    if (e.holder_label) body.holder_label = e.holder_label;
    if (e.status === 409) {
      console.info('[browser-session] mark-ready conflict: %s', e.message);
    }
    res.status(e.status || 500).json(body);
  }
});

/** Open managed Chromium to a URL for interactive login (optional; Client Chrome mode does not need this). */
router.post('/open-login-browser', requireCeoOrAdmin, async (req, res) => {
  try {
    const urls = Array.isArray(req.body?.urls) && req.body.urls.length
      ? req.body.urls
      : [req.body?.url].filter(Boolean);
    if (!urls.length) {
      return res.status(400).json({ error: 'url or urls required' });
    }
    await ensureManagedBrowserReady({ restartOnFailure: true });
    for (const url of urls) {
      await invokeBrowserOpen(String(url));
    }
    console.info('[browser-session] open-login-browser urls=%s', urls.length);
    res.json({
      ok: true,
      urls,
      message:
        'Managed Chromium opened. Log in there if needed, then call save-session to persist cookies (managed profile only). Client Chrome mode uses your own browser cookies — skip this.',
    });
  } catch (e) {
    console.error('[browser-session] open-login-browser: %s', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * Persist managed Playwright cookies/profile. Not used for Client Chrome relay
 * (your Chrome already holds cookies).
 */
router.post('/save-session', requireCeoOrAdmin, async (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    const persisted = await persistBrowserSession();
    if (req.body?.linkedin) markPortalLoggedIn({ linkedin: true });
    const domains = req.body?.logged_in_domains || null;
    let leaseNote = null;
    if (domains) {
      try {
        markClientSessionReady(ceoUserId, true, domains);
      } catch (leaseErr) {
        if (leaseErr.status === 409) {
          leaseNote = leaseErr.message;
          console.info('[browser-session] save-session chrome lease skip: %s', leaseErr.message);
        } else {
          throw leaseErr;
        }
      }
    }
    res.json({
      ok: true,
      persisted,
      note: leaseNote
        ? `Saved managed Chromium profile cookies. ${leaseNote}`
        : 'Saved managed Chromium profile cookies. Client Chrome mode does not need Save session.',
      session: (await getBrowserSessionStatus(ceoUserId)).session,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/tasks', requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = ceoId(req);
    const page = listBrowserTasks(ceoUserId, {
      limit: req.query.limit,
      offset: req.query.offset,
      days: req.query.days,
    });
    res.json(page);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/tasks', requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = ceoId(req);
    res.json(clearBrowserTasks(ceoUserId));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/tasks/:id', requireCeoOrAdmin, async (req, res) => {
  try {
    const ceoUserId = ceoId(req);
    const waitMs = Math.min(90000, Math.max(Number(req.query.wait_ms ?? req.query.waitMs) || 0, 0));
    const task = waitMs
      ? await waitForBrowserTask(ceoUserId, req.params.id, waitMs)
      : getBrowserTask(ceoUserId, req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json({ task });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/tasks', requireCeoOrAdmin, async (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    const task = await startBrowserTask(ceoUserId, req.body || {});
    res.status(201).json({ task });
  } catch (e) {
    console.error('[browser-session] start task: %s', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/tasks/:id/resume', requireCeoOrAdmin, async (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    const task = await resumeBrowserTask(ceoUserId, req.params.id, {
      approved: req.body?.approved !== false,
    });
    res.json({ task });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/tasks/:id/capture', requireCeoOrAdmin, async (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    const out = await captureRecorderStep(ceoUserId, req.params.id, req.body || {});
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/tasks/:id/stop-recorder', requireCeoOrAdmin, async (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    const task = await stopRecorder(ceoUserId, req.params.id, req.body || {});
    res.json({ task });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/recipes', requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = ceoId(req);
    res.json(listRecipes(ceoUserId, { limit: req.query.limit, offset: req.query.offset }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.patch('/recipes/:id', requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    const recipe = renameRecipe(ceoUserId, req.params.id, req.body?.name);
    res.json({ recipe });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/recipes/:id', requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = ceoId(req);
    const recipe = getRecipe(ceoUserId, req.params.id);
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
    res.json({ recipe });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/recipes/:id/publish', requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    res.json({ recipe: publishRecipe(ceoUserId, req.params.id) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/recipes/:id', requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = ceoId(req);
    res.json(deleteRecipe(ceoUserId, req.params.id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Content-tool style endpoints (also under /api/tools via seed). */
router.post('/browse-snapshot', requireCeoOrAdmin, async (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    res.json(await toolBrowseSnapshot(ceoUserId, req.body || {}));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/browse-act', requireCeoOrAdmin, async (req, res) => {
  try {
    const ceoUserId = ceoId(req, req.body);
    res.json(await toolBrowseAct(ceoUserId, req.body || {}));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
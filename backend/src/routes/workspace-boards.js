/**
 * Workspace boards / Workspace Builder API (owner-scoped).
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  getBoard,
  listBoards,
  saveBoard,
  deleteBoard,
  setDefaultBoard,
  getDefaultWorkspaceBoard,
  renderBoard,
  materializeOperatingTemplate,
  COMPONENT_CATALOG,
  WIDGET_CATALOG,
  LAYOUT_MODES,
  REST_ALLOWLIST,
  SCHEMA_VERSION,
} from '../services/workspace-boards.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

router.get('/catalog', (_req, res) => {
  res.json({
    schema_version: SCHEMA_VERSION,
    components: COMPONENT_CATALOG,
    widgets: WIDGET_CATALOG,
    layouts: LAYOUT_MODES,
    binding_sources: ['none', 'preset', 'rest', 'master_data_table', 'master_data_rag', 'inline'],
    rest_allowlist: REST_ALLOWLIST.map((r) => r.prefix),
    presets: [
      'workspace.metrics',
      'workspace.tasks',
      'workspace.agents',
      'workspace.activity',
      'workspace.spend',
      'workspace.customers',
      'workspace.links',
      'digest.kpis',
      'digest.performance',
      'digest.performance.slices',
      'digest.top_workflows',
      'digest.activity',
      'digest.insights',
    ],
  });
});

router.get('/', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.query || {});
    res.json({ boards: listBoards(owner), owner_user_id: owner });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/default', async (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.query || {});
    const board = getDefaultWorkspaceBoard(owner);
    if (!board) return res.json({ board: null, owner_user_id: owner });
    const rendered = await renderBoard(owner, board.slug);
    res.json({ ...rendered, is_menu_default: true });
  } catch (e) {
    console.warn('[workspace-boards] default', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/seed-operating', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || {});
    const board = materializeOperatingTemplate(owner);
    res.json({ ok: true, board });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/:slug/set-default', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || {});
    const board = setDefaultBoard(owner, String(req.params.slug || ''));
    res.json({ ok: true, board });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.get('/:slug/render', async (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.query || {});
    const slug = String(req.params.slug || 'operating-workspace');
    const out = await renderBoard(owner, slug);
    res.json(out);
  } catch (e) {
    console.warn('[workspace-boards] render', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:slug', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.query || {});
    const board = getBoard(owner, String(req.params.slug || ''));
    if (!board) return res.status(404).json({ error: 'Board not found' });
    res.json(board);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/:slug', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || {});
    const board = saveBoard(owner, String(req.params.slug || ''), {
      name: req.body?.name,
      layout: req.body?.layout,
      components: req.body?.components ?? req.body?.widgets,
      widgets: req.body?.widgets,
      published: req.body?.published,
    });
    res.json({ ok: true, board });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.delete('/:slug', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || {});
    res.json(deleteBoard(owner, String(req.params.slug || '')));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

export default router;

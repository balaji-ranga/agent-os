/**
 * Mock A2A async callback inbox — receives Flolah callback POSTs for testing.
 * POST is public (callback targets usually are). GET requires auth to inspect.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin } from '../middleware/auth.js';

export const SAMPLE_CALLBACK_JSON = {
  event: 'a2a.workflow.completed',
  task_id: '<uuid from async accept>',
  publish_id: '<a2a publish id>',
  final_output: 'Final step output text',
  run: {
    run_id: 123,
    run_number: 1,
    definition_id: '<workflow id>',
    status: 'completed',
    trigger: 'a2a',
    progress_pct: 100,
    error_message: null,
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: '2026-01-01T00:00:05.000Z',
    steps: [{ node_id: 'trigger-1', node_type: 'trigger', node_label: 'Start', status: 'completed' }],
  },
  status: { state: 'completed' },
};

const router = Router();
const MAX = 100;
/** @type {Array<{ id: string, received_at: string, headers: object, body: any }>} */
const inbox = [];

function nextId() {
  return `cb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

router.post('/', (req, res) => {
  const entry = {
    id: nextId(),
    received_at: new Date().toISOString(),
    headers: {
      'content-type': req.headers['content-type'] || null,
      'user-agent': req.headers['user-agent'] || null,
    },
    body: req.body && typeof req.body === 'object' ? req.body : { raw: req.body },
  };
  inbox.unshift(entry);
  while (inbox.length > MAX) inbox.pop();
  res.status(200).json({ ok: true, id: entry.id });
});

router.get('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, MAX);
  const taskId = String(req.query.task_id || req.query.taskId || '').trim();
  let rows = inbox;
  if (taskId) {
    rows = inbox.filter((e) => e.body?.task_id === taskId);
  }
  res.json({
    count: rows.length,
    sample_callback_json: SAMPLE_CALLBACK_JSON,
    entries: rows.slice(0, limit),
  });
});

router.delete('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  inbox.length = 0;
  res.json({ ok: true });
});

export default router;

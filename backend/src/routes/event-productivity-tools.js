import { Router } from 'express';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { resolveToolOwnerUserId } from '../services/tool-owner-scope.js';
import {
  executeProductivityOperation,
  getProductivityEvent,
  listProductivityEvents,
  listProductivityCapabilities,
} from '../services/event-productivity.js';

const router = Router();
function owner(req) { return resolveToolOwnerUserId(req, req.body || {}, resolveAuthenticatedCeoUserId); }
function routeName(req) { return String(req.path || '').replace(/^\//, '').replaceAll('-', '_'); }
async function run(res, fn) {
  try { res.json({ ok: true, ...(await fn()) }); }
  catch (error) { res.status(error.status || 500).json({ ok: false, error: error.message || String(error), code: error.code }); }
}

router.post('/productivity-capabilities', (req, res) => run(res, async () => ({ capabilities: listProductivityCapabilities() })));
router.post('/event-inbox-list', (req, res) => run(res, async () => ({ events: listProductivityEvents(owner(req), req.body || {}) })));
router.post('/event-inbox-get', (req, res) => run(res, async () => ({ event: getProductivityEvent(owner(req), req.body?.event_id) })));

const operations = [
  'calendar-list-events', 'calendar-find-slots', 'calendar-create-event', 'calendar-update-event', 'calendar-cancel-event',
  'file-search', 'file-get-metadata',
  'document-create', 'document-read', 'document-update', 'document-comment', 'document-export',
  'spreadsheet-read', 'spreadsheet-write', 'spreadsheet-append', 'spreadsheet-set-formula', 'spreadsheet-export',
  'message-search', 'message-get-thread', 'message-send', 'message-reply',
];
for (const path of operations) {
  router.post(`/${path}`, (req, res) => run(res, async () => executeProductivityOperation(owner(req), routeName(req), req.body || {})));
}

export default router;

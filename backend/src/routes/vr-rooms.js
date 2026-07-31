/**
 * CEO Virtual Rooms APIs.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  listVrRooms,
  getVrRoomForOwner,
  createVrRoom,
  updateVrRoom,
  deleteVrRoom,
  addVrRoomMember,
  removeVrRoomMember,
  patchVrRoomLayout,
  ensurePrimaryRoomForAgent,
  publishVrRoom,
  unpublishVrRoom,
  listPublishedVrRoomsForOwner,
} from '../services/ceo-vr-rooms.js';
import { routeVrRoomMessage } from '../services/ceo-vr-route.js';

const router = Router();

function ownerOr403(req, res) {
  const ownerUserId = resolveAuthenticatedCeoUserId(req);
  if (!ownerUserId) {
    res.status(403).json({ error: 'CEO context required' });
    return null;
  }
  return ownerUserId;
}

router.get('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json({ rooms: listVrRooms(owner) });
  } catch (e) {
    console.error('[vr-rooms] list failed', e?.message || e);
    res.status(500).json({ error: e.message || 'List failed' });
  }
});

router.get('/published', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json({ rooms: listPublishedVrRoomsForOwner(owner) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'List failed' });
  }
});

router.post('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const room = createVrRoom(owner, req.body || {});
    res.status(201).json({ room });
  } catch (e) {
    console.error('[vr-rooms] create failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Create failed' });
  }
});

router.get('/by-agent/:agentId', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const room = ensurePrimaryRoomForAgent(owner, req.params.agentId);
    if (!room) return res.status(404).json({ error: 'No avatar mapped to this agent' });
    res.json({ room });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Lookup failed' });
  }
});

router.post('/:id/route', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const text = req.body?.text ?? req.body?.message ?? '';
    const result = await routeVrRoomMessage(owner, req.params.id, text);
    res.json(result);
  } catch (e) {
    console.error('[vr-rooms] route failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Route failed' });
  }
});

router.post('/:id/publish', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const room = publishVrRoom(owner, req.params.id, req.body || {});
    res.json({ room });
  } catch (e) {
    console.error('[vr-rooms] publish failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Publish failed' });
  }
});

router.post('/:id/unpublish', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const room = unpublishVrRoom(owner, req.params.id);
    res.json({ room });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Unpublish failed' });
  }
});

router.get('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const room = getVrRoomForOwner(owner, req.params.id);
    if (!room) return res.status(404).json({ error: 'Not found' });
    res.json({ room });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Get failed' });
  }
});

router.patch('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const room = updateVrRoom(owner, req.params.id, req.body || {});
    if (!room) return res.status(404).json({ error: 'Not found' });
    res.json({ room });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Update failed' });
  }
});

router.patch('/:id/layout', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const layout = req.body?.layout ?? req.body?.layout_json ?? req.body;
    const room = patchVrRoomLayout(owner, req.params.id, layout);
    if (!room) return res.status(404).json({ error: 'Not found' });
    res.json({ room });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Layout update failed' });
  }
});

router.patch('/:id/scene', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const sceneId = req.body?.sceneId ?? req.body?.scene_id ?? null;
    const room = updateVrRoom(owner, req.params.id, { sceneId });
    if (!room) return res.status(404).json({ error: 'Not found' });
    res.json({ room });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Scene update failed' });
  }
});

router.post('/:id/members', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const avatarId = req.body?.avatarId || req.body?.avatar_id;
    if (!avatarId) return res.status(400).json({ error: 'avatarId required' });
    const room = addVrRoomMember(owner, req.params.id, avatarId);
    res.json({ room });
  } catch (e) {
    console.error('[vr-rooms] add member failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Add member failed' });
  }
});

router.delete('/:id/members/:avatarId', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const room = removeVrRoomMember(owner, req.params.id, req.params.avatarId);
    if (!room) return res.status(404).json({ error: 'Not found' });
    res.json({ room });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Remove member failed' });
  }
});

router.delete('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const ok = deleteVrRoom(owner, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Delete failed' });
  }
});

export default router;
/**
 * CEO avatars APIs + Hunyuan3D generate proxy.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  listAvatars,
  createAvatarFromBuffer,
  getAvatarForOwner,
  updateAvatarMeta,
  deleteAvatar,
  readAvatarModelBuffer,
  assignAvatarAgent,
  unassignAvatarAgent,
  getAvatarByAgent,
} from '../services/ceo-avatars.js';
import { generateAvatarWithHunyuan, hunyuanHealth } from '../services/hunyuan3d.js';

const router = Router();

function ownerOr403(req, res) {
  const ownerUserId = resolveAuthenticatedCeoUserId(req);
  if (!ownerUserId) {
    res.status(403).json({ error: 'CEO context required' });
    return null;
  }
  return ownerUserId;
}

router.get('/hunyuan/status', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const status = await hunyuanHealth();
    res.json(status);
  } catch (e) {
    res.json({ ok: false, configured: false, error: e.message });
  }
});

router.get('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json({ avatars: listAvatars(owner) });
  } catch (e) {
    console.error('[avatars] list failed', e?.message || e);
    res.status(500).json({ error: e.message || 'List failed' });
  }
});

router.get('/by-agent/:agentId', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const row = getAvatarByAgent(owner, req.params.agentId);
    if (!row) return res.status(404).json({ error: 'No avatar mapped to this agent' });
    const avatar = listAvatars(owner).find((a) => a.id === row.id);
    res.json({ avatar });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Lookup failed' });
  }
});

router.post('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const { filename, mimeType, name, contentBase64, source } = req.body || {};
    if (!contentBase64) return res.status(400).json({ error: 'contentBase64 required' });
    const buffer = Buffer.from(String(contentBase64), 'base64');
    const avatar = createAvatarFromBuffer(owner, {
      buffer,
      filename: filename || 'model.glb',
      mimeType,
      name,
      source: source || 'upload',
    });
    res.status(201).json({ avatar });
  } catch (e) {
    console.error('[avatars] upload failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Upload failed' });
  }
});

router.post('/generate', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const { prompt, imageBase64, name } = req.body || {};
    if (!prompt && !imageBase64) {
      return res.status(400).json({ error: 'prompt or imageBase64 required' });
    }
    const avatar = await generateAvatarWithHunyuan(owner, { prompt, imageBase64, name });
    res.status(201).json({ avatar });
  } catch (e) {
    console.error('[avatars] hunyuan generate failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Generate failed' });
  }
});

router.get('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const row = getAvatarForOwner(owner, req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const avatar = listAvatars(owner).find((a) => a.id === row.id);
    res.json({ avatar });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Get failed' });
  }
});

router.get('/:id/model', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const got = readAvatarModelBuffer(owner, req.params.id);
    if (!got) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', got.row.mime_type || 'model/gltf-binary');
    res.setHeader('Content-Length', got.buffer.length);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${String(got.row.filename || 'model.glb').replace(/"/g, '')}"`
    );
    res.send(got.buffer);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Download failed' });
  }
});

router.patch('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const avatar = updateAvatarMeta(owner, req.params.id, req.body || {});
    if (!avatar) return res.status(404).json({ error: 'Not found' });
    res.json({ avatar });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Update failed' });
  }
});

router.post('/:id/assign-agent', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const agentId = req.body?.agentId || req.body?.agent_id;
    const avatar = assignAvatarAgent(owner, req.params.id, agentId, req.authUser);
    res.json({ avatar });
  } catch (e) {
    console.error('[avatars] assign failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Assign failed' });
  }
});

router.post('/:id/unassign-agent', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const avatar = unassignAvatarAgent(owner, req.params.id, req.authUser);
    res.json({ avatar });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Unassign failed' });
  }
});

router.delete('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const ok = deleteAvatar(owner, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Delete failed' });
  }
});

export default router;

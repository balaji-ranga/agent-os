/**
 * CEO VR scenes APIs.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  listVrScenes,
  createVrSceneFromBuffer,
  updateVrSceneMeta,
  deleteVrScene,
  readVrSceneModelBuffer,
} from '../services/ceo-vr-scenes.js';

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
    res.json({ scenes: listVrScenes(owner) });
  } catch (e) {
    console.error('[vr-scenes] list failed', e?.message || e);
    res.status(500).json({ error: e.message || 'List failed' });
  }
});

router.post('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const { filename, mimeType, name, contentBase64, sceneJson, scene_json } = req.body || {};
    if (!contentBase64) return res.status(400).json({ error: 'contentBase64 required' });
    const buffer = Buffer.from(String(contentBase64), 'base64');
    let parsedSceneJson = sceneJson ?? scene_json ?? {};
    if (typeof parsedSceneJson === 'string') {
      try {
        parsedSceneJson = JSON.parse(parsedSceneJson);
      } catch {
        return res.status(400).json({ error: 'sceneJson must be valid JSON' });
      }
    }
    const scene = createVrSceneFromBuffer(owner, {
      buffer,
      filename: filename || 'scene.glb',
      mimeType,
      name,
      sceneJson: parsedSceneJson,
    });
    res.status(201).json({ scene });
  } catch (e) {
    console.error('[vr-scenes] upload failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Upload failed' });
  }
});

router.get('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const scenes = listVrScenes(owner);
    const scene = scenes.find((s) => s.id === req.params.id);
    if (!scene) return res.status(404).json({ error: 'Not found' });
    res.json({ scene });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Get failed' });
  }
});

router.get('/:id/model', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const got = readVrSceneModelBuffer(owner, req.params.id);
    if (!got) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', got.row.mime_type || 'model/gltf-binary');
    res.setHeader('Content-Length', got.buffer.length);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${String(got.row.filename || 'scene.glb').replace(/"/g, '')}"`
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
    const scene = updateVrSceneMeta(owner, req.params.id, req.body || {});
    if (!scene) return res.status(404).json({ error: 'Not found' });
    res.json({ scene });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Update failed' });
  }
});

router.delete('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const ok = deleteVrScene(owner, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Delete failed' });
  }
});

export default router;
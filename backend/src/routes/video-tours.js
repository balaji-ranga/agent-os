/**
 * Video Tours API — CEO help playlist (scripts/VTT now; mp4 when exported).
 */
import { Router } from 'express';
import { createReadStream } from 'fs';
import { requireAuth, requireCeoOrAdmin } from '../middleware/auth.js';
import { getVideoTour, listVideoTours, resolveTourFile } from '../services/video-tours.js';

const router = Router();
router.use(requireAuth);
router.use(requireCeoOrAdmin);

router.get('/', (req, res) => {
  try {
    res.json(listVideoTours());
  } catch (e) {
    console.warn('[video-tours] list failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to list video tours' });
  }
});

router.get('/:stem', (req, res) => {
  try {
    res.json(getVideoTour(req.params.stem));
  } catch (e) {
    console.warn('[video-tours] get failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to load tour' });
  }
});

router.get('/:stem/script', (req, res) => {
  try {
    const { path, type } = resolveTourFile(req.params.stem, 'script');
    res.type(type);
    createReadStream(path).pipe(res);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Script not found' });
  }
});

router.get('/:stem/captions', (req, res) => {
  try {
    const { path, type } = resolveTourFile(req.params.stem, 'captions');
    res.type(type);
    createReadStream(path).pipe(res);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Captions not found' });
  }
});

router.get('/:stem/video', (req, res) => {
  try {
    const { path, type } = resolveTourFile(req.params.stem, 'video');
    res.type(type);
    createReadStream(path).pipe(res);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Video not found' });
  }
});

export default router;
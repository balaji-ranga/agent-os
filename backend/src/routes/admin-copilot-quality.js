import { Router } from 'express';
import { attachAuthUser, requireRole } from '../middleware/auth.js';
import { getCopilotQualityStatus, saveCopilotQualitySettings } from '../services/copilot-quality-settings.js';
const router = Router();
router.use(attachAuthUser, requireRole('admin'));
router.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(getCopilotQualityStatus()); } catch { res.status(503).json({ error: 'Copilot review settings unavailable' }); }
});
router.put('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.json(saveCopilotQualitySettings(req.body)); } catch (error) { res.status(error.status || 503).json({ error: error.status === 400 ? error.message : 'Copilot review settings unavailable' }); }
});
export default router;

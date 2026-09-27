import { Router } from 'express';
import { consumeMarketingOpenPixel } from '../services/marketing-workspace.js';

const router = Router();
const PIXEL = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');

router.get('/open.gif', (req, res) => {
  try { consumeMarketingOpenPixel(req.query?.t, { userAgent: req.headers['user-agent'] || '' }); }
  catch { /* Always return a pixel; do not expose token validity or amplify scanner traffic in logs. */ }
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', String(PIXEL.length));
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).end(PIXEL);
});

export default router;

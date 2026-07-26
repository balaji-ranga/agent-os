/**
 * OpenSearch Dashboards console launch (admin-only), mirrors openconnector.js.
 */
import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  createOsConsoleLaunchUrl,
  getOsConsolePublicUrl,
  isRequestSecure,
} from '../services/opensearch/index.js';

const router = Router();

router.post('/console-launch', requireRole('admin'), (req, res) => {
  try {
    const launch = createOsConsoleLaunchUrl(req.authUser, req.sessionToken);
    const secure = isRequestSecure(req);
    res.setHeader(
      'Set-Cookie',
      `${launch.cookie.name}=${encodeURIComponent(launch.cookie.value)}; Path=/opensearch; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(launch.cookie.maxAgeMs / 1000)}${secure ? '; Secure' : ''}`
    );
    res.json({
      ok: true,
      url: launch.url,
      console_url: getOsConsolePublicUrl(),
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/console', requireRole('admin'), (req, res) => {
  try {
    const launch = createOsConsoleLaunchUrl(req.authUser, req.sessionToken);
    const secure = isRequestSecure(req);
    res.setHeader(
      'Set-Cookie',
      `${launch.cookie.name}=${encodeURIComponent(launch.cookie.value)}; Path=/opensearch; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(launch.cookie.maxAgeMs / 1000)}${secure ? '; Secure' : ''}`
    );
    res.redirect(302, launch.url);
  } catch (e) {
    res.status(400).send(e.message);
  }
});

export default router;

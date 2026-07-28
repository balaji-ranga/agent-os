/**
 * Download Windows zip of local IBKR bridge (CEO / admin).
 */
import { Router } from 'express';
import { requireCeoOrAdmin } from '../middleware/auth.js';
import { buildLocalIbkrBridgePackageZip } from '../services/local-ibkr-bridge-package.js';

const router = Router();

router.use(requireCeoOrAdmin);

/**
 * GET /package?include_runtime=0|1
 * Auth required. Mints LOCAL_BRIDGE_TOKEN into packaged .env (never logged in full).
 */
router.get('/package', async (req, res) => {
  try {
    const ownerUserId = req.authUser?.id;
    if (!ownerUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const includeRuntimeRaw = String(req.query.include_runtime ?? req.query.with_runtime ?? '1').toLowerCase();
    const includeRuntime = !['0', 'false', 'no', 'lite'].includes(includeRuntimeRaw);

    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const fromReq = host ? `${proto}://${host}` : null;

    const { zip, filename, token_prefix } = await buildLocalIbkrBridgePackageZip({
      ownerUserId,
      includeRuntime,
      baseUrlOverride: fromReq,
    });

    console.info(
      '[ibkr-bridge-package] download owner=%s token_prefix=%s include_runtime=%s bytes=%s',
      ownerUserId,
      token_prefix,
      includeRuntime ? '1' : '0',
      zip.length
    );

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Bridge-Token-Prefix', token_prefix);
    res.setHeader('X-Bridge-Include-Runtime', includeRuntime ? '1' : '0');
    res.send(zip);
  } catch (e) {
    console.warn('[ibkr-bridge-package] download failed: %s', e.message || e);
    res.status(400).json({ error: e.message || 'Failed to build package' });
  }
});

export default router;

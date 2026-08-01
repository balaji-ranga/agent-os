/**
 * CEO-scoped API key vault CRUD.
 * GET/POST /api/user-api-keys
 * PATCH/DELETE /api/user-api-keys/:id
 */
import { Router } from 'express';
import { requireAuth, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  listUserApiKeys,
  createUserApiKey,
  updateUserApiKey,
  deleteUserApiKey,
  findApiKeyDependencies,
  getUserApiKeyById,
  PLATFORM_BYOK_KEY_NAME,
  REPLICATE_BYOK_KEY_NAME,
} from '../services/user-api-keys.js';

const router = Router();
router.use(requireAuth);

function ownerId(req) {
  return resolveAuthenticatedCeoUserId(req, req.body || req.query || {});
}

router.get('/', (req, res) => {
  try {
    const owner = ownerId(req);
    res.json({
      keys: listUserApiKeys(owner),
      platform_byok_key_name: PLATFORM_BYOK_KEY_NAME,
      replicate_byok_key_name: REPLICATE_BYOK_KEY_NAME,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/', (req, res) => {
  try {
    const owner = ownerId(req);
    const body = req.body || {};
    const row = createUserApiKey(owner, {
      keyName: body.key_name || body.keyName,
      apiKey: body.api_key || body.apiKey,
      encryptionPhrase: body.encryption_phrase || body.encryptionPhrase || '',
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:id/dependencies', (req, res) => {
  try {
    const owner = ownerId(req);
    const row = getUserApiKeyById(owner, req.params.id);
    if (!row) return res.status(404).json({ error: 'API key not found' });
    res.json({ key_name: row.key_name, dependencies: findApiKeyDependencies(owner, row.key_name) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const owner = ownerId(req);
    const body = req.body || {};
    const row = updateUserApiKey(owner, req.params.id, {
      keyName: body.key_name ?? body.keyName,
      apiKey: body.api_key ?? body.apiKey,
      encryptionPhrase: body.encryption_phrase ?? body.encryptionPhrase,
      clearEncryptionPhrase: body.clear_encryption_phrase ?? body.clearEncryptionPhrase,
    });
    res.json(row);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const owner = ownerId(req);
    const force =
      req.query.force === '1' ||
      req.query.force === 'true' ||
      req.body?.force === true ||
      req.body?.confirm === true;
    const out = deleteUserApiKey(owner, req.params.id, { force });
    if (out.requires_confirm) {
      return res.status(409).json({
        error: 'API key is referenced by existing resources. Confirm delete to proceed.',
        ...out,
      });
    }
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;

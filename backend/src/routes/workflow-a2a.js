/**
 * Public A2A endpoints for published workflow agents.
 */
import { Router, json as jsonParser, urlencoded } from 'express';
import {
  getPublicationById,
  handleA2AJsonRpc,
  issueA2AAccessToken,
} from '../services/workflow-a2a-publish.js';

const router = Router();

function cardHandler(req, res) {
  try {
    const pub = getPublicationById(req.params.publishId);
    if (!pub) return res.status(404).json({ error: 'A2A agent not found' });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(pub.agent_card);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function parseClientCredentials(req) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  let clientId = body.client_id || body.clientId || '';
  let clientSecret = body.client_secret || body.clientSecret || '';

  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx >= 0) {
        if (!clientId) clientId = decoded.slice(0, idx);
        if (!clientSecret) clientSecret = decoded.slice(idx + 1);
      }
    } catch (_) {
      /* ignore malformed basic */
    }
  }

  return { clientId, clientSecret, grantType: body.grant_type || body.grantType || '' };
}

router.get('/:publishId/.well-known/agent-card.json', cardHandler);
router.get('/:publishId/.well-known/agent.json', cardHandler);

router.post(
  '/:publishId/oauth/token',
  urlencoded({ extended: false }),
  jsonParser(),
  (req, res) => {
    try {
      const { clientId, clientSecret, grantType } = parseClientCredentials(req);
      const gt = String(grantType || 'client_credentials').trim().toLowerCase();
      if (gt && gt !== 'client_credentials') {
        return res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Only client_credentials is supported',
        });
      }
      const token = issueA2AAccessToken(req.params.publishId, { clientId, clientSecret });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json(token);
    } catch (e) {
      const status = e.status || 400;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(status).json(
        e.oauth || {
          error: status === 401 ? 'invalid_client' : 'invalid_request',
          error_description: e.message,
        }
      );
    }
  }
);
router.post('/:publishId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || req.headers['x-a2a-auth'] || null;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const out = await handleA2AJsonRpc(req.params.publishId, body, { authHeader });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const httpStatus = out.error?.code === -32003 ? 401 : out.error ? 400 : 200;
    res.status(httpStatus).json(out);
  } catch (e) {
    res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: e.message } });
  }
});

export default router;

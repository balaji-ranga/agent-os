/**
 * Public A2A endpoints for published workflow agents.
 */
import { Router } from 'express';
import { buildAgentCard, getPublicationById, handleA2AJsonRpc } from '../services/workflow-a2a-publish.js';

const router = Router();

function cardHandler(req, res) {
  try {
    const pub = getPublicationById(req.params.publishId);
    if (!pub) return res.status(404).json({ error: 'A2A agent not found' });
    const card = buildAgentCard(
      {
        id: pub.id,
        name: pub.name,
        description: pub.description,
        skill_id: pub.skill_id,
        skill_name: pub.skill_name,
        skill_description: pub.skill_description,
        agent_card_json: JSON.stringify(pub.agent_card || {}),
        metadata_json: JSON.stringify(pub.metadata || {}),
      },
      { name: pub.workflow_name, description: pub.description }
    );
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(card);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

router.get('/:publishId/.well-known/agent-card.json', cardHandler);
router.get('/:publishId/.well-known/agent.json', cardHandler);

router.post('/:publishId', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || req.headers['x-a2a-auth'] || null;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const out = await handleA2AJsonRpc(req.params.publishId, body, { authHeader });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(out.error ? 400 : 200).json(out);
  } catch (e) {
    res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: e.message } });
  }
});

export default router;

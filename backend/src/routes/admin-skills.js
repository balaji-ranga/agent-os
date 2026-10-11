import {Router} from 'express';
import {requireAuth, requireRole} from '../middleware/auth.js';
import {getDb} from '../db/schema.js';
import {seedPlatformAgentSkills} from '../services/agent-skills.js';
import {createPlatformSkillCatalogStore} from '../services/platform-skill-catalog.js';
import {previewGithubSkill} from '../services/skill-package.js';

const router=Router();
router.use(requireAuth,requireRole('admin'));
const store=()=>{seedPlatformAgentSkills();return createPlatformSkillCatalogStore(getDb());};
const handler=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e.status || 400).json({error:e.message});}};
router.get('/',handler((req,res)=>res.json({skills:store().list()})));
router.post('/github-preview',handler(async(req,res)=>res.json({package:await previewGithubSkill(req.body?.url)})));
router.post('/',handler((req,res)=>res.status(201).json({skill:store().save(req.body || {},req.authUser.id)})));
router.get('/:id',handler((req,res)=>res.json({skill:store().detail(req.params.id),audit:store().audit(req.params.id)})));
router.post('/:id/versions',handler((req,res)=>res.status(201).json({skill:store().save(req.body || {},req.authUser.id,req.params.id)})));
router.post('/:id/publish',handler((req,res)=>res.json({skill:store().publish(req.params.id,req.body || {},req.authUser.id)})));
router.post('/:id/unpublish',handler((req,res)=>res.json({skill:store().unpublish(req.params.id,req.authUser.id)})));
export default router;

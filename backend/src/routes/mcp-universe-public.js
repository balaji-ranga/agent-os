import express from 'express';
import { randomUUID } from 'crypto';
import { assertSafePublicUrl, createSubmission, ensureMcpUniverseTables, getPublicServer, ipFingerprint, issueHumanSession, searchServers, verifyHumanSession, verifyTurnstile } from '../services/mcp-universe.js';

const router = express.Router();
const buckets = new Map();
function clientIp(req){ return req.ip || req.socket?.remoteAddress || ''; }
function limited(req,res,next){ const key=ipFingerprint(clientIp(req));const now=Date.now();if(buckets.size>10000)for(const[k,v]of buckets)if(now-v.since>120000)buckets.delete(k);const item=buckets.get(key)||{since:now,n:0};if(now-item.since>60000){item.since=now;item.n=0;}item.n++;buckets.set(key,item);if(item.n>90)return res.status(429).json({error:'Too many requests'});next(); }
function parseCookies(raw){const out={};for(const part of String(raw||'').split(';')){const at=part.indexOf('=');if(at<1)continue;try{out[decodeURIComponent(part.slice(0,at).trim())]=decodeURIComponent(part.slice(at+1).trim());}catch{}}return out;}
function requireHuman(req,res,next){ const fp=ipFingerprint(clientIp(req));const token=parseCookies(req.headers.cookie).mcp_human;if(!verifyHumanSession(token,fp))return res.status(403).json({error:'Human verification required',code:'HUMAN_VERIFICATION_REQUIRED'});req.humanFingerprint=fp;next(); }
router.use(limited);
router.get('/config',(_req,res)=>res.json({turnstile_site_key:String(process.env.TURNSTILE_SITE_KEY||''),verification_required_for:'submissions'}));
router.post('/human-verify',async(req,res,next)=>{try{const ip=clientIp(req);if(!await verifyTurnstile(req.body?.token,ip))return res.status(403).json({error:'Human verification failed'});const signed=issueHumanSession(ipFingerprint(ip));res.setHeader('Set-Cookie',`mcp_human=${encodeURIComponent(signed)}; Path=/api/public/mcp-universe; Max-Age=900; HttpOnly; Secure; SameSite=Lax`);res.json({ok:true,expires_in:900});}catch(e){next(e);}});
// Reading the public directory is intentionally anonymous and protected by the
// route/IP and nginx rate limits. Human verification is reserved for writes.
router.get('/search',(req,res)=>res.json(searchServers(req.query)));
router.get('/servers/:id',(req,res)=>{const item=getPublicServer(req.params.id);return item?res.json({server:item}):res.status(404).json({error:'MCP listing not found'});});
router.post('/submissions',requireHuman,async(req,res,next)=>{try{if(String(req.body?.website||'').trim())return res.status(202).json({ok:true});const started=Number(req.body?.form_started_at||0);if(!started||Date.now()-started<2500)return res.status(400).json({error:'Please take a moment to review the submission'});const recent=ensureMcpUniverseTables().prepare(`SELECT COUNT(*) n FROM mcp_universe_submissions WHERE source_ip_hash=? AND created_at>datetime('now','-1 day')`).get(req.humanFingerprint)?.n||0;if(recent>=5)return res.status(429).json({error:'Daily submission limit reached'});for(const value of [req.body?.repository_url,req.body?.documentation_url,req.body?.endpoint_url].filter(Boolean))await assertSafePublicUrl(value);res.status(201).json(createSubmission(req.body,req.humanFingerprint));}catch(e){next(e);}});
router.post('/events',requireHuman,(req,res)=>{const type=String(req.body?.event_type||'').trim();if(!['search','detail_view','source_clicked','include_opened'].includes(type))return res.status(400).json({error:'Unsupported event'});res.json({ok:true,event_id:randomUUID()});});
router.post('/reports',requireHuman,(req,res)=>{const reason=String(req.body?.reason||'').replace(/[<>]/g,'').trim().slice(0,500);if(!reason)return res.status(400).json({error:'Reason is required'});const db=ensureMcpUniverseTables(),id=randomUUID();db.prepare(`INSERT INTO mcp_universe_reports(id,server_id,reason,details,source_ip_hash,status,created_at) VALUES (?,?,?,?,?,'open',?)`).run(id,String(req.body?.server_id||'').slice(0,64),reason,String(req.body?.details||'').replace(/[<>]/g,'').slice(0,2000),req.humanFingerprint,new Date().toISOString());res.status(201).json({id,status:'open'});});
router.get('/:id',(req,res)=>{const item=getPublicServer(req.params.id);return item?res.json({server:item}):res.status(404).json({error:'MCP listing not found'});});
export default router;

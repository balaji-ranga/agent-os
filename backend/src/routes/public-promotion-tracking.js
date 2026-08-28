import express from 'express';
import { recordPromotionEvent, resolvePromotionClick } from '../services/promotions.js';
const router=express.Router();
router.get('/click',(req,res,next)=>{try{const data=resolvePromotionClick(req.query?.t);recordPromotionEvent({campaignId:data.c,userId:data.u,eventType:'cta_clicked',channel:'whatsapp',idempotencyKey:`wa-click:${data.c}:${data.u}:${String(req.query.t).slice(-16)}`});res.setHeader('Cache-Control','no-store');res.redirect(302,data.d);}catch(e){next(e);}});
export default router;

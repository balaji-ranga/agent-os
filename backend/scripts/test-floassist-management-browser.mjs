import assert from 'node:assert/strict';
import express from 'express';
import {resolve,join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.FLOASSIST_PLAYWRIGHT_MODULE).href);
const prefs={connectors:['gmail'],responsibilities:['priority'],timezone:'Asia/Singapore',quiet_start:'22:00',quiet_end:'08:00',briefing_time:'09:00',task_alert_max_days:5,due_soon_hours:72,discovery_lookback_days:7};
const calls=[],errors=[];let paired=false,assistantStatus='active';
const app=express();app.use(express.json());
app.use('/api',(req,res)=>{
 calls.push({path:req.path,method:req.method,body:req.body});
 if(req.path==='/auth/me')return res.json({user:{id:'fixture-owner',role:'ceo',name:'Fixture owner'},agents:[],platform_timezone:'Asia/Singapore'});
 if(req.path==='/floassist-management')return res.json({enrolled:true,status:assistantStatus,preferences:prefs,config:{connectors:[{id:'gmail',label:'Gmail'},{id:'google_calendar',label:'Google Calendar'}]}});
 if(req.path==='/floassist-management/status'){assistantStatus=req.body.status;return res.json({status:assistantStatus});}
 if(req.path==='/floassist-management/connections')return setTimeout(()=>res.json([{id:'gmail',connected:true}]),700);
 if(req.path==='/floassist-management/preferences'){Object.assign(prefs,req.body);return res.json({status:'active',preferences:prefs});}
 if(req.path.startsWith('/floassist-management/connections/'))return res.json({authorization_url:'https://example.test/oauth'});
 if(req.path==='/floassist-management/whatsapp/start')return res.json({connected:false,qr_data_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKaAAAAAASUVORK5CYII='});
 if(req.path==='/floassist-management/whatsapp/wait'){paired=true;return res.json({connected:true});}
 if(req.path==='/floassist-management/whatsapp')return res.json({connected:paired});
 if(req.path==='/scheduled-goals/floassist/deliveries')return res.json({reminders:[],notifications:[],storage:[]});
 if(req.path.includes('notifications'))return res.json({notifications:[],unread_count:0});
 return res.json({});
});
const dist=resolve('frontend/dist');app.use(express.static(dist));app.get('*',(_req,res)=>res.sendFile(join(dist,'index.html')));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const browser=await chromium.launch({channel:process.env.FLOASSIST_BROWSER_CHANNEL||'chrome',headless:true});
const context=await browser.newContext();await context.addInitScript(()=>localStorage.setItem('agent-os-auth-token','synthetic-fixture'));
await context.route('https://example.test/**',route=>route.fulfill({body:'Synthetic OAuth page'}));
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const out=resolve('test-results/floassist-management');mkdirSync(out,{recursive:true});
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/floassist/connections`);
 await page.getByRole('heading',{name:'Manage connections',exact:true}).waitFor();
 await page.getByText('Checking connection…',{exact:true}).waitFor();await page.getByText('Connected',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Pause FloAssist',exact:true}).click();await page.getByRole('button',{name:'Resume FloAssist',exact:true}).waitFor();await page.getByRole('button',{name:'Resume FloAssist',exact:true}).click();await page.getByRole('button',{name:'Pause FloAssist',exact:true}).waitFor();
 await page.getByRole('checkbox',{name:'Google Calendar',exact:true}).check();
 await page.getByRole('button',{name:'Save apps',exact:true}).click();await page.getByRole('status').filter({hasText:'Preferences saved'}).waitFor();
 assert.ok(calls.some(c=>c.path==='/floassist-management/preferences'&&c.body.connectors.includes('google_calendar')));
 const [oauth]=await Promise.all([context.waitForEvent('page'),page.locator('.floassist-app').filter({hasText:'Google Calendar'}).getByRole('button',{name:'Connect',exact:true}).click()]);await oauth.waitForURL('https://example.test/oauth');await oauth.close();assert.ok(calls.some(c=>c.path==='/floassist-management/connections/google_calendar'&&c.method==='POST'));
 await page.getByRole('button',{name:'Company Tools',exact:true}).click();await page.getByRole('button',{name:'FloAssist',exact:true}).click();
 assert.equal(await page.getByRole('link',{name:'WhatsApp',exact:true}).count()>=2,true,'Company Tools includes submenu and page tabs');
 await page.screenshot({path:join(out,'connections-desktop.png'),fullPage:true});
 const tabs=page.getByRole('navigation',{name:'FloAssist sections'});
 await tabs.getByRole('link',{name:'WhatsApp',exact:true}).click();await page.getByRole('button',{name:'Show / refresh QR',exact:true}).click();await page.getByRole('status').filter({hasText:'Connected'}).waitFor();
 await tabs.getByRole('link',{name:'Reminders & deliveries',exact:true}).click();await page.getByRole('button',{name:'Load reminders and deliveries',exact:true}).click();await page.getByText('No reminders.',{exact:true}).waitFor();
 await tabs.getByRole('link',{name:'Preferences',exact:true}).click();await page.getByLabel('Alert delivery days (0 = unlimited)',{exact:true}).fill('5');await page.getByRole('button',{name:'Save preferences',exact:true}).click();
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});
  for(const [id,label]of [['connections','Connections'],['whatsapp','WhatsApp'],['reminders-deliveries','Reminders & deliveries'],['preferences','Preferences']]){
   await tabs.getByRole('link',{name:label,exact:true}).click();await page.locator('.floassist-page h1').waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`No horizontal overflow: ${id} ${width}`);
   await page.screenshot({path:join(out,`${id}-${width}.png`),fullPage:true});
  }
 }
 assert.deepEqual(errors,[]);console.log('FLOASSIST_MANAGEMENT_BROWSER_OK: Company Tools submenu, app selection/save, QR continuity, deliveries, preferences, desktop/mobile and no browser errors');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

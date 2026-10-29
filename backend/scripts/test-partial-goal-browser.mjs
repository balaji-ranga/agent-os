import assert from 'node:assert/strict';
import express from 'express';
import {resolve,join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.FLOASSIST_PLAYWRIGHT_MODULE).href);
const calls=[],errors=[],plan={steps:[{type:'agent_tool',label:'Local read',tool_name:'agent_workflow_list'}]};
let goal={id:'sg-ui',title:'Partial goal browser test',prompt:'Read local workflows',agent_id:'fixture-coo',agent_name:'Fixture COO',is_coo:true,cadence:'daily',time_local:'09:00',execution_mode:'goal_plan',partial_goal:false,plan,plan_status:'approved',status:'paused',schedule_label:'Daily 09:00',deliver_to:['web']};
const app=express();app.use(express.json());
app.use('/api',(req,res)=>{
 calls.push({path:req.path,method:req.method,body:req.body});
 if(req.path==='/auth/me')return res.json({user:{id:'fixture-owner',role:'ceo',name:'Fixture owner'},platform_timezone:'Asia/Singapore'});
 if(req.path==='/agents')return res.json([{id:'fixture-coo',name:'Fixture COO',is_coo:true}]);
 if(req.path==='/scheduled-goals'&&req.method==='GET')return res.json({goals:[goal],server_timezone:'Asia/Singapore'});
 if(req.path==='/scheduled-goals'&&req.method==='POST'){goal={...goal,...req.body,id:'sg-ui'};return res.json({goal});}
 if(req.path==='/scheduled-goals/sg-ui'&&req.method==='PATCH'){goal={...goal,...req.body};return res.json({goal});}
 if(req.path==='/scheduled-goals/sg-ui/plan'){goal={...goal,plan:req.body.plan||goal.plan};return res.json({goal});}
 if(req.path==='/scheduled-goals/sg-ui')return res.json({goal,runs:[{id:'run-ui',status:'partial',reply_preview:'Partial success: 2/4 steps completed; 2 failed.',created_at:'2026-10-29T01:00:00Z'}]});
 if(req.path.includes('notifications'))return res.json({notifications:[],unread_count:0});
 return res.json({});
});
const dist=resolve('frontend/dist');app.use(express.static(dist));app.get('*',(_req,res)=>res.sendFile(join(dist,'index.html')));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({channel:process.env.FLOASSIST_BROWSER_CHANNEL||'chrome',headless:true});
const context=await browser.newContext();await context.addInitScript(()=>localStorage.setItem('agent-os-auth-token','fixture-only'));
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const out=resolve('test-results/partial-goal');mkdirSync(out,{recursive:true});
try {
 await page.goto(`http://127.0.0.1:${server.address().port}/scheduled-goals`);
 await page.getByRole('button',{name:'New scheduled goal',exact:true}).click();
 const checkbox=page.getByRole('checkbox',{name:/^Partial goal/});await checkbox.waitFor();assert.equal(await checkbox.isChecked(),false);
 await checkbox.check();await page.getByLabel('Prompt (what to do each run)',{exact:true}).fill('Read local workflows');
 await page.getByRole('button',{name:'Save & schedule',exact:true}).click();
 await page.getByRole('button',{name:'New scheduled goal',exact:true}).waitFor();assert.ok(calls.some(c=>c.method==='POST'&&c.path==='/scheduled-goals'&&c.body.partial_goal===true));
 await page.getByRole('button',{name:'Edit scheduled goal Partial goal browser test',exact:true}).click();assert.equal(await checkbox.isChecked(),true);
 await checkbox.uncheck();await page.getByRole('button',{name:/^(Approve plan & schedule|Save & schedule)$/}).click();
 await page.getByRole('button',{name:'New scheduled goal',exact:true}).waitFor();assert.ok(calls.some(c=>c.method==='PATCH'&&c.body.partial_goal===false));assert.deepEqual(goal.plan,plan);
 await page.getByRole('button',{name:'Edit scheduled goal Partial goal browser test',exact:true}).click();
 await page.getByLabel('Execution mode',{exact:true}).selectOption('direct_agent');assert.equal(await checkbox.isDisabled(),true);
 await page.getByLabel('Execution mode',{exact:true}).selectOption('goal_plan');assert.equal(await checkbox.isDisabled(),false);
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});if(width<600)await page.waitForFunction(()=>document.querySelector('.app-nav')?.getBoundingClientRect().right<=0);await checkbox.scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No overflow at ${width}`);await page.screenshot({path:join(out,`partial-goal-${width}.png`),fullPage:true});}
 assert.deepEqual(errors,[]);console.log('PARTIAL_GOAL_BROWSER_OK: create/edit persistence, default off, saved plan retained, direct-mode explanation, desktop/mobile and no browser errors; synthetic API only');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}

// Live browser acceptance uses a synthetic company token, never a customer login.
// Supply the private fixture file produced by vps-test-copilot-platform-map --prepare-ui.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const file=process.env.COPILOT_UI_FIXTURE,playwright=process.env.COPILOT_PLAYWRIGHT_PATH;
if(!file||!playwright)throw new Error('COPILOT_UI_FIXTURE and COPILOT_PLAYWRIGHT_PATH required');
const config=JSON.parse(readFileSync(file));assert.equal(config.origin,'https://login.flolah.cloud');
const {chromium}=await import(pathToFileURL(playwright));
const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0,page;const apiFailures=[];
try{
 const context=await browser.newContext();page=await context.newPage();const prohibited=[];let announcementDismissed=false;
 page.on('response',async response=>{const p=new URL(response.url()).pathname;if(p.startsWith('/api/ui-copilot/')&&response.status()>=400){const body=await response.json().catch(()=>({}));apiFailures.push({path:p.split('/').at(-1),status:response.status(),error:body.error});}});
 await page.route('**/api/**',async route=>{
  const request=route.request();
  const pathname=new URL(request.url()).pathname;
  // Announcement analytics are outside this acceptance. Keep the normal close
  // button functional without polluting a production campaign's event counts.
  if(/^\/api\/promotions\/[^/]+\/events$/.test(pathname)){
   if(request.postDataJSON()?.event_type==='dismissed')announcementDismissed=true;
   await route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});return;
  }
  if(pathname==='/api/promotions/eligible'&&announcementDismissed){await route.fulfill({status:200,contentType:'application/json',body:'{"campaign":null}'});return;}
  if(!['GET','HEAD','OPTIONS'].includes(request.method())&&!new URL(request.url()).pathname.startsWith('/api/ui-copilot/')){prohibited.push(new URL(request.url()).pathname);await route.abort();return;}
  await route.continue();
 });
 await page.addInitScript(token=>localStorage.setItem('agent-os-auth-token',token),config.token);
 await page.goto(config.origin+'/content-explorer',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Content Explorer',exact:true}).waitFor();
 const select=page.getByText('Efficiency mode',{exact:true}).locator('..').locator('select');
 const closeAnnouncement=page.getByRole('button',{name:'Close announcement',exact:true});
 try{await closeAnnouncement.waitFor({state:'visible',timeout:3000});await closeAnnouncement.click();}catch{/* No eligible announcement is also valid. */}
 await page.getByRole('button',{name:'Platform Help',exact:true}).click();
 await page.getByRole('textbox',{name:'Message Platform Help',exact:true}).fill('Looking to update profile to make efficiency mode as No');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('button',{name:'Review setup',exact:true}).waitFor({timeout:60000});
 assert.equal(new URL(page.url()).pathname,'/profile','original prompt navigated from Content Explorer and continued');checks++;
 assert.equal(await select.inputValue(),'yes','proposal must not change the field before review');checks++;
 const otherFields=()=>page.evaluate(()=>[...document.querySelectorAll('[data-copilot-control]')].filter(el=>!el.closest('.platform-help-copilot')&&el.getClientRects().length&&['text','email','tel','url','number','search','textarea','select-one'].includes(el.type)&&el.closest('label')?.querySelector('span')?.textContent!=='Efficiency mode').map(el=>[el.getAttribute('data-copilot-control'),el.value]));
 const beforeOthers=JSON.stringify(await otherFields());
 await page.getByRole('button',{name:'Review setup',exact:true}).click();
 await page.getByRole('button',{name:'Approve and apply fields',exact:true}).waitFor();
 assert.equal(await select.inputValue(),'yes','opening review is not approval');checks++;
 await page.getByRole('button',{name:'Approve and apply fields',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('select')].some(el=>el.closest('label')?.querySelector('span')?.textContent==='Efficiency mode'&&el.value==='no'));
 assert.equal(await select.inputValue(),'no');checks++;
 assert.equal(JSON.stringify(await otherFields())===beforeOthers,true,'only the requested field was changed');checks++;
 await page.getByRole('textbox',{name:'Message Platform Help',exact:true}).fill('Save changes in profile');
 const saveResponse=page.waitForResponse(r=>r.url().endsWith('/propose')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 const saveProposal=await (await saveResponse).json();assert.deepEqual(saveProposal.proposal.actions,[],'save-only prompt must not propose CRM/ERP/default fields');checks++;
 await page.getByText('I have not saved or submitted the form.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Review setup',exact:true}).count(),0);assert.equal(await select.inputValue(),'no');checks++;
 assert.equal(JSON.stringify(await otherFields())===beforeOthers,true,'save request leaves all other fields untouched');checks++;
 // A different tab/session update must invalidate an already-open review
 // before any DOM write, not merely reject its receipt after changing fields.
 await page.getByRole('textbox',{name:'Message Platform Help',exact:true}).fill('Change efficiency mode to Yes');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('button',{name:'Review setup',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:'Review setup',exact:true}).click();
 const latest=await (await page.request.get(config.origin+'/api/ui-copilot/session',{headers:{authorization:'Bearer '+config.token}})).json();
 const paused=await page.request.put(config.origin+'/api/ui-copilot/session/'+latest.session.id,{headers:{authorization:'Bearer '+config.token},data:{version:latest.session.version,status:'paused'}});assert.equal(paused.status(),200);
 const reviewResponse=page.waitForResponse(r=>r.url().endsWith('/review'));
 await page.getByRole('button',{name:'Approve and apply fields',exact:true}).click();assert.equal((await reviewResponse).status(),409);checks++;
 assert.equal(await select.inputValue(),'no','superseded review cannot write to the form');checks++;
 // Reload verifies that approval populated the form without saving the profile.
 await page.reload({waitUntil:'domcontentloaded'});await select.waitFor({state:'visible'});
 await page.waitForFunction(()=>[...document.querySelectorAll('select')].some(el=>el.closest('label')?.querySelector('span')?.textContent==='Efficiency mode'&&el.value==='yes'));
 assert.equal(await select.inputValue(),'yes','profile was never saved by Copilot');checks++;
 await page.getByRole('button',{name:'Platform Help',exact:true}).click();
 await page.getByRole('button',{name:'Copilot options',exact:true}).click();
 await page.getByText('Teach Copilot',{exact:true}).click();
 await page.getByText(/^Platform seeded recipes \(/).waitFor({timeout:20000});checks++;
 await page.getByText('Platform and learned screen map',{exact:true}).click();
 await page.getByRole('button',{name:'Refresh screen map',exact:true}).click();
 await page.getByText(/Indexed version /).waitFor({timeout:20000});checks++;
 assert.deepEqual(prohibited,[],'no settings/business writes attempted');checks++;
 console.log(JSON.stringify({stage:'COPILOT_DEPLOYED_BROWSER_PASS',checks,profile_saved:false,save_only_no_fields:true,unrelated_fields_unchanged:true,stale_review_blocked:true,source_map_visible:true,seeded_recipes_visible:true}));
}catch(error){
 // Only synthetic fixture UI metadata, never request headers or auth tokens.
 console.error(JSON.stringify({stage:'COPILOT_BROWSER_DIAGNOSTIC',path:page?new URL(page.url()).pathname:null,apiFailures,headings:page?await page.locator('h1').allTextContents():[],panel:page?await page.locator('.copilot-panel').textContent().catch(()=>null):null}));throw error;
}finally{await browser.close()}

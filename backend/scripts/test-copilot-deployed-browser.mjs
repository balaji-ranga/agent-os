// Live browser acceptance uses a synthetic company token, never a customer login.
// Supply the private fixture file produced by vps-test-copilot-platform-map --prepare-ui.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const file=process.env.COPILOT_UI_FIXTURE,playwright=process.env.COPILOT_PLAYWRIGHT_PATH;
if(!file||!playwright)throw new Error('COPILOT_UI_FIXTURE and COPILOT_PLAYWRIGHT_PATH required');
const config=JSON.parse(readFileSync(file));assert.equal(config.origin,'https://login.flolah.cloud');
const {chromium}=await import(pathToFileURL(playwright));
const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0,page;
try{
 const context=await browser.newContext();page=await context.newPage();const prohibited=[];let announcementDismissed=false;
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
 await page.getByRole('button',{name:'Review setup',exact:true}).click();
 await page.getByRole('button',{name:'Approve and apply fields',exact:true}).waitFor();
 assert.equal(await select.inputValue(),'yes','opening review is not approval');checks++;
 await page.getByRole('button',{name:'Approve and apply fields',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('select')].some(el=>el.closest('label')?.querySelector('span')?.textContent==='Efficiency mode'&&el.value==='no'));
 assert.equal(await select.inputValue(),'no');checks++;
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
 console.log(JSON.stringify({stage:'COPILOT_DEPLOYED_BROWSER_PASS',checks,profile_saved:false,source_map_visible:true,seeded_recipes_visible:true}));
}catch(error){
 // Only synthetic fixture UI metadata, never request headers or auth tokens.
 console.error(JSON.stringify({stage:'COPILOT_BROWSER_DIAGNOSTIC',path:page?new URL(page.url()).pathname:null,headings:page?await page.locator('h1').allTextContents():[],panel:page?await page.locator('.copilot-panel').textContent().catch(()=>null):null}));throw error;
}finally{await browser.close()}

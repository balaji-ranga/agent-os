// Deployed UI acceptance on disposable CEO fixture only; no business writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const config=JSON.parse(readFileSync(process.env.COPILOT_UI_FIXTURE));
assert.equal(config.origin,'https://login.flolah.cloud');
assert(config.users.every(id=>/^copilot-map-acceptance-[ab]-[0-9a-f-]+$/.test(id)));
const {chromium}=await import(pathToFileURL(process.env.COPILOT_PLAYWRIGHT_PATH));
const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0;
try{
 const page=await browser.newPage(),blocked=[];
 await page.route('**/api/**',async route=>{
  const r=route.request(),path=new URL(r.url()).pathname;
  if(path==='/api/promotions/eligible'){await route.fulfill({status:200,contentType:'application/json',body:'{"campaign":null}'});return;}
  if(!['GET','HEAD','OPTIONS'].includes(r.method())&&!path.startsWith('/api/ui-copilot/')){blocked.push(path);await route.abort();return;}
  await route.continue();
 });
 await page.addInitScript(token=>localStorage.setItem('agent-os-auth-token',token),config.token);
 await page.goto(config.origin+'/profile',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'My profile',exact:true}).waitFor();
 await page.getByRole('button',{name:'Platform Help',exact:true}).click();
 await page.getByRole('button',{name:'Copilot options',exact:true}).click();
 await page.getByText('Teach Copilot',{exact:true}).click();
 await page.getByRole('textbox',{name:'Lesson name',exact:true}).fill('Efficiency preference walkthrough');
 await page.getByText('New lesson purpose and matching',{exact:true}).click();
 const newMetadata=page.locator('.copilot-coaching details').filter({has:page.locator('summary').filter({hasText:/^New lesson purpose and matching$/})});
 for(const [label,value] of [['Purpose / description (required)','Explain efficiency mode preference'],['When to use this recipe (required)','Review efficiency mode preference without changing settings'],['Expected outcome (required)','Efficiency mode preference is understood; settings unchanged']])await newMetadata.getByRole('textbox',{name:label,exact:true}).fill(value);
 await page.getByRole('button',{name:'Start lesson',exact:true}).click();
 const selected=page.locator('section[aria-label="Coaching lesson"]');
 await selected.getByText('Efficiency preference walkthrough · version 1 · draft',{exact:true}).waitFor();checks++;
 assert.equal(await selected.getByRole('textbox',{name:'Purpose / description (required)',exact:true}).inputValue(),'Explain efficiency mode preference');checks++;
 await selected.getByRole('textbox',{name:'Explain the step',exact:true}).fill('Inspect efficiency mode preference without changing settings.');
 await selected.getByRole('textbox',{name:'How can Copilot recognize success?',exact:true}).fill('The Profile screen is visible and no settings have changed.');
 await selected.getByRole('button',{name:'Capture this screen step',exact:true}).click();
 await selected.getByText('profile · navigate',{exact:true}).waitFor();checks++;
 await selected.getByRole('checkbox').check();
 await selected.getByRole('button',{name:'Publish private recipe',exact:true}).click();
 await selected.getByRole('button',{name:'Replay recording',exact:true}).waitFor();checks++;
 // Reload checks actual server persistence, not merely local React state.
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'My profile',exact:true}).waitFor();
 await page.getByRole('button',{name:'Platform Help',exact:true}).click();await page.getByRole('button',{name:'Copilot options',exact:true}).click();await page.getByText('Teach Copilot',{exact:true}).click();
 await page.getByText('My recorded lessons',{exact:true}).click();
 await page.getByRole('button',{name:/^Efficiency preference walkthrough · v3 · published/}).click();
 assert.equal(await selected.getByRole('textbox',{name:'Purpose / description (required)',exact:true}).inputValue(),'Explain efficiency mode preference');checks++;
 await selected.getByRole('button',{name:'Replay recording',exact:true}).click();
 await page.locator('article[aria-label="Recording replay"]').waitFor();checks++;
 await page.getByRole('button',{name:'Stop replay',exact:true}).click();
 await page.getByRole('button',{name:'Copilot options',exact:true}).click();
 // Selection may have been closed by replay; ensure metadata panel is visible.
 await selected.getByRole('textbox',{name:'When to use this recipe (required)',exact:true}).waitFor();
 await selected.getByRole('textbox',{name:'When to use this recipe (required)',exact:true}).fill('Review efficiency mode preference before choosing settings');
 assert.equal(await selected.getByRole('button',{name:'Replay recording',exact:true}).isDisabled(),true);checks++;
 await selected.getByRole('button',{name:'Save recipe metadata',exact:true}).click();
 await selected.getByText('Efficiency preference walkthrough · version 4 · draft',{exact:true}).waitFor();checks++;
 await selected.getByRole('checkbox').check();await selected.getByRole('button',{name:'Publish private recipe',exact:true}).click();await selected.getByRole('button',{name:'Replay recording',exact:true}).waitFor();
 await page.getByRole('button',{name:'Back to conversation',exact:true}).click();
 await page.getByRole('textbox',{name:'Message Platform Help',exact:true}).fill('Explain efficiency mode preference. Do not navigate, fill or save.');
 const response=page.waitForResponse(r=>r.url().endsWith('/propose')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Send',exact:true}).click();const result=await (await response).json();
 assert.equal(result.conversation.at(-1).recipe_match.status,'matched');assert.deepEqual(result.proposal.actions,[]);checks++;
 await page.getByText('Matched recorded guidance',{exact:true}).click();await page.getByText(/Request terms matched:/).waitFor();checks++;
 assert.deepEqual(blocked,[]);checks++;
 console.log(JSON.stringify({stage:'COPILOT_RECIPE_BROWSER_PASS',checks,metadata_persisted:true,replay_preserved:true,match_reason_visible:true,business_writes:false}));
}finally{await browser.close()}

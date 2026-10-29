// Local real-browser regression for the marketing Home and Vision navigation.
// Docs is a destination fixture: this test certifies navigation, not docs content.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../deploy/static/flolah-home/',import.meta.url));
const modulePath=process.env.STATIC_NAV_PLAYWRIGHT_PATH;
const {chromium}=await import(modulePath?pathToFileURL(modulePath):'playwright');
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/docs/'){res.setHeader('Content-Type','text/html');res.end('<h1>Docs destination fixture</h1>');return;}
  const file=resolve(root,'.'+(pathname.endsWith('/')?pathname+'index.html':pathname));
  if(!file.startsWith(resolve(root)+sep)){res.writeHead(403).end();return;}
  const data=await readFile(file);res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(data);
 }catch{res.writeHead(404).end();}
});
server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const liveOrigin=process.env.STATIC_NAV_BASE_URL;
if(liveOrigin&&liveOrigin!=='https://flolah.cloud')throw Error('Live acceptance is restricted to the public marketing site');
const origin=liveOrigin||`http://127.0.0.1:${server.address().port}`;
let browser,checks=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const links=[['Docs','/docs/'],['Vision','/vision.html'],['Open Agents Ecosystem','/free-tools/']];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext();
 const safeRequest=r=>new URL(r.request().url()).origin===origin&&['GET','HEAD','OPTIONS'].includes(r.request().method())?r.continue():r.abort();
 await context.route('**/*',safeRequest);
 const page=await context.newPage();
 for(const source of ['/','/vision.html']){
  for(const width of [320,375,390,620,768,900,901,1024,1100,1101,1280,1440]){
   await page.setViewportSize({width,height:568});await page.goto(origin+source);
   const menu=page.locator('.mobile-nav'),summary=menu.locator('summary');
   const mobile=width<=1280;
   check(await summary.isVisible(),mobile,`${source} ${width}: mobile disclosure`);
   check(await page.locator('.nav-inner').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`${source} ${width}: header fits`);
   if(!mobile){check(await page.locator('.nav-inner > .nav-links').isVisible(),true,'Desktop links preserved');continue;}
   for(const [label] of links)check(await menu.getByRole('link',{name:label,exact:true}).isVisible(),false,'Closed menu excludes hidden links');
   await summary.focus();await page.keyboard.press('Enter');
   for(const [label,path] of links){
    const link=menu.getByRole('link',{name:label,exact:true});
    check(await link.isVisible(),true,`${label} visible at ${width}`);
    check(new URL(await link.getAttribute('href'),origin+source).pathname,path,`${label} destination`);
    const box=await link.boundingBox();check(box.height>=44,true,'Touch target at least 44px');check(box.x>=0&&box.x+box.width<=width+1,true,'Link fits viewport');
   }
   if(width===390&&process.env.STATIC_NAV_SCREENSHOT_DIR){
    await mkdir(process.env.STATIC_NAV_SCREENSHOT_DIR,{recursive:true});
    await page.screenshot({path:join(process.env.STATIC_NAV_SCREENSHOT_DIR,source==='/'?'home-mobile.png':'vision-mobile.png')});
   }
   await page.keyboard.press('Tab');check(await menu.locator('a').first().evaluate(el=>el===document.activeElement),true,'Keyboard reaches first menu link');
   await page.keyboard.press('Escape');check(await menu.evaluate(el=>el.open),false,'Escape closes');check(await summary.evaluate(el=>el===document.activeElement),true,'Escape restores focus');
   await summary.click();await page.mouse.click(2,80);check(await menu.evaluate(el=>el.open),false,'Outside click closes');
   await summary.click();await menu.getByRole('link',{name:source==='/'?'Platform':'The problem',exact:true}).click();check(await menu.evaluate(el=>el.open),false,'In-page link closes menu');
  }
  await page.setViewportSize({width:390,height:568});
  for(const [label,path] of links){
   await page.goto(origin+source);await page.locator('.mobile-nav summary').click();
   await page.locator('.mobile-nav').getByRole('link',{name:label,exact:true}).click();
   await page.waitForURL(url=>url.pathname===path);check(new URL(page.url()).pathname,path,`Click ${label} navigates`);
  }
  await page.goto(origin+source);await page.locator('.mobile-nav summary').click();
  await page.setViewportSize({width:1440,height:768});await page.waitForFunction(()=>!document.querySelector('.mobile-nav').open);checks++;
  await page.setViewportSize({width:390,height:568});check(await page.locator('.mobile-nav').evaluate(el=>el.open),false,'Resize does not restore stale open menu');
 }
 const noJs=await browser.newContext({javaScriptEnabled:false,viewport:{width:320,height:480}}),fallback=await noJs.newPage();
 await noJs.route('**/*',safeRequest);
 for(const source of ['/','/vision.html']){
  await fallback.goto(origin+source);await fallback.locator('.mobile-nav summary').click();
  for(const [label] of links)check(await fallback.locator('.mobile-nav').getByRole('link',{name:label,exact:true}).isVisible(),true,'Native menu works without JS');
 }
 await noJs.close();
 console.log(JSON.stringify({stage:liveOrigin?'STATIC_MOBILE_NAV_LIVE_PASS':'STATIC_MOBILE_NAV_PASS',checks,pages:2,widths:12,min_width:320,keyboard:true,no_javascript_fallback:true,production_writes:false}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}

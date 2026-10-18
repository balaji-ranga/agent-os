// Optional opt-in preview for any registered host; no website schema.
const script=new URL(import.meta.url),configURL=new URL(script.searchParams.get('config')||'/adoption-preview.json',location.origin);
if(configURL.origin!==location.origin)throw new Error('Preview configuration must belong to this host');
let enabled=new URL(location.href).searchParams.get('digitalAdoptionPreview')==='1';
try{if(enabled)sessionStorage.setItem('digital-adoption-preview-enabled','1');enabled||=sessionStorage.getItem('digital-adoption-preview-enabled')==='1';}catch{}
if(window===window.top&&enabled){
 const status=document.createElement('button');status.type='button';status.dataset.adoptionWidget='true';status.style.cssText='position:fixed;bottom:20px;right:20px;z-index:2147483646;padding:12px';document.body.append(status);let attempt=0;
 async function connect(){const current=++attempt;status.disabled=true;status.textContent='Connecting copilot…';let timer;
 try{const response=await fetch(configURL,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('Preview installation unavailable');const config=await response.json(),service=new URL(config.serviceUrl),expected=new URL('./',script);expected.search='';
 if(service.href!==expected.href||config.origin!==location.origin||!Number.isSafeInteger(config.expiresAt))throw Object.assign(new Error('The website owner must correct this preview configuration, then reload this page.'),{code:'PREVIEW_SCOPE_INVALID'});
 if(config.expiresAt<=Date.now())throw Object.assign(new Error('The website owner must renew this public preview. Reload this page after renewal.'),{code:'PREVIEW_EXPIRED'});
 const sdkUrl=new URL('sdk.mjs',service);if(current>1)sdkUrl.searchParams.set('retry',String(current));const {mount}=await Promise.race([import(sdkUrl.href),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Copilot download timed out')),8000);})]);if(current!==attempt)return;status.remove();mount({serviceUrl:service.href,installationToken:config.installationToken,theme:{title:'Website Copilot · UAT'}}).catch(()=>{});
 }catch(error){if(current===attempt){const terminal=['PREVIEW_EXPIRED','PREVIEW_SCOPE_INVALID'].includes(error.code);status.disabled=terminal;status.textContent=error.code==='PREVIEW_EXPIRED'?'Copilot preview expired · owner renewal required':terminal?'Copilot preview unavailable · owner configuration required':'Retry copilot';status.title=error.message;}}finally{clearTimeout(timer);}}
 status.onclick=connect;connect();
}

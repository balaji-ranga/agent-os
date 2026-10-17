// Optional preview snippet for any registered host. It contains no host schema.
const script=new URL(import.meta.url),configURL=new URL(script.searchParams.get('config')||'/adoption-preview.json',location.origin);
if(configURL.origin!==location.origin)throw new Error('Preview configuration must belong to this host');
if(new URL(location.href).searchParams.get('digitalAdoptionPreview')==='1')sessionStorage.setItem('digital-adoption-preview-enabled','1');
if(window===window.top&&sessionStorage.getItem('digital-adoption-preview-enabled')==='1'){
 const response=await fetch(configURL,{credentials:'omit',cache:'no-store'});if(!response.ok)throw new Error('Preview installation unavailable');
 const config=await response.json(),service=new URL(config.serviceUrl),expected=new URL('./',script);expected.search='';
 if(service.href!==expected.href||config.origin!==location.origin||config.expiresAt<=Date.now())throw new Error('Preview installation scope changed or expired');
 const {mount}=await import(new URL('sdk.mjs',service).href);await mount({serviceUrl:service.href,installationToken:config.installationToken,theme:{title:'Website Copilot · UAT'}});
}

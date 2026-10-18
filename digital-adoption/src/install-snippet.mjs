// Pure shared installation generator. Publishable credentials only; no host schema.
export function installationSnippet(serviceUrl, installationToken) {
  const service = new URL(serviceUrl);
  if (
    !["https:", "http:"].includes(service.protocol) ||
    service.username ||
    service.password ||
    service.search ||
    service.hash ||
    !service.pathname.endsWith("/") ||
    (service.protocol === "http:" &&
      !["localhost", "127.0.0.1"].includes(service.hostname)) ||
    !/^dac_install_[A-Za-z0-9_-]{43}$/.test(installationToken)
  )
    throw new Error("Invalid installation snippet");
  return `<script type="module">
const status=document.createElement('button');status.type='button';status.dataset.adoptionWidget='true';status.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483646;padding:12px';document.body.append(status);
let attempt=0;
async function connect(){const current=++attempt;status.disabled=true;status.textContent='Connecting copilot…';let timer;
try{const sdk=await Promise.race([import(${JSON.stringify(new URL("sdk.mjs", service).href)}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Copilot download timed out')),8000);})]);if(current!==attempt)return;status.remove();sdk.mount({serviceUrl:${JSON.stringify(service.href)},installationToken:${JSON.stringify(installationToken)}}).catch(()=>{});}
catch(error){if(current===attempt){status.disabled=false;status.textContent='Retry copilot';status.title=error.message;}}
finally{clearTimeout(timer);}}
status.onclick=connect;connect();
</script>`;
}

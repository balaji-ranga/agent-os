// One content source for the marketing diagram and the docs component.
import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const source=new URL('docs-site/src/components/',root);
const data=JSON.parse(readFileSync(new URL('company-os-architecture.json',source),'utf8'));
for(const name of ['company-os-architecture.json','company-os-architecture.css']){
 const bytes=readFileSync(new URL(name,source)),target=new URL('deploy/static/flolah-home/assets/'+name,root);
 if(process.argv.includes('--check')){if(!bytes.equals(readFileSync(target)))throw Error('Regenerate shared architecture assets: '+name);}
 else writeFileSync(target,bytes);
}
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const nested=i=>i>=data.layers.length?'':`<div class="os-layer os-${data.layers[i].id}"><h3>${escape(data.layers[i].title)}</h3><p>${escape(data.layers[i].details)}</p>${data.layers[i].more?`<p>${escape(data.layers[i].more)}</p>`:''}${nested(i+1)}</div>`;
const diagram=`<!-- company-os-architecture:start -->
        <figure class="os-architecture" aria-labelledby="os-diagram-title">
          <figcaption id="os-diagram-title">Flolah — AI-native Company OS<span>Generalized agentic operating architecture</span></figcaption>
          <div class="os-stack">${nested(0)}</div>
          <div class="os-foundation"><strong>${escape(data.foundation.title)}</strong><p>${escape(data.foundation.details)}</p><div class="os-capabilities">${data.foundation.capabilities.map(c=>`<span>${escape(c)}</span>`).join('')}</div></div>
          <p class="os-caption">${escape(data.foundation.note)}</p>
        </figure>
        <!-- company-os-architecture:end -->`;
const target=new URL('deploy/static/flolah-home/index.html',root),html=readFileSync(target,'utf8');
const pattern=/<!-- company-os-architecture:start -->[\s\S]*?<!-- company-os-architecture:end -->/;
if(!pattern.test(html))throw Error('Architecture placement marker is missing');
const next=html.replace(pattern,diagram);
if(process.argv.includes('--check')){if(next!==html)throw Error('Regenerate architecture: node scripts/build-company-os-architecture.mjs');}
else writeFileSync(target,next);
